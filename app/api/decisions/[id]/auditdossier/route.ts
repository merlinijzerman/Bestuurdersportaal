// GET /api/decisions/[id]/auditdossier
//
// Auditdossier-export voor Decision Object MVP-1E.
//
// Query-params:
//   ?versie=actueel          (default) — live DecisionDossierView via
//                                       buildDecisionDossierView (RLS).
//   ?versie=besluitmoment    — snapshot uit decision_audit_snapshots.
//                              Default: de **meest recente** snapshot,
//                              ongeacht trigger-status. Bij een
//                              heropen-cyclus (afgesloten → heropend →
//                              opnieuw afgesloten) is dat de laatste
//                              afsluit-snapshot, niet de eerste.
//   ?trigger=besloten|voorwaardelijk_besloten|in_evaluatie|afgesloten
//                            — alléén relevant bij versie=besluitmoment.
//                              Selecteert de meest recente snapshot
//                              van die specifieke trigger-status.
//                              Onmisbaar voor reconstructie in een
//                              heropen-cyclus waar meerdere snapshots
//                              van dezelfde status bestaan: de eerste
//                              "besloten"-snapshot vs. een latere.
//   ?formaat=html            (default) — print-vriendelijke HTML in
//                                        nieuw tabblad.
//   ?formaat=json            — DecisionDossierView als JSON, geschikt
//                              voor machine-consumption / archief.
//
// Logging: elke export wordt vastgelegd als governance_event
// 'auditdossier_geexporteerd' met versie + trigger + formaat in de
// payload, zodat in het audit-spoor te traceren is wie wanneer welke
// dossier-export heeft opgevraagd.

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { beoordeelNavigatieHerkomst, crossSiteGeweigerd } from "@/core/lib/navigatie-herkomst";
import { isBureauRol } from "@/core/lib/bureau-gate";
import { buildDecisionDossierView } from "@/core/lib/decision";
import { renderAuditdossierHtml } from "@/core/lib/auditdossier-html";
import type {
  AuditSnapshotMeta,
  DecisionDossierView,
} from "@/core/lib/decision-view";

type Versie = "actueel" | "besluitmoment";
type Formaat = "html" | "json";
type TriggerStatus =
  | "besloten"
  | "voorwaardelijk_besloten"
  | "in_evaluatie"
  | "afgesloten";

const TOEGESTANE_TRIGGERS: TriggerStatus[] = [
  "besloten",
  "voorwaardelijk_besloten",
  "in_evaluatie",
  "afgesloten",
];

interface SnapshotRow {
  id: string;
  decision_id: string;
  trigger_status: string;
  hash: string;
  aangemaakt_op: string;
  snapshot: unknown; // jsonb — wordt naar DecisionDossierView gecast
}

// T1.3 — de host↔fonds-afdwinging (defense-in-depth náást RLS) is naar de
// wrapper verhuisd: `hostGuard: true`. GEMETEN en niet aangenomen — de inline
// guard stond al direct ná het profiel en vóór élke andere poort van deze route,
// dus de wrapper trekt hem op exact dezelfde plek in de volgorde. De actor-naam
// die het profiel hier ook leverde komt nu uit `ctx.naam`.
export const GET = withFondsRoute({ hostGuard: "afdwingen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "decisions.view", label: "decisions.auditdossier.GET", schema: "geen-body" }, async (ctx, req: NextRequest, params) => {
  // H-04: een top-level navigatie vanaf een vreemde site stuurt onder een
  // Lax-cookie de sessie mee. Deze route schrijft een auditrecord, dus zo'n
  // aanroep zou een gebeurtenis in het dossier van het slachtoffer zetten.
  // Weigeren vóór er werk gebeurt; de uitkomst gaat mee in het record.
  const oordeel = beoordeelNavigatieHerkomst(req);
  if (!oordeel.toegestaan) return crossSiteGeweigerd("decisions.auditdossier.GET");

  try {
    const { id: decisionId } = params as { id: string };
    const supabase = ctx.supabase;

    // T1 bureau-rol (FR-4/G9): het auditdossier rendert `stemmingen.uitslag`
    // inclusief `per_stemgerechtigde` — naam, keuze en motivering per bestuurslid.
    // Dat is precies het individuele stemgedrag dat migratie
    // 2026_08_05_bestuursbureau_rol.sql voor deze rol afschermt op
    // `stem_uitbrengingen`. Zonder deze gate is de export een omweg om het alsnog
    // te lezen. De onderliggende jsonb blijft via PostgREST bereikbaar; de
    // structurele afscherming is openstaand punt OP-T1-7.
    if (isBureauRol(ctx.rol)) {
      return NextResponse.json(
        {
          error:
            "Het auditdossier bevat het stemgedrag per bestuurslid en is daarom niet beschikbaar voor het bestuursbureau.",
        },
        { status: 403 }
      );
    }

    const url = new URL(req.url);
    const versieRaw = (url.searchParams.get("versie") ?? "actueel").toLowerCase();
    const formaatRaw = (url.searchParams.get("formaat") ?? "html").toLowerCase();
    const triggerRaw = (url.searchParams.get("trigger") ?? "").toLowerCase();
    const versie: Versie =
      versieRaw === "besluitmoment" ? "besluitmoment" : "actueel";
    const formaat: Formaat = formaatRaw === "json" ? "json" : "html";
    const trigger: TriggerStatus | null =
      triggerRaw && TOEGESTANE_TRIGGERS.includes(triggerRaw as TriggerStatus)
        ? (triggerRaw as TriggerStatus)
        : null;

    // trigger is alleen zinvol bij versie=besluitmoment
    if (trigger && versie !== "besluitmoment") {
      return NextResponse.json(
        {
          error:
            "Parameter ?trigger= werkt alleen samen met ?versie=besluitmoment.",
        },
        { status: 400 }
      );
    }

    // RLS: bestaan + toegang.
    const { data: decision } = await supabase
      .from("decision_objects")
      .select("id, titel, besluit_code")
      .eq("id", decisionId)
      .maybeSingle();
    if (!decision) {
      return NextResponse.json(
        { error: "Decision Object niet gevonden of geen toegang" },
        { status: 404 }
      );
    }

    let view: DecisionDossierView;
    let snapshotMeta: { hash: string; aangemaakt_op: string } | null = null;

    if (versie === "besluitmoment") {
      // Snapshot ophalen — als ?trigger= is meegegeven, filter daarop;
      // anders meest recente ongeacht trigger-status.
      let snapQuery = supabase
        .from("decision_audit_snapshots")
        .select("id, decision_id, trigger_status, hash, aangemaakt_op, snapshot")
        .eq("decision_id", decisionId)
        .order("aangemaakt_op", { ascending: false })
        .limit(1);
      if (trigger) {
        snapQuery = snapQuery.eq("trigger_status", trigger);
      }
      const { data: snapRow } = await snapQuery.maybeSingle<SnapshotRow>();
      if (!snapRow) {
        const triggerHint = trigger
          ? ` van trigger-status "${trigger}"`
          : "";
        return NextResponse.json(
          {
            error: `Geen audit-snapshot${triggerHint} beschikbaar voor dit besluit. Snapshots ontstaan automatisch bij overgang naar besloten / voorwaardelijk_besloten / in_evaluatie / afgesloten.`,
          },
          { status: 404 }
        );
      }
      // De DB-functie fn_build_decision_dossier levert de payload-shape;
      // we casten om te kunnen renderen. Velden die later zijn
      // toegevoegd (readiness, evidence) ontbreken mogelijk — voor het
      // auditdossier is dat acceptabel: het toont de toestand op
      // besluitmoment, niet de huidige beoordeling.
      view = snapRow.snapshot as DecisionDossierView;
      snapshotMeta = { hash: snapRow.hash, aangemaakt_op: snapRow.aangemaakt_op };

      // Defensieve aanvullingen: minimumvelden invullen als de payload
      // ze niet had, zodat de renderer niet crasht op undefined.
      view.assumptions = view.assumptions ?? [];
      view.risks = view.risks ?? [];
      view.conditions = view.conditions ?? [];
      view.actions = view.actions ?? [];
      view.dissent = view.dissent ?? [];
      view.aiOutputs = view.aiOutputs ?? [];
      view.evaluations = view.evaluations ?? [];
      view.events = view.events ?? [];
      view.snapshots = (view.snapshots ?? []) as AuditSnapshotMeta[];
      view.steps = view.steps ?? [];
      // Bewijs en besluiten zijn sinds deze release onderdeel van
      // de view; oudere snapshots hebben deze velden niet — render-
      // functies verwachten een array.
      view.bewijs = view.bewijs ?? [];
      view.besluiten = view.besluiten ?? [];
      // Stemverslagen sinds tranche 2; oudere snapshots missen dit veld.
      view.stemverslagen = view.stemverslagen ?? [];
    } else {
      // Live actuele toestand.
      view = await buildDecisionDossierView(supabase, decisionId, {
        autoUpgraded: false,
      });
    }

    // Actor-naam voor audit-event en HTML-footer. Kwam uit de profielselect die
    // ook de host-afdwinging voedde; die twee doet de wrapper nu allebei.
    const aanvragerNaam = ctx.naam ?? null;

    // Logging — best effort. Bij faillende insert (RLS, etc.) blokkeren
    // we de export niet, want het auditspoor is secundair aan de
    // werkelijke export.
    await supabase.from("governance_events").insert({
      decision_id: decisionId,
      event_type: "auditdossier_geexporteerd",
      actor_id: ctx.gebruikerId,
      actor_naam: aanvragerNaam,
      object_type: "decision_object",
      object_id: decisionId,
      nieuwe_waarde: { versie, formaat, trigger: trigger ?? null, herkomst: oordeel.herkomst },
    });

    // Bestandsnaam voor download — veilig (geen spaces of speciale tekens).
    const veiligeNaam = decision.besluit_code.replace(/[^a-zA-Z0-9_-]/g, "_");
    const datumStempel = new Date().toISOString().slice(0, 10);
    const triggerSuffix = trigger ? `_${trigger}` : "";
    const baseFilename = `auditdossier_${veiligeNaam}_${versie}${triggerSuffix}_${datumStempel}`;

    if (formaat === "json") {
      return new NextResponse(JSON.stringify(view, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${baseFilename}.json"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const html = renderAuditdossierHtml(view, {
      versie,
      gegenereerdOp: new Date(),
      aanvragerNaam,
      snapshotHash: snapshotMeta?.hash ?? null,
      snapshotAangemaaktOp: snapshotMeta?.aangemaakt_op ?? null,
    });

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Inline zodat het direct in het tabblad opent;
        // de gebruiker kan via Cmd/Ctrl+P printen of als PDF opslaan.
        "Content-Disposition": `inline; filename="${baseFilename}.html"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("Fout in GET /api/decisions/[id]/auditdossier:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
