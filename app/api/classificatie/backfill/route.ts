// ============================================================================
//  POST /api/classificatie/backfill — Increment E
//
//  Genereert procesclassificatievoorstellen voor ONGEKOPPELDE documenten van het
//  eigen fonds (patroon embeddings-backfill: één batch per aanroep, rapporteert
//  resterend, géén Vercel-timeout). De denorm-velden op de chunks zijn al door de
//  migratie gevuld; deze route doet uitsluitend de classificatie.
//
//  • Expliciet gekoppelde documenten worden overgeslagen (nooit omhangen, FO §10).
//  • confidence 'hoog'  → auto-koppelen (status auto_toegepast) + audit (rag_impact).
//  • 'middel'/'laag'    → voorstel status 'open' (review-queue).
//  • 'geen_match'       → geen voorstel.
//
//  Alleen voorzitter/beheerder. RLS scopet op het eigen fonds. Geen service-role.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { classificeerDocument, type ClassificatieInvoer } from "@/lib/classificatie";
import {
  haalKandidaten,
  logClassificatieKoppeling,
  bouwClassificatieReden,
} from "@/lib/classificatie-service";

export const dynamic = "force-dynamic";

// Klein gehouden zodat één aanroep ruim binnen de Vercel-functietimeout blijft.
const BATCH = 25;
// Aantal chunks dat we per document bekijken voor de inhoudsmatch (S4).
const CHUNK_STEEKPROEF = 12;

export async function POST(_req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    const { data: profiel } = await supabase
      .from("profielen")
      .select("rol, naam, fonds_id")
      .eq("id", user.id)
      .single();
    if (!profiel || !["voorzitter", "beheerder"].includes(profiel.rol)) {
      return NextResponse.json({ error: "Onvoldoende rechten" }, { status: 403 });
    }
    if (!profiel.fonds_id) {
      return NextResponse.json(
        { error: "Gebruiker zonder fonds kan niet classificeren" },
        { status: 400 }
      );
    }
    const fondsId = profiel.fonds_id as string;

    const kandidaten = await haalKandidaten(supabase, fondsId);

    // Documenten met een al bestaand voorstel (welke status dan ook) overslaan —
    // idempotent én terminerend: ook 'geen_match'-documenten krijgen een marker-
    // rij (status 'afgewezen', beoordeeld_door null), zodat de backfill niet
    // dezelfde documenten blijft herverwerken (patroon embeddings-backfill).
    const { data: bestaandeVoorstellen } = await supabase
      .from("classificatie_voorstellen")
      .select("document_id");
    const reedsVoorgesteld = new Set(
      (bestaandeVoorstellen ?? []).map((v) => v.document_id as string)
    );

    // Eén batch ongekoppelde, actieve fonds-documenten.
    let docQuery = supabase
      .from("documenten")
      .select("id, titel, documenttype, documentdatum, agendapunt_id, actief")
      .eq("fonds_id", fondsId)
      .is("procesinstantie_id", null)
      .order("aangemaakt", { ascending: true });
    const reedsArr = [...reedsVoorgesteld];
    if (reedsArr.length > 0) {
      docQuery = docQuery.not("id", "in", `(${reedsArr.join(",")})`);
    }
    const { data: docs, error: docErr } = await docQuery.limit(BATCH);
    if (docErr) {
      console.error("Classificatie-backfill: documenten ophalen mislukt:", docErr);
      return NextResponse.json({ error: "Ophalen mislukt" }, { status: 500 });
    }
    if (!docs || docs.length === 0) {
      return NextResponse.json({
        verwerkt: 0,
        voorstellen: 0,
        autoGekoppeld: 0,
        resterend: 0,
        klaar: true,
      });
    }

    let verwerkt = 0;
    let voorstellen = 0;
    let autoGekoppeld = 0;
    let eersteFout: string | null = null;

    for (const doc of docs) {
      verwerkt++;
      if (doc.actief === false) continue; // harde uitsluiting (laag 1)

      const { data: chunks } = await supabase
        .from("document_chunks")
        .select("tekst")
        .eq("document_id", doc.id)
        .limit(CHUNK_STEEKPROEF);

      const invoer: ClassificatieInvoer = {
        titel: (doc.titel as string) ?? "",
        documenttype: (doc.documenttype as string | null) ?? null,
        documentdatum: (doc.documentdatum as string | null) ?? null,
        reedsGekoppeld: false, // gefilterd op procesinstantie_id is null
        isNotulen: (doc.documenttype as string | null) === "notulen",
        heeftAgendapunt: !!doc.agendapunt_id,
        chunkTeksten: (chunks ?? []).map((c) => (c.tekst as string) ?? ""),
      };

      const voorstel = classificeerDocument(invoer, kandidaten);

      // geen_match → marker-rij zodat dit document niet eindeloos herverwerkt
      // wordt. Status 'afgewezen' (systeem, beoordeeld_door null); de
      // review-queue toont alleen status='open', dus dit vervuilt die niet.
      if (voorstel.confidence === "geen_match") {
        const { error: gmErr } = await supabase
          .from("classificatie_voorstellen")
          .insert({
            document_id: doc.id,
            fonds_id: fondsId,
            voorgestelde_procesinstantie_id: null,
            voorgesteld_documenttype: null,
            confidence: "geen_match",
            bron: voorstel.bron,
            status: "afgewezen",
            toelichting: `auto: geen passende procesinstantie — ${voorstel.toelichting}`,
          });
        if (gmErr && !eersteFout) eersteFout = gmErr.message;
        continue;
      }

      const autoKoppelen = voorstel.confidence === "hoog";
      const nu = new Date().toISOString();

      // Voorstel wegschrijven. De partiële unique-index voorkomt een tweede
      // actief voorstel per document (race-veilig).
      const { data: ingevoegd, error: insErr } = await supabase
        .from("classificatie_voorstellen")
        .insert({
          document_id: doc.id,
          fonds_id: fondsId,
          voorgestelde_procesinstantie_id: voorstel.procesinstantie_id,
          voorgesteld_documenttype: voorstel.documenttype,
          confidence: voorstel.confidence,
          bron: voorstel.bron,
          status: autoKoppelen ? "auto_toegepast" : "open",
          toelichting: voorstel.toelichting,
          toegepast_op: autoKoppelen ? nu : null,
        })
        .select("id")
        .maybeSingle();
      if (insErr) {
        if (!eersteFout) eersteFout = insErr.message;
        continue; // bv. unique-conflict door parallelle run — niet fataal
      }
      voorstellen++;

      if (autoKoppelen && voorstel.procesinstantie_id) {
        // Primaire koppeling wegschrijven onder de bestaande fondsconsistentie-
        // trigger (nooit cross-fonds). Faalt dit, draai het voorstel terug naar
        // 'open' zodat het niet als "toegepast" blijft staan zonder koppeling.
        const { error: koppelErr } = await supabase
          .from("documenten")
          .update({ procesinstantie_id: voorstel.procesinstantie_id })
          .eq("id", doc.id);
        if (koppelErr) {
          if (!eersteFout) eersteFout = koppelErr.message;
          if (ingevoegd?.id) {
            await supabase
              .from("classificatie_voorstellen")
              .update({ status: "open", toegepast_op: null })
              .eq("id", ingevoegd.id);
          }
          continue;
        }
        await logClassificatieKoppeling(supabase, {
          documentId: doc.id as string,
          documentTitel: (doc.titel as string) ?? null,
          fondsId,
          gebruikerId: user.id,
          gebruikerNaam: (profiel.naam as string | null) ?? null,
          veldNaam: "procesinstantie_id",
          oudeWaarde: null,
          nieuweWaarde: voorstel.procesinstantie_id,
          reden: bouwClassificatieReden(voorstel.confidence, voorstel.bron, voorstel.toelichting),
          ragImpact: true,
        });
        autoGekoppeld++;
      }
    }

    // Resterend = ongekoppelde fonds-documenten die nog GEEN voorstel(marker)
    // hebben — dat is het echte resterende werk. Elke verwerkte doc kreeg een
    // rij, dus deze teller daalt strikt.
    const { data: ungekoppeldNa } = await supabase
      .from("documenten")
      .select("id")
      .eq("fonds_id", fondsId)
      .is("procesinstantie_id", null);
    const { data: voorstelDocs } = await supabase
      .from("classificatie_voorstellen")
      .select("document_id");
    const metVoorstel = new Set(
      (voorstelDocs ?? []).map((v) => v.document_id as string)
    );
    const resterend = (ungekoppeldNa ?? []).filter(
      (d) => !metVoorstel.has(d.id as string)
    ).length;

    return NextResponse.json({
      verwerkt,
      voorstellen,
      autoGekoppeld,
      eersteFout,
      resterend,
      klaar: resterend === 0,
    });
  } catch (e) {
    console.error("Classificatie-backfill fout:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
