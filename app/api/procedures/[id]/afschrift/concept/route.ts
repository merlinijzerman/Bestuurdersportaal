// POST /api/procedures/[id]/afschrift/concept
// -----------------------------------------------------------------------------
// T6 fase 2 (G1/G2) — genereert de CONCEPT-leeswijzer (§2–4) op basis van de
// deterministische feitenkaart. Geen zij-effect op de bundel: dit levert alleen
// tekst die de gebruiker daarna redigeert en vaststelt (POST /afschrift).
//
// Laag C: het model schrijft proza rond de in code opgebouwde feitenkaart en mag
// geen feit toevoegen dat daar niet in staat. De guardrail (G2) toetst dat; bij
// een overtreding, een lege API-key of een call-fout valt de route terug op het
// deterministische sjabloon (aiGebruikt=false) — de flow faalt nooit naar de
// gebruiker (AC fase-2 2/6). Runt onder de user-RLS-client + bureau-403.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { bewaakteAnthropic } from "@/core/lib/ai-poort";
import {
  preflight,
  rondAf,
  sleutelUitRequest,
  vingerafdruk,
} from "@/core/lib/ai-preflight";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { isBureauRol } from "@/core/lib/bureau-gate";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import { rateLimited, badRequest } from "@/core/lib/api-errors";
import { buildDecisionDossierView } from "@/core/lib/decision";
import type { DecisionDossierView } from "@/core/lib/decision-view";
import { bouwFeitenkaart } from "@/core/lib/afschrift-feitenkaart";
import { bouwSjabloonProza } from "@/core/lib/afschrift-docx";
import { toetsLeeswijzerTegenFeitenkaart } from "@/core/lib/afschrift-guardrail";
import { AFSCHRIFT_AI_MODEL, AFSCHRIFT_PROMPTVERSIE } from "@/core/lib/afschrift-ai-config";
import type {
  AfschriftBron,
  ProcedureLogEntry,
  Feitenkaart,
} from "@/core/lib/afschrift-types";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `Je stelt drie korte secties op van een leeswijzer bij een auditdossier van een Nederlands pensioenfonds. Je schrijft UITSLUITEND op basis van de meegegeven feitenkaart (JSON). Je mag GEEN feit, getal, datum of naam toevoegen dat niet in de feitenkaart staat.

Strikte regels:
- Uitsluitend BESCHRIJVEND. Geen kwalificaties, geen oordelen (niet "zorgvuldig", niet "goed"). Wel bijvoorbeeld: "De onderbouwingsfase liep van 3 maart 2026 tot 19 april 2026; 2 van de 3 verplichte bewijsstukken waren aanwezig."
- Schrijf ALLE aantallen en jaartallen in CIJFERS, niet voluit (dus "3 aannames", niet "drie aannames"). Noem een datum altijd volledig zoals in de feitenkaart (dag, maand, jaar).
- Gebruik GEEN namen van personen of organisaties die niet in de feitenkaart staan.
- Afwijkingen uit de feitenkaart benoem je, je schrijft ze niet weg.
- Nederlands, zakelijk, lopende tekst. Samen 400–700 woorden over de drie secties.
- Geen aanbevelingen, geen vervolgstappen.

Antwoord UITSLUITEND met JSON in dit formaat, zonder omhulsel:
{"hoeVerlopen": "...", "watVastgelegd": "...", "bijzonderheden": "..."}
- hoeVerlopen (§2): hoe het proces is verlopen (fasen, doorlooptijd, betrokken besluiten).
- watVastgelegd (§3): aantallen en karakter van aannames, risico's, voorwaarden, acties, dissent en bewijs.
- bijzonderheden (§4): de afwijkingen uit de feitenkaart, of dat er geen zijn.`;

async function bouwFeitenkaartVoorProces(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  procedureId: string
): Promise<Feitenkaart | null> {
  const { data: decRows } = await supabase
    .from("decision_objects")
    .select("id, besluit_code, is_primary_decision")
    .eq("procedure_id", procedureId)
    .order("is_primary_decision", { ascending: false });
  const decisionMeta = (decRows ?? []) as { id: string; besluit_code: string; is_primary_decision: boolean }[];
  if (decisionMeta.length === 0) return null;

  const decisions: DecisionDossierView[] = [];
  for (const dm of decisionMeta) {
    decisions.push(await buildDecisionDossierView(supabase, dm.id, { autoUpgraded: false }));
  }

  const { data: logRows } = await supabase
    .from("procedure_log")
    .select("id, procedure_id, event_type, actor_naam, payload, tijdstip")
    .eq("procedure_id", procedureId)
    .order("tijdstip", { ascending: true });

  const primair = decisionMeta.find((d) => d.is_primary_decision) ?? decisionMeta[0];
  const bron: AfschriftBron = {
    context: {
      afschriftId: "concept",
      procescode: primair.besluit_code || `PROC-${procedureId.slice(0, 8)}`,
      versie: "actueel",
      aanleiding: null,
      aangemaaktOp: new Date().toISOString(),
      aangemaaktDoorNaam: null,
      gebouwdOnderRol: null,
      generatorVersie: "t6-concept",
    },
    decisions,
    procedureLog: (logRows ?? []) as ProcedureLogEntry[],
  };
  return bouwFeitenkaart(bron);
}

export const POST = withFondsRoute({ capability: "procedures.manage", hostGuard: true, label: "procedures.afschrift.concept.POST" }, async (ctx, req: NextRequest, params) => {
  try {
    const { id: procedureId } = params as { id: string };
    const supabase = ctx.supabase;

    if (isBureauRol(ctx.rol)) {
      return NextResponse.json(
        { error: "Het afschrift bevat stemgedrag per bestuurslid en is niet beschikbaar voor het bestuursbureau." },
        { status: 403 }
      );
    }

    // Besluit 0180: fail-closed op dit kostendragende pad. Drempel ongewijzigd.
    const limiet = await controleerLimiet(supabase, LIMIETEN.afschrift_concept, {
      failClosed: true,
    });
    if (!limiet.toegestaan) return rateLimited("procedures.afschrift-concept", limiet.resetAt);

    const feitenkaart = await bouwFeitenkaartVoorProces(supabase, procedureId);
    if (!feitenkaart) {
      return NextResponse.json({ error: "Geen besluiten aan dit proces gekoppeld." }, { status: 404 });
    }

    // Deterministisch sjabloon = altijd de terugval.
    const sjabloon = bouwSjabloonProza(feitenkaart);

    // Geen key → sjabloon, geen fout richting gebruiker (AC fase-2 2).
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({
        tekst: sjabloon,
        aiGebruikt: false,
        model: null,
        promptversie: AFSCHRIFT_PROMPTVERSIE,
        reden: "Geen AI-sleutel geconfigureerd; deterministisch sjabloon gebruikt.",
      });
    }

    // AI-BEGRENZING (besluit 0180): één conceptleeswijzer = één AI-actie.
    // Blokkeert de begrenzing, dan valt deze route terug op het DETERMINISTISCHE
    // sjabloon — dat bestaat hier al als volwaardig alternatief, dus een
    // gestopte AI hoeft de gebruiker niets te kosten.
    const idempotentie = sleutelUitRequest(req, "afschrift_concept");
    if (!idempotentie) {
      return badRequest(
        "procedures.afschrift-concept",
        "Verzoek mist een geldige Idempotency-Key. Vernieuw de pagina en probeer het opnieuw."
      );
    }
    const pf = await preflight(supabase, {
      actietype: "afschrift_concept",
      provider: "anthropic",
      model: AFSCHRIFT_AI_MODEL,
      idempotentie,
      vingerafdruk: vingerafdruk({ procedureId }),
    });
    if (pf.uitkomst !== "nieuw") {
      return NextResponse.json({
        tekst: sjabloon,
        aiGebruikt: false,
        model: AFSCHRIFT_AI_MODEL,
        promptversie: AFSCHRIFT_PROMPTVERSIE,
        reden:
          "AI-generatie is op dit moment niet beschikbaar; deterministisch sjabloon gebruikt.",
      });
    }
    const aiActieId = pf.actieId;

    try {
      const respons = await bewaakteAnthropic(
        { supabase, label: "procedures.afschrift-concept" },
        AFSCHRIFT_AI_MODEL,
        (client) => client.messages.create({
        model: AFSCHRIFT_AI_MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(feitenkaart) }],
        })
      );
      const blok = respons.content.find((c) => c.type === "text");
      const ruw = blok && blok.type === "text" ? blok.text : "";
      const schoon = ruw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(schoon) as {
        hoeVerlopen?: string;
        watVastgelegd?: string;
        bijzonderheden?: string;
      };
      const tekst = {
        hoeVerlopen: String(parsed.hoeVerlopen ?? ""),
        watVastgelegd: String(parsed.watVastgelegd ?? ""),
        bijzonderheden: String(parsed.bijzonderheden ?? ""),
      };

      // Guardrail (G2): elke datum/getal/eigennaam moet in de feitenkaart staan.
      const geheel = `${tekst.hoeVerlopen}\n${tekst.watVastgelegd}\n${tekst.bijzonderheden}`;
      const toets = toetsLeeswijzerTegenFeitenkaart(geheel, feitenkaart);
      if (!toets.ok || !tekst.hoeVerlopen.trim()) {
        return NextResponse.json({
          tekst: sjabloon,
          aiGebruikt: false,
          model: AFSCHRIFT_AI_MODEL,
          promptversie: AFSCHRIFT_PROMPTVERSIE,
          reden: toets.ok
            ? "AI leverde lege tekst; deterministisch sjabloon gebruikt."
            : `Guardrail afgekeurd (${toets.overtredingen.slice(0, 3).join("; ")}); deterministisch sjabloon gebruikt.`,
        });
      }

      await rondAf(supabase, aiActieId, "voltooid", `procedure:${procedureId}`);
      return NextResponse.json({
        tekst,
        aiGebruikt: true,
        model: AFSCHRIFT_AI_MODEL,
        promptversie: AFSCHRIFT_PROMPTVERSIE,
      });
    } catch (aiFout) {
      console.error("Afschrift-concept AI-call mislukt (terugval sjabloon):", aiFout);
      return NextResponse.json({
        tekst: sjabloon,
        aiGebruikt: false,
        model: AFSCHRIFT_AI_MODEL,
        promptversie: AFSCHRIFT_PROMPTVERSIE,
        reden: "AI-generatie mislukte; deterministisch sjabloon gebruikt.",
      });
    }
  } catch (e) {
    console.error("Fout in POST /api/procedures/[id]/afschrift/concept:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
