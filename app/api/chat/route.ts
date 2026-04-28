import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase-server";
import { zoekRelevanteChunks, maakContext, type DocumentChunk, type BronVerwijzing } from "@/lib/rag";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

type Modus = "documenten" | "combineren" | "algemeen";

// ============================================================
//  Systeemprompts per modus
// ============================================================

const SP_DOCUMENTEN = `Je bent een AI-assistent voor het bestuurdersportaal van een Nederlands pensioenfonds.
Je beantwoordt vragen UITSLUITEND op basis van de aangeleverde bronnen.

REGELS:
1. Gebruik ALLEEN informatie uit de bronnen die je hebt gekregen. Verzin niets.
2. Verwijs altijd naar de specifieke bron met [Bron X] notatie.
3. Als de bronnen het antwoord niet bevatten, zeg dat dan expliciet en stel voor welk soort document de gebruiker zou kunnen uploaden.
4. Schrijf in duidelijk Nederlands, geschikt voor bestuurders.
5. Wees precies over paragraafnummers en paginanummers als die beschikbaar zijn.
6. Sluit elk antwoord af met een beknopte samenvatting van de gebruikte bronnen.

TOON: Professioneel, bondig, feitelijk. Geen onnodige uitweidingen.`;

const SP_ALGEMEEN = `Je bent een AI-assistent voor het bestuurdersportaal van een Nederlands pensioenfonds.
Je beantwoordt vragen op basis van je algemene kennis over Nederlandse pensioenwetgeving,
pensioenadministratie, governance, beleggen, risico-management en de Wet toekomst pensioenen (Wtp).

REGELS:
1. Gebruik je algemene kennis om de vraag zo nuttig mogelijk te beantwoorden.
2. Wees expliciet over wat je niet zeker weet of wat na je trainingsdatum kan zijn veranderd — wetgeving en richtlijnen wijzigen regelmatig.
3. Verwijs bij feitelijke claims over wet- en regelgeving naar de bron-instantie (DNB, AFM, Pensioenfederatie, rijksoverheid, SZW) zonder specifieke documentlink te suggereren.
4. Markeer claims duidelijk met [Algemene kennis] of [Volgens wetgeving] in plaats van [Bron X].
5. Schrijf in duidelijk Nederlands, geschikt voor bestuurders.
6. Sluit af met een korte disclaimer dat dit antwoord NIET op interne fondsdocumenten is gebaseerd en geverifieerd moet worden voor formele besluitvorming.

TOON: Professioneel, behulpzaam, voorzichtig waar dat nodig is.`;

const SP_COMBINEREN = `Je bent een AI-assistent voor het bestuurdersportaal van een Nederlands pensioenfonds.
Je beantwoordt vragen primair op basis van de aangeleverde interne bronnen, en mag aanvullen met je algemene kennis waar dat de vraag beter beantwoordt.

REGELS:
1. Gebruik DE BRONNEN waar mogelijk — markeer claims uit interne documenten met [Bron X].
2. Vul aan met algemene kennis waar de bronnen geen antwoord geven — markeer die claims expliciet met [Algemene kennis].
3. Maak het altijd glashelder welke informatie waarvandaan komt; geen vermenging zonder labeling.
4. Verzin geen specifieke feiten over dit fonds; alleen wat in de aangeleverde bronnen staat.
5. Bij algemene kennis: noem de bron-instantie (DNB, AFM, Pensioenfederatie, rijksoverheid) zonder een specifieke documentlink te suggereren.
6. Schrijf in duidelijk Nederlands, geschikt voor bestuurders.
7. Sluit elk antwoord af met een samenvatting waarin je interne bronnen en algemene kennis afzonderlijk benoemt.

TOON: Professioneel, bondig, feitelijk.`;

// ============================================================
//  POST handler
// ============================================================
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      vraag?: string;
      fonds_id?: string;
      modus?: Modus;
    };
    const { vraag, fonds_id } = body;
    const modus: Modus = body.modus || "documenten";

    if (!vraag || !fonds_id) {
      return NextResponse.json(
        { error: "Vraag en fonds_id zijn verplicht" },
        { status: 400 }
      );
    }

    // Authenticatie
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    // Profiel ophalen
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, rol")
      .eq("id", user.id)
      .single();

    // RAG-zoeken alleen voor modi waar we dat nodig hebben
    let chunks: DocumentChunk[] = [];
    let bronnen: BronVerwijzing[] = [];
    let contextTekst = "";

    if (modus === "documenten" || modus === "combineren") {
      chunks = await zoekRelevanteChunks(vraag, fonds_id);
      const ctx = maakContext(chunks);
      contextTekst = ctx.contextTekst;
      bronnen = ctx.bronnen;
    }

    // Bouw prompt op basis van modus
    let systeemPrompt: string;
    let gebruikersPrompt: string;

    if (modus === "algemeen") {
      systeemPrompt = SP_ALGEMEEN;
      gebruikersPrompt = `VRAAG VAN BESTUURSLID: ${vraag}`;
    } else if (modus === "combineren") {
      systeemPrompt = SP_COMBINEREN;
      gebruikersPrompt =
        chunks.length > 0
          ? `BESCHIKBARE INTERNE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG VAN BESTUURSLID: ${vraag}`
          : `Er zijn geen interne documenten gevonden die direct relevant zijn voor deze vraag.\n\nVRAAG: ${vraag}\n\nGebruik je algemene kennis om de vraag zo goed mogelijk te beantwoorden, en markeer claims met [Algemene kennis]. Sluit af met een opmerking dat er geen interne bronnen zijn gevonden.`;
    } else {
      // documenten (huidige strikte modus)
      systeemPrompt = SP_DOCUMENTEN;
      gebruikersPrompt =
        chunks.length > 0
          ? `BESCHIKBARE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG VAN BESTUURSLID: ${vraag}`
          : `Er zijn geen relevante documenten gevonden voor deze vraag.\n\nVRAAG: ${vraag}\n\nGeef aan dat je geen relevante bronnen hebt gevonden en stel voor welk type document de gebruiker zou kunnen uploaden.`;
    }

    // Roep Claude aan
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      system: systeemPrompt,
      messages: [{ role: "user", content: gebruikersPrompt }],
    });

    const antwoord =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Sla op in governance log (incl. modus)
    await supabase.from("governance_log").insert({
      gebruiker_id: user.id,
      gebruiker_naam: profiel?.naam || user.email,
      fonds_id,
      vraag,
      antwoord,
      bronnen,
      modus,
      model: "claude-sonnet-4-5",
    });

    return NextResponse.json({
      antwoord,
      bronnen,
      modus,
      chunks_gevonden: chunks.length,
    });
  } catch (error) {
    console.error("Chat API fout:", error);
    return NextResponse.json(
      { error: "Er is een fout opgetreden bij het verwerken van uw vraag." },
      { status: 500 }
    );
  }
}
