// GET /api/procedures/[id]/afschriften
// -----------------------------------------------------------------------------
// T6 — Lijst van afschriften van een proces (RLS-gefilterd op eigen fonds). De
// bureau-rol ziet de rijen WÉL (met mag_downloaden=false), zodat duidelijk is
// dat en waarom een afschrift niet te openen is (ontwerpbeslissing 4).
//
// Verouderingsbadge (ontwerpbeslissing 5): voor 'actueel'-afschriften telt de
// route hoeveel gebeurtenissen ná het generatie-anker (dossier_stand_op) zijn
// bijgekomen. 'besluitmoment'-afschriften zijn bevroren → nooit verouderd.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { isBureauRol } from "@/core/lib/bureau-gate";
import { haalFondsleden, weergaveNaam } from "@/core/lib/fondsleden";

export const dynamic = "force-dynamic";

interface AfschriftRow {
  id: string;
  versie: "actueel" | "besluitmoment";
  aanleiding: string | null;
  status: "bezig" | "gereed" | "mislukt";
  bytes: number | null;
  bestandsaantal: number | null;
  sha256: string | null;
  bevat_stemgedrag: boolean;
  dossier_stand_op: string | null;
  aangemaakt_op: string;
  aangemaakt_door: string | null;
  ingetrokken_op: string | null;
  ingetrokken_door: string | null;
  ingetrokken_reden: string | null;
}

export const GET = withFondsRoute({ capability: "procedures.view", schema: "geen-body" }, async (ctx, _req: NextRequest, params) => {
  try {
    const { id: procedureId } = params as { id: string };
    const supabase = ctx.supabase;

    const bureau = isBureauRol(ctx.rol);

    const { data: rows } = await supabase
      .from("procedure_afschriften")
      .select(
        "id, versie, aanleiding, status, bytes, bestandsaantal, sha256, bevat_stemgedrag, dossier_stand_op, aangemaakt_op, aangemaakt_door, ingetrokken_op, ingetrokken_door, ingetrokken_reden"
      )
      .eq("procedure_id", procedureId)
      .order("aangemaakt_op", { ascending: false });
    const afschriften = (rows ?? []) as AfschriftRow[];

    // Verouderingsberekening: de tijden van de SUBSTANTIËLE gebeurtenissen van
    // het proces. Meta-gebeurtenissen — het aanmaken/downloaden/intrekken van een
    // afschrift zelf, en de snelle auditdossier-export — zijn géén dossierwijziging
    // en mogen de "sindsdien N"-teller niet vervuilen. Zonder deze uitsluiting
    // toont een vers gegenereerd afschrift meteen "verouderd — 2 gebeurtenissen"
    // (namelijk z'n eigen afschrift_aangemaakt + afschrift_gereed).
    const META_EVENTS = new Set([
      "afschrift_aangemaakt",
      "afschrift_gereed",
      "afschrift_mislukt",
      "afschrift_gedownload",
      "afschrift_ingetrokken",
      "auditdossier_geexporteerd",
    ]);
    let alleTijden: number[] = [];
    if (afschriften.some((a) => a.versie === "actueel" && a.status === "gereed")) {
      const { data: decRows } = await supabase
        .from("decision_objects")
        .select("id")
        .eq("procedure_id", procedureId);
      const decisionIds = (decRows ?? []).map((r) => r.id as string);
      const [{ data: evRows }, { data: logRows }] = await Promise.all([
        decisionIds.length
          ? supabase.from("governance_events").select("tijdstip, event_type").in("decision_id", decisionIds)
          : Promise.resolve({ data: [] as { tijdstip: string; event_type: string }[] }),
        supabase.from("procedure_log").select("tijdstip, event_type").eq("procedure_id", procedureId),
      ]);
      alleTijden = [
        ...((evRows ?? []) as { tijdstip: string; event_type: string }[]),
        ...((logRows ?? []) as { tijdstip: string; event_type: string }[]),
      ]
        .filter((r) => !META_EVENTS.has(r.event_type))
        .map((r) => Date.parse(r.tijdstip));
    }

    const leden = await haalFondsleden(supabase);
    const naam = (id: string | null) => (id ? weergaveNaam(id, null, leden) : null);

    const items = afschriften.map((a) => {
      let verouderdSindsdien = 0;
      if (a.versie === "actueel" && a.status === "gereed" && a.dossier_stand_op) {
        const anker = Date.parse(a.dossier_stand_op);
        verouderdSindsdien = alleTijden.filter((t) => t > anker).length;
      }
      const ingetrokken = a.ingetrokken_op !== null;
      return {
        id: a.id,
        versie: a.versie,
        aanleiding: a.aanleiding,
        status: a.status,
        bytes: a.bytes,
        bestandsaantal: a.bestandsaantal,
        sha256: a.sha256,
        sha256Prefix: a.sha256 ? a.sha256.slice(0, 12) : null,
        bevatStemgedrag: a.bevat_stemgedrag,
        aangemaaktOp: a.aangemaakt_op,
        aangemaaktDoorNaam: naam(a.aangemaakt_door),
        ingetrokken,
        ingetrokkenReden: a.ingetrokken_reden,
        ingetrokkenDoorNaam: naam(a.ingetrokken_door),
        verouderd: a.versie === "actueel" && verouderdSindsdien > 0,
        verouderdSindsdien,
        magDownloaden: !bureau && a.status === "gereed" && !ingetrokken,
        // Reden waarom niet downloadbaar (voor de UI).
        nietDownloadbaarReden: bureau
          ? "Niet beschikbaar voor het bestuursbureau (bevat stemgedrag)."
          : a.status !== "gereed"
            ? a.status === "bezig"
              ? "Wordt gegenereerd…"
              : "Genereren is mislukt."
            : ingetrokken
              ? "Ingetrokken."
              : null,
      };
    });

    return NextResponse.json({ afschriften: items });
  } catch (e) {
    console.error("Fout in GET /api/procedures/[id]/afschriften:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
