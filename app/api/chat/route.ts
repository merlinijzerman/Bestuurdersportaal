import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase-server";
import { zoekRelevanteChunks, maakContext } from "@/lib/rag";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEEM_PROMPT = `Je bent een AI-assistent voor het bestuurdersportaal van een Nederlands pensioenfonds.
Je beantwoordt vragen van bestuursleden op basis van UITSLUITEND de aangeleverde bronnen.

REGELS:
1. Gebruik ALLEEN informatie uit de bronnen die je hebt gekregen. Verzin niets.
2. Verwijs altijd naar de specifieke bron met [Bron X] notatie.
3. Als de bronnen het antwoord niet bevatten, zeg dat dan expliciet.
4. Schrijf in duidelijk Nederlands, geschikt voor bestuurders.
5. Wees precies over paragraafnummers en paginanummers als die beschikbaar zijn.
6. Sluit elk antwoord af met een beknopte samenvatting van de gebruikte bronnen.

TOON: Professioneel, bondig, feitelijk. Geen onnodige uitweidingen.`;

export async function POST(req: NextRequest) {
  try {
    const { vraag, fonds_id } = await req.json();

    if (!vraag || !fonds_id) {
      return NextResponse.json(
        { error: "Vraag en fonds_id zijn verplicht" },
        { status: 400 }
      );
    }

    // Controleer authenticatie
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    // Haal gebruikersprofiel op
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, rol")
      .eq("id", user.id)
      .single();

    // Zoek relevante chunks
    const chunks = await zoekRelevanteChunks(vraag, fonds_id);
    const { contextTekst, bronnen } = maakContext(chunks);

    // Bouw de prompt
    const gebruikersPrompt =
      chunks.length > 0
        ? `BESCHIKBARE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG VAN BESTUURSLID: ${vraag}`
        : `Er zijn geen relevante documenten gevonden voor deze vraag.\n\nVRAAG: ${vraag}\n\nGeef aan dat je geen relevante bronnen hebt gevonden en stel voor welk type document de gebruiker zou kunnen uploaden.`;

    // Roep Claude aan
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      system: SYSTEEM_PROMPT,
      messages: [{ role: "user", content: gebruikersPrompt }],
    });

    const antwoord =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Sla op in governance log
    await supabase.from("governance_log").insert({
      gebruiker_id: user.id,
      gebruiker_naam: profiel?.naam || user.email,
      fonds_id,
      vraag,
      antwoord,
      bronnen: bronnen,
      model: "claude-sonnet-4-5",
    });

    return NextResponse.json({
      antwoord,
      bronnen,
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
