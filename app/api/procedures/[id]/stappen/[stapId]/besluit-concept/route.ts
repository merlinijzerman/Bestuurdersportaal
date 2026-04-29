import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase-server";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `U bent een ervaren bestuurssecretaris bij een Nederlands pensioenfonds.

Uw taak: schrijf een conceptformulering voor een formeel bestuursbesluit. Gebruik de meegeleverde context (procedure-omschrijving, eerdere stappen met hun bewijs, eventuele inbreng) om een kort, helder besluit op te stellen.

LET OP:
- U schrijft een CONCEPT — de bestuurder reviewt en past aan voor finale vastlegging.
- Schrijf in zakelijke maar warme bestuurstaal. Geen jargon-uitstoot, geen kantoorklanken zoals "Hierbij wordt vastgesteld dat...".
- De besluit-formulering is één tot drie zinnen, concreet en eenduidig.
- De motivering legt uit WAAROM dit besluit, in twee tot vier zinnen, in lopende tekst (geen bullets).
- Verwijs naar bewijsstukken alleen als dat het besluit logischer maakt — niet als opsomming.
- Als de context onvoldoende is om een gefundeerd besluit op te stellen, geef je dat aan via het veld "onvoldoende_context" (boolean) en laat formulering en motivering leeg.

UITVOER: alleen JSON, geen markdown of toelichting eromheen, in dit exacte formaat:
{
  "formulering": "...",
  "motivering": "...",
  "onvoldoende_context": false
}`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stapId: string }> }
) {
  try {
    const { id, stapId } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    // Verifieer stap + procedure (RLS doet de fonds-check)
    const { data: stap } = await supabase
      .from("procedure_stappen")
      .select("id, naam, beschrijving, vereist_besluit, procedure_id, procedures(titel, beschrijving)")
      .eq("id", stapId)
      .eq("procedure_id", id)
      .single();
    if (!stap) {
      return NextResponse.json(
        { error: "Stap niet gevonden" },
        { status: 404 }
      );
    }
    if (!stap.vereist_besluit) {
      return NextResponse.json(
        { error: "Deze stap vereist geen besluit" },
        { status: 400 }
      );
    }

    const procedureRel = stap.procedures as
      | { titel: string; beschrijving: string | null }
      | { titel: string; beschrijving: string | null }[]
      | null
      | undefined;
    const procedure = Array.isArray(procedureRel)
      ? procedureRel[0]
      : procedureRel;

    // Haal alle eerdere stappen + hun bewijs + checklist op
    const { data: alleStappen } = await supabase
      .from("procedure_stappen")
      .select("id, volgorde, naam, beschrijving, status, voltooid_op")
      .eq("procedure_id", id)
      .order("volgorde", { ascending: true });
    const stappenLijst = alleStappen || [];

    const { data: alleChecklist } = await supabase
      .from("procedure_checklist")
      .select("stap_id, label, voldaan, opmerking")
      .in(
        "stap_id",
        stappenLijst.map((s: { id: string }) => s.id)
      );

    const { data: alleBewijs } = await supabase
      .from("procedure_bewijs")
      .select("stap_id, titel, beschrijving")
      .in(
        "stap_id",
        stappenLijst.map((s: { id: string }) => s.id)
      );

    // Bouw context-tekst voor Claude
    const contextRegels: string[] = [
      `PROCEDURE: ${procedure?.titel ?? "(geen titel)"}`,
      procedure?.beschrijving ? `\nProcedure-omschrijving:\n${procedure.beschrijving}` : "",
      `\n\nHUIDIGE STAP (waarvoor besluit nodig is): ${stap.naam}`,
      stap.beschrijving ? `Stap-omschrijving: ${stap.beschrijving}` : "",
      "\n\n=== DOORLOPEN STAPPEN ===",
    ];

    for (const s of stappenLijst as Array<{
      id: string;
      volgorde: number;
      naam: string;
      beschrijving: string | null;
      status: string;
    }>) {
      if (s.status !== "afgerond") continue;
      contextRegels.push(`\n--- Stap ${s.volgorde}: ${s.naam} ---`);
      if (s.beschrijving) contextRegels.push(s.beschrijving);

      const checks = (alleChecklist || []).filter(
        (c: { stap_id: string }) => c.stap_id === s.id
      );
      if (checks.length > 0) {
        contextRegels.push("Checklist:");
        for (const c of checks as Array<{
          label: string;
          voldaan: boolean;
          opmerking: string | null;
        }>) {
          contextRegels.push(
            `  ${c.voldaan ? "[v]" : "[ ]"} ${c.label}${c.opmerking ? ` — ${c.opmerking}` : ""}`
          );
        }
      }

      const bewijzen = (alleBewijs || []).filter(
        (b: { stap_id: string }) => b.stap_id === s.id
      );
      if (bewijzen.length > 0) {
        contextRegels.push("Bewijsstukken:");
        for (const b of bewijzen as Array<{
          titel: string;
          beschrijving: string | null;
        }>) {
          contextRegels.push(
            `  - ${b.titel}${b.beschrijving ? ` — ${b.beschrijving}` : ""}`
          );
        }
      }
    }

    const userMessage = contextRegels.filter(Boolean).join("\n");

    const respons = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    // Pak de tekst uit het antwoord en parse JSON
    const blok = respons.content.find((c) => c.type === "text");
    const ruweTekst = blok && blok.type === "text" ? blok.text.trim() : "";
    let concept: {
      formulering?: string;
      motivering?: string;
      onvoldoende_context?: boolean;
    } = {};
    try {
      // Soms wraps Claude in ```json ... ``` — strip dat indien aanwezig
      const cleaned = ruweTekst
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "");
      concept = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        {
          error:
            "Concept kon niet als JSON geparseerd worden. Probeer opnieuw.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      formulering: concept.formulering ?? "",
      motivering: concept.motivering ?? "",
      onvoldoende_context: concept.onvoldoende_context ?? false,
    });
  } catch (e) {
    console.error("Fout in besluit-concept-route:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
