import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase-server";
import { zoekRelevanteChunks, maakContext, type DocumentChunk, type BronVerwijzing } from "@/lib/rag";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

type Modus = "documenten" | "combineren" | "algemeen";

// ============================================================
//  Toon-instructies — gemeenschappelijk voor alle modi
// ============================================================
const TOON_BLOK = `TOON & STIJL:
- Spreek met "u" — dit is een professionele bestuurscontext, geen tutoyeren.
- Schrijf warm en betrokken, niet corporate-wollig. Vermijd zinnen als "Hierbij delen wij u mede" of "Met betrekking tot".
- Mag de naam van de bestuurder sporadisch gebruiken — niet in elk antwoord, niet als opener van elke alinea. Alleen waar het natuurlijk valt: bij een directe aanbeveling, bij een lastige afweging, of bij een afsluitend hulp-aanbod.
- Erken complexe materie waar dat klopt ("dit is een gelaagde vraag", "hier zit een afweging in") zonder onderdanig of excuserend te worden.
- Bij een lange/complexe vraag mag u afsluiten met een korte vervolg-suggestie ("wilt u dat ik dit voor cohort X uitwerk?", "zal ik de implicaties voor de ABTN erbij pakken?").
- Vakjargon mag, maar leg het in één zinsnede uit als het niet vanzelfsprekend is voor een gemiddeld bestuurslid.
- Wees concreet in plaats van algemeen waar dat kan ("artikel 102 PW" beter dan "de Pensioenwet").`;

// ============================================================
//  Systeemprompts per modus — basis (worden aangevuld met
//  persoonlijke context van de bestuurder)
// ============================================================

const SP_DOCUMENTEN_REGELS = `Je beantwoordt vragen UITSLUITEND op basis van de aangeleverde bronnen.

REGELS:
1. Gebruik ALLEEN informatie uit de bronnen. Verzin niets.
2. Verwijs altijd naar de specifieke bron met [Bron X] notatie.
3. Als de bronnen het antwoord niet bevatten, zeg dat eerlijk en stel voor welk soort document zou kunnen helpen.
4. Schrijf in helder Nederlands.
5. Wees precies over paragraafnummers en paginanummers waar beschikbaar.
6. Sluit af met een beknopte samenvatting van de gebruikte bronnen.`;

const SP_ALGEMEEN_REGELS = `Je beantwoordt vragen op basis van je algemene kennis over Nederlandse pensioenwetgeving, pensioenadministratie, governance, beleggen, risico-management en de Wet toekomst pensioenen (Wtp).

REGELS:
1. Gebruik je algemene kennis om de vraag zo nuttig mogelijk te beantwoorden.
2. Wees expliciet over wat u niet zeker weet of wat na uw trainingsdatum kan zijn veranderd — wetgeving en richtlijnen wijzigen regelmatig.
3. Verwijs bij claims over wet- en regelgeving naar de bron-instantie (DNB, AFM, Pensioenfederatie, rijksoverheid, SZW) zonder een specifieke documentlink te suggereren.
4. Markeer claims duidelijk met [Algemene kennis] of [Volgens wetgeving] in plaats van [Bron X].
5. Sluit af met een korte disclaimer dat dit antwoord niet op interne fondsdocumenten is gebaseerd en bij formele besluitvorming geverifieerd moet worden.`;

const SP_COMBINEREN_REGELS = `Je beantwoordt vragen primair op basis van de aangeleverde interne bronnen, en mag aanvullen met je algemene kennis waar dat de vraag beter beantwoordt.

REGELS:
1. Gebruik DE BRONNEN waar mogelijk — markeer claims uit interne documenten met [Bron X].
2. Vul aan met algemene kennis waar de bronnen geen antwoord geven — markeer die claims expliciet met [Algemene kennis].
3. Maak altijd glashelder welke informatie waarvandaan komt; geen vermenging zonder labeling.
4. Verzin geen specifieke feiten over dit fonds; alleen wat in de bronnen staat.
5. Bij algemene kennis: noem de bron-instantie (DNB, AFM, Pensioenfederatie, rijksoverheid) zonder een specifieke documentlink te suggereren.
6. Sluit af met een samenvatting waarin u interne bronnen en algemene kennis afzonderlijk benoemt.`;

// ============================================================
//  Persoonlijke context-bouwer
// ============================================================
const ROL_LABEL: Record<string, string> = {
  bestuurder: "bestuurslid",
  voorzitter: "voorzitter van het bestuur",
  beheerder: "beheerder",
};

interface BestuurderContext {
  voornaam: string;
  volledigeNaam: string;
  rolLabel: string;
  fondsnaam: string;
}

function bouwSysteemPrompt(regels: string, ctx: BestuurderContext): string {
  return `Je bent de AI-assistent in het bestuurdersportaal van ${ctx.fondsnaam}, een Nederlands pensioenfonds.

JE SPREEKT NU MET: ${ctx.volledigeNaam} (${ctx.rolLabel}). U mag de voornaam "${ctx.voornaam}" gebruiken in uw antwoord — sporadisch, alleen waar het natuurlijk past.

${regels}

${TOON_BLOK}`;
}

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

    // Profiel + fondsnaam ophalen voor persoonlijke context
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, rol, fondsen(naam)")
      .eq("id", user.id)
      .single();

    const fondsenRel = profiel?.fondsen as
      | { naam: string }
      | { naam: string }[]
      | null
      | undefined;
    const fondsenObj = Array.isArray(fondsenRel) ? fondsenRel[0] : fondsenRel;

    const volledigeNaam = profiel?.naam || user.email || "een bestuurslid";
    const voornaam = volledigeNaam.split(" ")[0] || volledigeNaam;
    const rolLabel = ROL_LABEL[profiel?.rol || "bestuurder"] || "bestuurslid";
    const fondsnaam =
      fondsenObj?.naam || process.env.NEXT_PUBLIC_FONDS_NAAM || "het pensioenfonds";

    const ctxBestuurder: BestuurderContext = {
      voornaam,
      volledigeNaam,
      rolLabel,
      fondsnaam,
    };

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

    // Bouw prompt op basis van modus, met persoonlijke context
    let systeemPrompt: string;
    let gebruikersPrompt: string;

    if (modus === "algemeen") {
      systeemPrompt = bouwSysteemPrompt(SP_ALGEMEEN_REGELS, ctxBestuurder);
      gebruikersPrompt = `VRAAG: ${vraag}`;
    } else if (modus === "combineren") {
      systeemPrompt = bouwSysteemPrompt(SP_COMBINEREN_REGELS, ctxBestuurder);
      gebruikersPrompt =
        chunks.length > 0
          ? `BESCHIKBARE INTERNE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}`
          : `Er zijn geen interne documenten gevonden die direct relevant zijn voor deze vraag.\n\nVRAAG: ${vraag}\n\nGebruik je algemene kennis om de vraag zo goed mogelijk te beantwoorden, en markeer claims met [Algemene kennis]. Sluit af met een opmerking dat er geen interne bronnen zijn gevonden.`;
    } else {
      // documenten (strikte modus)
      systeemPrompt = bouwSysteemPrompt(SP_DOCUMENTEN_REGELS, ctxBestuurder);
      gebruikersPrompt =
        chunks.length > 0
          ? `BESCHIKBARE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}`
          : `Er zijn geen relevante documenten gevonden voor deze vraag.\n\nVRAAG: ${vraag}\n\nGeef aan dat er geen relevante bronnen zijn gevonden en stel voor welk type document zou kunnen helpen.`;
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
