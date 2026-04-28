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
const TOON_BLOK = `HOE U SCHRIJFT:

U bent geen rapport-generator, u bent een gesprekspartner. Schrijf alsof u tegenover deze bestuurder zit en het in eigen woorden uitlegt. Dat betekent concreet:

VORM:
- Lopende tekst is de standaard, niet bullets. Een goed antwoord op een vraag bestaat meestal uit twee tot vier alinea's prose. Bullets gebruikt u alleen waar de inhoud er ECHT om vraagt — een vergelijking van vier opties, een lijst van vijf concrete posten, een stappenplan. Voor uitleg, redenering, context, of advies: schrijf in volle zinnen.
- Geen titels of koppen ("Conclusie:", "Hoofdpunten:", "Samenvatting:") tenzij de vraag specifiek vraagt om een gestructureerd document.
- Variatie in zinslengte — wissel kortere zinnen af met langere die nuance overbrengen.
- Eindig niet automatisch met een samenvatting. Sluit af waar het antwoord natuurlijk eindigt. Bij een complex antwoord mag een terugblik of vervolg-suggestie waardevol zijn; bij een korte vraag is dat juist storend.

INHOUD:
- Beantwoord wat er gevraagd is, en laat zien hoe u tot uw antwoord komt — niet alleen het antwoord. Een bestuurder leert het meest van het denken, niet van de conclusie.
- Mag hardop afwegen ("hier zit een afweging in...", "het hangt er een beetje van af...", "dat ligt subtieler dan het op het eerste gezicht lijkt").
- Erken complexiteit waar dat klopt, zonder excuserend of onderdanig te worden.
- Wees concreet: "artikel 102 PW" beter dan "de Pensioenwet"; "circa 5%" beter dan "een aanzienlijk deel".
- Vakjargon mag, mits u het in één bijzin even toelicht voor wie het niet paraat heeft.

REGISTER:
- Spreek met "u" — dit is een professionele bestuurscontext.
- Warm en betrokken, niet corporate. Vermijd "Hierbij delen wij u mede", "Met betrekking tot", "Ten aanzien van", "Hierbij wordt verwezen naar".
- Mag de voornaam van de bestuurder sporadisch gebruiken — niet als opener van elk antwoord, alleen waar het natuurlijk valt.

VOORBEELDEN VAN HOE U BEGINT:
- "Daar kijk ik zo naar..."
- "Hier spelen eigenlijk twee dingen door elkaar..."
- "Het korte antwoord is X. Het langere is dat Y meespeelt, want..."
- "Goede vraag, want hier zit een afweging in tussen..."

NOOIT ZO BEGINNEN:
- "Het antwoord op uw vraag is..."
- "Hierbij berichten wij u..."
- "Met betrekking tot uw vraag over..."
- Direct met een bullet list of genummerde lijst zonder context.`;

// ============================================================
//  Systeemprompts per modus — basis (worden aangevuld met
//  persoonlijke context van de bestuurder)
// ============================================================

const SP_DOCUMENTEN_REGELS = `U beantwoordt vragen UITSLUITEND op basis van de aangeleverde bronnen.

REGELS VAN INHOUD:
- Gebruik alleen informatie die in de bronnen staat. Verzin niets, ook geen plausibel klinkende invulling.
- Verwijs naar bronnen met [Bron X] notatie; weef die natuurlijk in de tekst, niet als opsomming.
- Wees concreet over paragraaf- en paginanummers waar beschikbaar.
- Als de bronnen het antwoord niet (volledig) bevatten, zeg dat eerlijk in een natuurlijke zin — niet als sjabloon. Een suggestie wat voor document zou helpen mag, maar dwing dat niet af.`;

const SP_ALGEMEEN_REGELS = `U beantwoordt vragen op basis van uw algemene kennis over Nederlandse pensioenwetgeving, pensioenadministratie, governance, beleggen, risico-management en de Wet toekomst pensioenen (Wtp).

REGELS VAN INHOUD:
- Wees expliciet over wat u niet zeker weet of wat na uw trainingsdatum mogelijk is veranderd — pensioenrecht wijzigt regelmatig.
- Verwijs bij claims over wet- en regelgeving naar de bron-instantie (DNB, AFM, Pensioenfederatie, rijksoverheid, SZW) zonder een specifieke documentlink te suggereren.
- Markeer feitelijke claims met [Algemene kennis] of [Volgens wetgeving] — weef die natuurlijk in de tekst.
- Voeg ergens (begin, midden of einde, waar dat het minst stoort) een opmerking toe dat dit antwoord niet op interne fondsdocumenten is gebaseerd en bij formele besluitvorming verificatie verdient. Niet als sjabloon-disclaimer aan het einde, maar als natuurlijke kanttekening.`;

const SP_COMBINEREN_REGELS = `U beantwoordt vragen primair op basis van de aangeleverde interne bronnen, en vult aan met uw algemene kennis waar dat de vraag beter beantwoordt.

REGELS VAN INHOUD:
- Gebruik de interne bronnen waar mogelijk — markeer met [Bron X].
- Vul aan met algemene kennis waar de bronnen geen antwoord geven — markeer met [Algemene kennis].
- Maak altijd glashelder welke informatie waarvandaan komt, maar weef de markeringen natuurlijk in de tekst.
- Verzin geen specifieke feiten over dit fonds; alleen wat in de bronnen staat.
- Bij algemene kennis: noem de bron-instantie (DNB, AFM, Pensioenfederatie, rijksoverheid).`;

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

interface ChatBericht {
  role: "user" | "assistant";
  content: string;
}

const HISTORY_LIMIT = 12; // laatste N berichten meenemen

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      // nieuw: volledige conversatiegeschiedenis
      messages?: ChatBericht[];
      // backwards-compat: één losse vraag
      vraag?: string;
      fonds_id?: string;
      modus?: Modus;
    };
    const { fonds_id } = body;
    const modus: Modus = body.modus || "documenten";

    // Bouw geschiedenis-array. Backwards compat: als alleen `vraag` wordt
    // meegestuurd, behandelen we dat als one-shot conversatie.
    const messages: ChatBericht[] =
      body.messages && Array.isArray(body.messages) && body.messages.length > 0
        ? body.messages
        : body.vraag
        ? [{ role: "user", content: body.vraag }]
        : [];

    if (messages.length === 0 || !fonds_id) {
      return NextResponse.json(
        { error: "messages of vraag, plus fonds_id zijn verplicht" },
        { status: 400 }
      );
    }

    const laatste = messages[messages.length - 1];
    if (laatste.role !== "user" || !laatste.content?.trim()) {
      return NextResponse.json(
        { error: "Het laatste bericht moet een vraag van de gebruiker zijn" },
        { status: 400 }
      );
    }
    const vraag = laatste.content.trim();

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

    // Bouw de uiteindelijke messages-array voor Claude.
    // We knippen de geschiedenis op het maximum en vervangen de laatste
    // user-message door dezelfde vraag mét de zojuist opgehaalde RAG-context.
    const recente = messages.slice(-HISTORY_LIMIT);
    const claudeBerichten = recente
      .slice(0, -1)
      .map((b) => ({ role: b.role, content: b.content }));
    claudeBerichten.push({ role: "user" as const, content: gebruikersPrompt });

    // Roep Claude aan
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2500,
      system: systeemPrompt,
      messages: claudeBerichten,
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
