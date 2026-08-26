// ============================================================
//  POST /api/notulen/[id]/segmenteer — Increment D
//
//  Genereert/ververst regelgebaseerde SEGMENTVOORSTELLEN voor een notulen-
//  document (documenttype='notulen'). GEEN AI-call (lib/notulen.ts), GEEN
//  auto-publicatie en GEEN chunks: voorstellen zijn bevestigd=false tot de
//  secretaris ze bevestigt (POST …/bevestig).
//
//  Idempotent: bestaande BEVESTIGDE segmenten blijven ongemoeid; alleen
//  onbevestigde voorstellen worden ververst. Capability notulen.segment.confirm,
//  server-side afgedwongen. Tenant-isolatie via RLS (anon-key + fonds_id).
//
//  [id] = document_id van het notulendocument.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { rateLimited } from "@/core/lib/api-errors";
import { requireCapability } from "@/core/lib/capabilities";
import { stelSegmentenVoor, type AgendapuntRef } from "@/core/lib/notulen";
import {
  extractTekst,
  ONDERSTEUNDE_TYPES,
  type Bestandstype,
} from "@/core/lib/document-extractie";

export const dynamic = "force-dynamic";

export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "route-eigen", audit: { handeling: "notulen.segmenteren" }, capability: "notulen.segment.confirm", schema: "geen-body" }, async (ctx, _req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    const supabase = ctx.supabase;

    // M-06 (review 2026-07-30): deze route doet per aanroep externe
    // modelcalls en had geen enkele limiet — onbeperkt herhaalbaar door een
    // geauthenticeerde gebruiker (kosten-DoS).
    // Fail-closed: bij een storing in de teller is doorlaten juist de duurste
    // optie (zie core/lib/rate-limit.ts).
    const limiet = await controleerLimiet(supabase, LIMIETEN.segmenteer, { failClosed: true });
    if (!limiet.toegestaan) return rateLimited("notulen.segmenteer", limiet.resetAt);

    if (!(await requireCapability(ctx.gebruikerId, "notulen.segment.confirm"))) {
      return NextResponse.json(
        { error: "Geen rechten om notulensegmenten te beheren." },
        { status: 403 }
      );
    }

    // Document laden (RLS beperkt tot eigen fonds).
    const { data: document, error: docError } = await supabase
      .from("documenten")
      .select("id, titel, fonds_id, documenttype, vergadering_id, opslag_pad, bestandstype")
      .eq("id", id)
      .maybeSingle();
    if (docError || !document) {
      return NextResponse.json({ error: "Notulendocument niet gevonden" }, { status: 404 });
    }
    if (document.documenttype !== "notulen") {
      return NextResponse.json(
        { error: "Dit document is geen notulen (documenttype ≠ 'notulen')." },
        { status: 400 }
      );
    }
    if (!document.vergadering_id) {
      return NextResponse.json(
        { error: "Koppel de notulen eerst aan een vergadering voordat je segmenteert." },
        { status: 400 }
      );
    }
    if (!document.opslag_pad) {
      return NextResponse.json(
        { error: "Het origineel is niet beschikbaar; segmenteren vereist de brontekst." },
        { status: 410 }
      );
    }

    // Brontekst uit Storage halen en extraheren (authoritatieve bron, altijd
    // beschikbaar — onafhankelijk van de chunkstatus; her-extract-patroon).
    const bestandstype = (document.bestandstype as Bestandstype) || "pdf";
    if (!ONDERSTEUNDE_TYPES.includes(bestandstype)) {
      return NextResponse.json(
        { error: `Bestandstype '${bestandstype}' wordt niet ondersteund.` },
        { status: 400 }
      );
    }
    const { data: bestand, error: storageError } = await supabase.storage
      .from("documenten")
      .download(document.opslag_pad);
    if (storageError || !bestand) {
      return NextResponse.json(
        { error: "Kon het origineel niet ophalen uit de opslag." },
        { status: 500 }
      );
    }
    let tekst: string;
    try {
      const extractie = await extractTekst(Buffer.from(await bestand.arrayBuffer()), bestandstype);
      tekst = extractie.tekst ?? "";
    } catch (e) {
      console.error("Segmenteer: extractie mislukt:", e);
      return NextResponse.json(
        { error: "Kon de inhoud van het notulendocument niet uitlezen." },
        { status: 400 }
      );
    }

    // Agendapunten van de vergadering (actief, op volgorde).
    const { data: agendaRows } = await supabase
      .from("agendapunten")
      .select("id, titel, volgorde")
      .eq("vergadering_id", document.vergadering_id)
      .is("verwijderd_op", null)
      .order("volgorde", { ascending: true });
    const agendapunten: AgendapuntRef[] = (agendaRows ?? []).map((a) => ({
      id: a.id,
      titel: a.titel,
      volgorde: a.volgorde,
    }));

    const voorstellen = stelSegmentenVoor(tekst, agendapunten);

    // Bestaande segmenten ophalen — bevestigde blijven ongemoeid (idempotent).
    const { data: bestaande } = await supabase
      .from("notulen_segmenten")
      .select("id, segment_index, bevestigd")
      .eq("document_id", id);
    const bevestigde = (bestaande ?? []).filter((s) => s.bevestigd);
    const onbevestigdeIds = (bestaande ?? [])
      .filter((s) => !s.bevestigd)
      .map((s) => s.id);

    // Onbevestigde voorstellen verwijderen (die hebben nooit chunks).
    if (onbevestigdeIds.length > 0) {
      await supabase.from("notulen_segmenten").delete().in("id", onbevestigdeIds);
    }

    // Nieuwe voorstellen invoegen, met segment_index ná de bevestigde set zodat
    // de unique(document_id, segment_index) niet botst met bevestigde rijen.
    const base =
      bevestigde.length > 0
        ? Math.max(...bevestigde.map((s) => s.segment_index)) + 1
        : 0;
    const rijen = voorstellen.map((v, i) => ({
      document_id: id,
      vergadering_id: document.vergadering_id,
      agendapunt_id: v.agendapunt_id,
      fonds_id: document.fonds_id,
      segment_index: base + i,
      titel: v.titel,
      tekst: v.tekst,
      bevestigd: false,
    }));

    let ingevoegd: unknown[] = [];
    if (rijen.length > 0) {
      const { data: ins, error: insError } = await supabase
        .from("notulen_segmenten")
        .insert(rijen)
        .select("id, segment_index, titel, agendapunt_id, bevestigd");
      if (insError) {
        console.error("Segmenteer: invoegen mislukt:", insError);
        return NextResponse.json(
          { error: "Kon de segmentvoorstellen niet opslaan." },
          { status: 500 }
        );
      }
      ingevoegd = ins ?? [];
    }

    // Append-only audit: segmenteren is een bestuurshandeling (geen veldwijziging,
    // wél herleidbaar). rag_impact=false (nog geen chunks). Segmenteren is
    // reversibel/herhaalbaar, dus bij een log-fout volstaat een 500 (de mens kan
    // opnieuw segmenteren) — geen onomkeerbare bron-mutatie zonder spoor.
    const { error: logError } = await supabase.from("document_metadata_log").insert({
      document_id: id,
      document_titel_snapshot: document.titel,
      fonds_id: document.fonds_id,
      gewijzigd_door: ctx.gebruikerId,
      gewijzigd_door_naam: ctx.naam ?? null,
      veld_naam: "notulen_segmenten",
      oude_waarde: `${onbevestigdeIds.length} onbevestigd vervangen`,
      nieuwe_waarde: `${rijen.length} voorstel(len) gegenereerd`,
      wijzig_type: "notulen_segment",
      rag_impact: false,
    });
    if (logError) {
      console.error("Segmenteer: auditlog mislukt:", logError);
      return NextResponse.json(
        { error: "Voorstellen gegenereerd maar auditlog faalde — herhaal het segmenteren." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      document_id: id,
      bevestigd_ongemoeid: bevestigde.length,
      voorstellen: ingevoegd,
    });
  } catch (e) {
    console.error("Fout in POST /api/notulen/[id]/segmenteer:", e);
    return NextResponse.json({ error: "Interne fout" }, { status: 500 });
  }
});
