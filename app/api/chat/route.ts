import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase-server";
import { zoekRelevanteChunksMetMeta, maakContext, type DocumentChunk, type BronVerwijzing, type RetrievalMeta } from "@/lib/rag";
import { heeftReformulatieNodig, reformuleerVraag } from "@/lib/query-reformulatie";
import { controleerLimiet, LIMIETEN } from "@/lib/rate-limit";
import { rateLimited } from "@/lib/api-errors";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Centrale model- en budget-instellingen. Eén plek zodat chat-call én
// governance_log altijd dezelfde waarde gebruiken (auditability).
// LET OP: verifieer dat deze modelstring beschikbaar is in het Anthropic-account
// vóór deploy.
const AI_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 3200;
const CHUNK_BUDGET = 10;
// Snel, goedkoop model voor de history-aware query-reformulatie (Fase B1).
const REWRITE_MODEL = "claude-haiku-4-5-20251001";

// Feature-flag: bestuurlijke antwoordstijl (antwoordstatus + adaptieve
// lichte/volledige structuur). Default uit → huidige gesprekspartner-stijl.
const BESTUURLIJKE_STIJL = process.env.BESTUURLIJKE_STIJL === "on";
// De bestuurlijke stijl levert langere, gestructureerde antwoorden; iets ruimer
// tokenbudget zodat het volledige raamwerk niet wordt afgekapt.
const MAX_TOKENS_BESTUURLIJK = 4500;

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
- Verwijs naar bronnen met de notatie [Bron N], waarbij N het getal is van het bron-label uit de aangeleverde context.
- Plaats de marker bij élke feitelijke claim, niet alleen één keer per alinea — een bestuurder moet bij iedere uitspraak kunnen zien waar die op steunt.
- Schrijf elke verwijzing als een afzonderlijke marker: [Bron 1][Bron 2] in plaats van [Bron 1, 2] of [Bron 1 en 2]. Dat geldt ook bij meerdere bronnen achter dezelfde claim.
- Plaats de marker direct ná de claim, vóór de leesteken-pauze. Dus: "Bestuurders moeten jaarlijks een deskundigheidstoets doorlopen [Bron 1]." en niet "[Bron 1] Bestuurders moeten...".
- Wees concreet over paragraaf- en paginanummers waar beschikbaar — die staan tussen haakjes bij elk bron-label.
- Als de bronnen het antwoord niet (volledig) bevatten, zeg dat eerlijk in een natuurlijke zin — niet als sjabloon. Een suggestie wat voor document zou helpen mag, maar dwing dat niet af.`;

const SP_ALGEMEEN_REGELS = `U beantwoordt vragen op basis van uw algemene kennis over Nederlandse pensioenwetgeving, pensioenadministratie, governance, beleggen, risico-management en de Wet toekomst pensioenen (Wtp).

REGELS VAN INHOUD:
- Wees expliciet over wat u niet zeker weet of wat na uw trainingsdatum mogelijk is veranderd — pensioenrecht wijzigt regelmatig.
- Verwijs bij claims over wet- en regelgeving naar de bron-instantie (DNB, AFM, Pensioenfederatie, rijksoverheid, SZW) zonder een specifieke documentlink te suggereren.
- Markeer feitelijke claims met [Algemene kennis] of [Volgens wetgeving] — weef die natuurlijk in de tekst.
- Voeg ergens (begin, midden of einde, waar dat het minst stoort) een opmerking toe dat dit antwoord niet op interne fondsdocumenten is gebaseerd en bij formele besluitvorming verificatie verdient. Niet als sjabloon-disclaimer aan het einde, maar als natuurlijke kanttekening.`;

const SP_COMBINEREN_REGELS = `U beantwoordt vragen primair op basis van de aangeleverde interne bronnen, en vult aan met uw algemene kennis waar dat de vraag beter beantwoordt.

REGELS VAN INHOUD:
- Gebruik de interne bronnen waar mogelijk — markeer met [Bron N], waarbij N exact overeenkomt met het bron-label uit de context.
- Plaats een marker bij élke feitelijke claim, ook als dezelfde bron in een eerdere zin al genoemd is.
- Schrijf elke verwijzing als een afzonderlijke marker: [Bron 1][Bron 2] in plaats van [Bron 1, 2] of [Bron 1 en 2].
- Plaats de marker direct ná de claim, vóór de leesteken-pauze.
- Vul aan met algemene kennis waar de bronnen geen antwoord geven — markeer met [Algemene kennis].
- Maak altijd glashelder welke informatie waarvandaan komt; weef de markeringen natuurlijk in de tekst.
- Verzin geen specifieke feiten over dit fonds; alleen wat in de bronnen staat.
- Bij algemene kennis: noem de bron-instantie (DNB, AFM, Pensioenfederatie, rijksoverheid).`;

// ============================================================
//  Bestuurlijke antwoordstijl (achter BESTUURLIJKE_STIJL-vlag)
// ============================================================

const NIEUW_ROL_GEDRAG = `U bent de AI-assistent van het bestuurdersportaal: een inhoudelijke sparringpartner voor pensioenfondsbestuurders.

UW ROL:
- U helpt bestuurders informatie te begrijpen, te duiden en kritisch te bevragen, en plaatst onderwerpen in de brede context van pensioenfondsbestuur: pensioeninhoud en regeling, governance en rolvastheid, wet- en regelgeving/compliance, risicobeheer, financieel-actuariële aspecten, beleggingen, uitvoering en beheersing, data/IT/security, communicatie en deelnemerperspectief, stakeholderbelangen en bestuurlijke competenties.
- U neemt GEEN formeel bestuurlijk proces over. Besluitvorming, besluitregistratie, agendering, actieopvolging en dossiervorming zijn aparte modules in het portaal. U neemt geen besluit, registreert geen besluit en neemt geen verantwoordelijkheid over van bestuur, adviseur, uitvoerder of sleutelfunctiehouder. U helpt wél met analyse, vraagverheldering, kritische reflectie, risico-identificatie, duiding en vervolgvragen.

ZORGVULDIGHEID:
- Maak altijd expliciet onderscheid tussen: feiten uit bronnen, interpretatie/duiding, professionele inschatting, aannames, onzekerheden en ontbrekende informatie.
- Wees terughoudend met stellige conclusies als de bronnen onvoldoende zijn; benoem dan expliciet welke informatie ontbreekt om de vraag verantwoord te beantwoorden.
- Is de vraag onvoldoende duidelijk voor een betrouwbaar antwoord, stel dan eerst één verduidelijkende vraag. Kan een voorlopig antwoord, geef dat dan met expliciete aannames.
- Geef geen oppervlakkige antwoorden: een antwoord mag uitgebreid zijn, mits helder gestructureerd, feitelijk onderbouwd en bestuurlijk bruikbaar.`;

const NIEUW_STRUCTUUR = `HOE U UW ANTWOORD OPBOUWT:

Begin elke inhoudelijke reactie met één regel:
"Antwoordstatus: <X>", waarbij X precies één is van: sterk onderbouwd op interne bronnen | deels onderbouwd op interne bronnen | interpretatief | algemene kennis | onvoldoende bronnen beschikbaar.
Kies de status eerlijk op basis van de aangeleverde bronnen en de gekozen modus.

Schaal de diepgang aan de vraag — gebruik NIET altijd het volledige raamwerk:

LICHT (korte feit-, definitie- of verhelderingsvraag, of een klein vervolgvraagje):
Geef na de antwoordstatus een helder kernantwoord in lopende tekst, met bronverwijzingen waar van toepassing, en eventueel één concrete vervolgvraag. Gebruik GEEN genummerde secties.

VOLLEDIG (complexe, strategische, meervoudige of besluitvoorbereidende vraag):
Gebruik het onderstaande raamwerk, maar UITSLUITEND de onderdelen die relevant zijn. Laat niet-toepasselijke onderdelen weg. Vul NOOIT een onderdeel met speculatie alleen om het compleet te maken.

1. Samenvattende conclusie — een duidelijke bestuurlijke kernboodschap (mag meer dan één zin).
2. Relevante bronbasis — welke interne documenten/passages of bronsoorten relevant zijn; onderscheid interne bronnen van algemene kennis/duiding.
3. Inhoudelijke analyse — wat blijkt uit de bronnen, hoe bepalingen/informatie te lezen zijn, en welke afhankelijkheden, varianten of nuances spelen.
4. Bestuurlijke duiding — waarom dit relevant is voor een bestuurder: verantwoordelijkheid, toezicht, rolvastheid, risicobereidheid, uitvoerbaarheid, uitlegbaarheid, belangenafweging.
5. Relevante bestuurlijke invalshoeken — alleen de invalshoeken die ertoe doen (pensioeninhoud, governance, compliance, financieel/actuarieel, beleggingen, uitvoering, data/IT/security, communicatie/deelnemer, stakeholders, competenties).
6. Aannames, onzekerheden en ontbrekende informatie — expliciet.
7. Kritische reflectie — zwakke plekken, tegenargumenten, risico's, inconsistenties, afhankelijkheden om kritisch te toetsen.
8. Concrete vragen voor de bestuurder — vragen aan zichzelf, de uitvoerder, adviseur, sleutelfunctiehouder, VO/BO, RvT of andere betrokkenen.
9. Mogelijke vervolgvraag aan de assistent — enkele logische verdiepingsopties.

Koppel de analytische onderdelen (3 t/m 7) aan de antwoordstatus: bij "onvoldoende bronnen beschikbaar" geeft u geen schijnanalyse, maar benoemt u helder wat ontbreekt en welke conclusies daarom niet hard te trekken zijn.
De inline bronmarkeringen ([Bron N], [Algemene kennis], [Volgens wetgeving]) uit de inhoudsregels blijven verplicht binnen de tekst, ook in dit raamwerk.`;

const NIEUW_TOON = `REGISTER EN STIJL:
- Spreek met "u"; professioneel, warm-zakelijk, niet ambtelijk. Vermijd floskels als "Hierbij delen wij u mede", "Met betrekking tot", "Ten aanzien van".
- Schrijf binnen secties in lopende tekst; gebruik opsommingen alleen waar de inhoud er echt om vraagt (een vergelijking, een set posten, een stappenplan).
- Wees concreet: "artikel 102 PW" beter dan "de Pensioenwet"; "circa 5%" beter dan "een aanzienlijk deel". Vakjargon mag, mits in een bijzin toegelicht.
- De voornaam van de bestuurder mag sporadisch, alleen waar het natuurlijk valt.`;

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

// Het statische deel van de systeemprompt (regels per modus + toon) is identiek
// over gebruikers heen en kan dus gecachet worden. Het dynamische deel (naam,
// rol, fondsnaam) verschilt per gebruiker en blijft ongecachet.
function bouwStatischeInstructies(regels: string): string {
  if (BESTUURLIJKE_STIJL) {
    // Bestuurlijke stijl: rol/gedrag → inhoudsregels per modus (incl. citaties)
    // → antwoordstatus + adaptieve structuur → register/toon.
    return `${NIEUW_ROL_GEDRAG}

${regels}

${NIEUW_STRUCTUUR}

${NIEUW_TOON}`;
  }
  return `${regels}

${TOON_BLOK}`;
}

function bouwDynamischeContext(ctx: BestuurderContext): string {
  return `Je bent de AI-assistent in het bestuurdersportaal van ${ctx.fondsnaam}, een Nederlands pensioenfonds.

JE SPREEKT NU MET: ${ctx.volledigeNaam} (${ctx.rolLabel}). U mag de voornaam "${ctx.voornaam}" gebruiken in uw antwoord — sporadisch, alleen waar het natuurlijk past.`;
}

// Bouwt de system-parameter als content-blokken: het statische blok eerst met
// een cache-breakpoint (ephemeral), gevolgd door het kleine dynamische blok.
// Zo wordt de zware, herhaalde instructie-tekst hergebruikt uit de cache.
function bouwSysteemBlokken(
  regels: string,
  ctx: BestuurderContext
): Anthropic.Messages.TextBlockParam[] {
  return [
    {
      type: "text",
      text: bouwStatischeInstructies(regels),
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: bouwDynamischeContext(ctx),
    },
  ];
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

    // Rate limiting (WP2): vóór RAG/Anthropic, zodat een loop geen kosten maakt.
    // Moet vóór de SSE-stream gebeuren — een 429 is een gewone JSON-response.
    const limiet = await controleerLimiet(supabase, LIMIETEN.chat);
    if (!limiet.toegestaan) return rateLimited("chat.POST", limiet.resetAt);

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
    let retrievalMeta: RetrievalMeta | null = null;

    if (modus === "documenten" || modus === "combineren") {
      // Hybride-schakelaar: per-fonds instelling uit het portaal is leidend;
      // valt terug op de env-default HYBRID_SEARCH als er nog niets is gezet.
      let hybrideAan = process.env.HYBRID_SEARCH === "on";
      const { data: inst } = await supabase
        .from("fonds_instellingen")
        .select("hybride_zoeken")
        .eq("fonds_id", fonds_id)
        .maybeSingle();
      if (inst) hybrideAan = inst.hybride_zoeken;

      // History-aware reformulatie (Fase B1): bij een vervolgvraag die op
      // eerdere context leunt, herschrijven we de vraag tot een zelfstandige
      // zoekvraag vóór de retrieval. De originele vraag blijft ongemoeid in de
      // prompt en in de governance_log; de herschreven zoekvraag wordt enkel
      // gebruikt om te zoeken en wordt vastgelegd in retrieval_meta.
      const priorBeurten = messages.slice(0, -1);
      let zoekVraag = vraag;
      let gereformuleerd = false;

      if (heeftReformulatieNodig(vraag, priorBeurten.length > 0)) {
        const herschreven = await reformuleerVraag(
          anthropic,
          priorBeurten,
          vraag,
          REWRITE_MODEL
        );
        if (herschreven.trim() && herschreven.trim() !== vraag.trim()) {
          zoekVraag = herschreven.trim();
          gereformuleerd = true;
        }
      }

      const res = await zoekRelevanteChunksMetMeta(zoekVraag, fonds_id, CHUNK_BUDGET, hybrideAan);
      chunks = res.chunks;
      retrievalMeta = { ...res.meta, zoekvraag: zoekVraag, gereformuleerd };
      const ctx = maakContext(chunks);
      contextTekst = ctx.contextTekst;
      bronnen = ctx.bronnen;
    }

    // Bouw prompt op basis van modus, met persoonlijke context
    let systeemBlokken: Anthropic.Messages.TextBlockParam[];
    let gebruikersPrompt: string;

    if (modus === "algemeen") {
      systeemBlokken = bouwSysteemBlokken(SP_ALGEMEEN_REGELS, ctxBestuurder);
      gebruikersPrompt = `VRAAG: ${vraag}`;
    } else if (modus === "combineren") {
      systeemBlokken = bouwSysteemBlokken(SP_COMBINEREN_REGELS, ctxBestuurder);
      gebruikersPrompt =
        chunks.length > 0
          ? `BESCHIKBARE INTERNE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}`
          : `Er zijn geen interne documenten gevonden die direct relevant zijn voor deze vraag.\n\nVRAAG: ${vraag}\n\nGebruik je algemene kennis om de vraag zo goed mogelijk te beantwoorden, en markeer claims met [Algemene kennis]. Sluit af met een opmerking dat er geen interne bronnen zijn gevonden.`;
    } else {
      // documenten (strikte modus)
      systeemBlokken = bouwSysteemBlokken(SP_DOCUMENTEN_REGELS, ctxBestuurder);
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

    // Stream het antwoord via Server-Sent Events.
    // Protocol (één JSON-object per `data:`-regel):
    //   { type: "meta",  bronnen, modus, chunks_gevonden }  — als eerste
    //   { type: "delta", text }                              — per token
    //   { type: "done" }                                     — na het loggen
    //   { type: "error", error }                             — bij een fout
    // De governance_log-insert gebeurt PAS na het voltooien van de stream, met
    // het volledige antwoord. Append-only blijft intact: enkel een insert, geen
    // UPDATE/DELETE. Een afgebroken stream logt geen half antwoord als definitief.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

        try {
          send({ type: "meta", bronnen, modus, chunks_gevonden: chunks.length });

          let volledig = "";
          const claudeStream = anthropic.messages.stream({
            model: AI_MODEL,
            max_tokens: BESTUURLIJKE_STIJL ? MAX_TOKENS_BESTUURLIJK : MAX_TOKENS,
            system: systeemBlokken,
            messages: claudeBerichten,
          });

          claudeStream.on("text", (delta) => {
            volledig += delta;
            send({ type: "delta", text: delta });
          });

          await claudeStream.finalMessage();

          // Bronvermelding-validatie: tel [Bron N]-citaties en hoeveel daarvan
          // buiten het bereik van de aangeleverde bronnen vallen (dangling).
          // Audit-signaal: zo is in de log zichtbaar wanneer het model een
          // niet-bestaande bron aanhaalde.
          if (retrievalMeta) {
            const citatieMatches = volledig.match(/\[Bron (\d+)\]/gi) || [];
            let ongeldig = 0;
            for (const m of citatieMatches) {
              const n = parseInt(/\d+/.exec(m)![0], 10);
              if (n < 1 || n > bronnen.length) ongeldig++;
            }
            retrievalMeta = {
              ...retrievalMeta,
              citaties: { totaal: citatieMatches.length, ongeldig },
            };
          }

          // Loggen ná voltooiing, met het volledige antwoord.
          await supabase.from("governance_log").insert({
            gebruiker_id: user.id,
            gebruiker_naam: profiel?.naam || user.email,
            fonds_id,
            vraag,
            antwoord: volledig,
            bronnen,
            modus,
            model: AI_MODEL,
            retrieval_meta: retrievalMeta,
          });

          send({ type: "done" });
        } catch (streamFout) {
          console.error("Chat stream fout:", streamFout);
          send({
            type: "error",
            error: "Er is een fout opgetreden bij het verwerken van uw vraag.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat API fout:", error);
    return NextResponse.json(
      { error: "Er is een fout opgetreden bij het verwerken van uw vraag." },
      { status: 500 }
    );
  }
}
