import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase-server";
import { zoekRelevanteChunksMetMeta, maakContext, haalDocumentChunks, verrijkNotulenChunks, type DocumentChunk, type BronVerwijzing, type RetrievalMeta, type RetrievalFilters } from "@/lib/rag";
import { heeftReformulatieNodig, reformuleerVraag } from "@/lib/query-reformulatie";
import { controleerLimiet, LIMIETEN } from "@/lib/rate-limit";
import { rateLimited } from "@/lib/api-errors";
import { valideerScope, type ScopeDocumentRij } from "@/lib/document-scope";
import { bepaalVraagtype, schatTokens, kiesStrategie, maakBatches, bepaalAntwoordmodus, retrievalModusVoor, bepaalInlineMeldingen, bronbasisLabel, bepaalBronIntent, moetVerduidelijken, bepaalAutoBronModus, VERDUIDELIJKINGSVRAAG, VERDUIDELIJKING_OPTIES, ANTWOORDMODUS_LABEL, type Strategie, type Antwoordmodus, type BronModus, type BronIntent, type BronIntentResultaat } from "@/lib/vraagtype";
import { bepaalBronsoortprofiel } from "@/lib/weeg-bronsoort";
import { haalBesluitBronnen, topProcesinstanties, opmaakBesluitContext } from "@/lib/besluitvorming-bron";
import { documentBronNaarSource, modelKennisBronnenUitAntwoord, bouwSourceSamenvatting, ontbrekendeAlgemeneKennisMarkering, type AssistantSource } from "@/lib/assistant-source";

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

// ── Document-scope increment 2: dekkingsbrede strategieën ──────────────────
// Drempel full-document vs. map-reduce, in geschatte tokens (≈ tekens/4). Onder
// de drempel past de volledige documenttekst in één prompt (accuraat, één call);
// erboven verwerken we in batches (map-reduce). Conservatief gekozen: ruim
// binnen het contextvenster, met plek voor systeemprompt + antwoord. Eén knop.
const VOLLEDIG_DOC_TOKEN_DREMPEL = 48000;
// Tokenbudget per map-batch en harde bovengrens op het aantal batches
// (kostenbewaking — voorkomt kostenrunaway bij extreem grote documenten).
const MAP_BATCH_TOKENS = 16000;
const MAX_BATCHES = 12;
// Goedkoop/snel model voor de extractieve map-stap; het sterke AI_MODEL doet de
// reduce-stap (kwaliteit van het eindantwoord).
const MAP_MODEL = "claude-haiku-4-5-20251001";

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
- BELANGRIJK (geen verzonnen bronnen): verzin NOOIT een documenttitel, paragraaf-/paginanummer, URL, datum of dossiernaam bij algemene kennis. U mag de bron-instantie noemen, maar presenteer nooit een specifieke vindplaats of link die u niet daadwerkelijk is aangeleverd. Bij twijfel: noem de instantie, niet een verwijzing.
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
- Bij algemene kennis: noem de bron-instantie (DNB, AFM, Pensioenfederatie, rijksoverheid, SZW).
- Verzin bij algemene kennis NOOIT een documenttitel, vindplaats, URL of paginanummer. [Bron N] mag uitsluitend verwijzen naar een daadwerkelijk aangeleverde interne bron; voor externe/algemene kennis gebruikt u [Algemene kennis]/[Volgens wetgeving] met hooguit de instantienaam.`;

// TODO(web-retrieval — Scenario A): zodra er ECHTE web-retrieval bestaat (Route B /
// web-ingestion met whitelist), komt hier een SP_WEB_REGELS-blok dat het model
// instrueert uitsluitend te citeren uit de aangeleverde, opgehaalde webresultaten
// (kind 'web' in lib/assistant-source.ts) — nooit uit verzonnen URL's. De UI en het
// auditspoor zijn al voorbereid (AssistantSource.web + source_summary.web_retrieval_actief).

// ============================================================
//  Document-scope (increment 1) — strict-document gedrag
// ============================================================
// Bij een actieve documentscope antwoordt de AI UITSLUITEND op basis van het/de
// aangeleverde document(en). De retrieval levert fysiek alleen chunks uit dat
// document (scope vóór ranking in de RPC); deze prompt borgt de tweede laag:
// geen aanvulling uit andere documenten, eerdere context of algemene kennis, en
// een expliciete "niet aangetroffen"-melding als het antwoord er niet in staat.
const SP_DOCUMENT_SCOPE_REGELS = `U beantwoordt deze vraag UITSLUITEND op basis van het/de hieronder aangeleverde document(en). Dit is een bewust afgebakende vraag over één specifiek stuk.

REGELS VAN INHOUD:
- Gebruik alleen informatie die in de aangeleverde fragmenten staat. Verzin niets en vul niets aan — niet uit andere documenten, niet uit eerdere onderwerpen in dit gesprek, en niet uit uw algemene kennis.
- Staat het antwoord (geheel of deels) niet in dit document, zeg dat dan expliciet en letterlijk: "Dit is niet in dit document aangetroffen." Doe geen gok en geef geen algemene duiding als vervanging.
- Verwijs naar bronnen met de notatie [Bron N], waarbij N het getal is van het bron-label uit de aangeleverde context. Plaats een marker bij élke feitelijke claim.
- Schrijf elke verwijzing als een afzonderlijke marker: [Bron 1][Bron 2] in plaats van [Bron 1, 2].
- Wees concreet over paragraaf- en paginanummers waar die bij het bron-label staan.
- Vraagt de gebruiker naar andere documenten of bredere context, meld dan dat deze vraag is beperkt tot het gekozen document en vraag of de scope verbreed moet worden — zoek niet stilletjes breder.`;

// Dekkingsbrede vraag (samenvatten, beoordelen, risico's/besluiten benoemen),
// strict op het document. Het VOLLEDIGE document is aangeleverd (full-document)
// of als deelanalyses (map-reduce), dus baseer het antwoord op het hele stuk.
const SP_DOCUMENT_SCOPE_BREED_REGELS = `U beantwoordt deze vraag UITSLUITEND op basis van het hieronder aangeleverde document. Dit is een dekkingsbrede vraag, dus baseer uw antwoord op het VOLLEDIGE document, niet op losse fragmenten.

REGELS VAN INHOUD:
- Gebruik alleen informatie uit het aangeleverde document. Verzin niets en vul niets aan uit andere documenten, eerdere onderwerpen in dit gesprek of uw algemene kennis.
- Verwijs naar vindplaatsen met paginanummers in lopende tekst, bijvoorbeeld "(pag. 12)". Gebruik GEEN [Bron N]-notatie.
- Staat iets niet in het document, zeg dat dan expliciet in plaats van te gokken.
- Wees concreet en bestuurlijk bruikbaar; structureer waar de vraag erom vraagt (bijvoorbeeld risico's, gevraagde besluiten of aandachtspunten als opsomming).`;

// Opt-in algemene kennis (§6): drie expliciet gescheiden delen via ###-koppen,
// zodat de UI ze als secties rendert. Strict-document blijft de default; dit
// blok wordt alleen gebruikt als de gebruiker algemene kennis bewust aanzet.
const SP_DOCUMENT_SCOPE_ALG_REGELS = `U beantwoordt deze vraag primair op basis van het aangeleverde document, en mag aanvullend uw algemene kennis gebruiken. Scheid uw antwoord ALTIJD in drie delen met exact deze koppen (Markdown ###):

### Uit dit document blijkt
Wat het document zelf zegt, met paginaverwijzingen "(pag. X)". Uitsluitend wat er echt staat — niets verzinnen.

### Aanvullende algemene duiding
Context of duiding uit uw algemene kennis, herkenbaar als NIET uit dit document. Markeer claims met [Algemene kennis]. Laat dit deel weg als het niets toevoegt.

### Niet in dit document aangetroffen
Wat de gebruiker vroeg maar het document niet bevat. Laat dit deel weg als alles is afgedekt.

Vermeng de delen nooit en presenteer algemene kennis nooit als documentinhoud.`;

// ============================================================
//  Transformatie-vervolgacties (FO §13) — herschrijf-intent
// ============================================================
// Een transformatie-actie ("Werk uit richting besluitvorming", "Geef bestuurlijke
// duiding", "Maak feitelijker/korter/concreter") bewerkt het VORIGE antwoord, niet
// het document opnieuw. De route levert het vorige antwoord mee in de historie en
// (indien gescoopt) de relevante fragmenten als verankering; deze prompt borgt dat
// het model herstructureert/duidt ZONDER nieuwe fondsfeiten te verzinnen, en de
// stapeling op een leeg vorig antwoord ("niet aangetroffen") expliciet stopt.
const SP_TRANSFORMATIE_REGELS = `U bewerkt UW EIGEN VORIGE ANTWOORD uit dit gesprek (hierboven in de berichtgeschiedenis). Dit is een herschrijf- of duidingsopdracht, GEEN nieuwe documentvraag.

REGELS VAN INHOUD:
- Werk op basis van uw vorige antwoord en, indien hieronder meegeleverd, de ondersteunende fragmenten. Voer de gevraagde bewerking uit: herstructureren, samenvatten, feitelijker maken, bestuurlijk duiden of concretiseren.
- Introduceer GEEN nieuwe fondsspecifieke feiten die niet in uw vorige antwoord of de meegeleverde fragmenten staan. Verzin geen cijfers, data, artikelnummers, bedragen of bronnen.
- Behoud het expliciete onderscheid tussen feit (uit bronnen), interpretatie/duiding, aanname en onzekerheid. Aanvullende algemene duiding mag, mits herkenbaar gemarkeerd met [Algemene kennis] en nooit gepresenteerd als documentinhoud.
- Bevatte uw vorige antwoord geen inhoudelijke basis (bijvoorbeeld omdat het gekozen document de gevraagde informatie niet bevatte), constateer dat dan expliciet en stel voor de scope te verbreden of een inhoudelijke vraag te stellen — vul NIET alsnog met verzonnen inhoud aan.
- Neem geen formeel besluit en formuleer geen voorkeursadvies; u ondersteunt de bestuurlijke voorbereiding.`;

// Systeemprompt voor de extractieve map-stap (map-reduce). Goedkoop model.
const SP_MAP_EXTRACTIE = `U bent een analist die voor een specifieke vraag de relevante punten uit één deel van een document extraheert. Geef beknopt en feitelijk de passages/feiten die voor de vraag relevant zijn, elk met paginanummer indien beschikbaar. Verzin niets en voeg geen algemene kennis toe. Is er in dit deel niets relevant voor de vraag, antwoord dan exact met het woord: GEEN.`;

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
//  Sparringmodus (Increment G, FO §13). Reflectief tegenspel met expliciete
//  scheiding feit/interpretatie/inschatting/openstaande vraag. Geen besluit en
//  geen voorkeursadvies — de assistent spiegelt, het bestuur besluit.
// ============================================================
const SP_SPARRING_REGELS = `U bent nu in SPARRINGMODUS: een kritische, reflectieve gesprekspartner die de bestuurder helpt scherper te denken — niet om het over te nemen.

HOE U SPART:
- Stel tegenvragen, benoem aannames, en breng invalshoeken in die de bestuurder mogelijk over het hoofd ziet. Speel waar nuttig advocaat van de duivel, maar blijf constructief.
- U neemt GEEN besluit en geeft GEEN voorkeursadvies ("ik zou X kiezen" / "het beste is Y"). U legt afwegingen, voor- en nadelen en consequenties open; de keuze is aan het bestuur.
- Bij onvoldoende of concept/historische/verlopen bronnen: zeg dat eerlijk en spar op het niveau van wat wél bekend is; verzin geen feiten.

SCHEID IN ELK SPARRINGANTWOORD EXPLICIET (gebruik exact deze vier labels als korte koppen of inline-markeringen):
- FEIT: wat aantoonbaar uit de bronnen blijkt (met [Bron N] waar van toepassing).
- INTERPRETATIE: hoe die feiten te lezen/duiden zijn — herkenbaar als interpretatie, niet als feit.
- INSCHATTING: uw professionele inschatting/risicobeeld, met de onzekerheid erbij.
- OPENSTAANDE VRAAG: wat nog onbeantwoord is en wie/wat dat zou moeten ophelderen.

Vermeng deze vier nooit. Een eerlijke "ik weet het niet, dit moet u verifiëren" is waardevoller dan schijnzekerheid.`;

// ============================================================
//  Persoonlijke context-bouwer
// ============================================================
const ROL_LABEL: Record<string, string> = {
  bestuurder: "bestuurslid",
  voorzitter: "voorzitter van het bestuur",
  beheerder: "beheerder",
};

interface BestuurderContext {
  // Increment F (FO §14) — profielgestuurde PRIORITERING (geen filtering). Bevat,
  // indien aanwezig en niet onderdrukt door 'algemeen perspectief', de leesbare
  // profielregel die de VOLGORDE/NADRUK van het antwoord stuurt. Landt uitsluitend
  // in het dynamische (ongecachte) contextblok — nooit in de toon-systeemprompt en
  // nooit in retrieval (gedragsneutraliteit, acceptatiecriterium 9).
  profielsturing?: string | null;
  voornaam: string;
  volledigeNaam: string;
  rolLabel: string;
  fondsnaam: string;
}

// Het statische deel van de systeemprompt (regels per modus + toon) is identiek
// over gebruikers heen en kan dus gecachet worden. Het dynamische deel (naam,
// rol, fondsnaam) verschilt per gebruiker en blijft ongecachet.
function bouwStatischeInstructies(
  regels: string,
  antwoordmodus: Antwoordmodus = "feitelijk"
): string {
  // Sparring: rol/gedrag → inhoudsregels → 4-deling feit/interpretatie/
  // inschatting/openstaande vraag → register/toon.
  if (antwoordmodus === "sparring") {
    return `${NIEUW_ROL_GEDRAG}

${regels}

${SP_SPARRING_REGELS}

${NIEUW_TOON}`;
  }
  // Bestuurlijke duiding productiseert de bestuurlijke stijl (antwoordstatus +
  // adaptieve structuur). De env-vlag BESTUURLIJKE_STIJL blijft een globale
  // default voor de overige modi (back-compat).
  if (antwoordmodus === "duiding" || BESTUURLIJKE_STIJL) {
    return `${NIEUW_ROL_GEDRAG}

${regels}

${NIEUW_STRUCTUUR}

${NIEUW_TOON}`;
  }
  return `${regels}

${TOON_BLOK}`;
}

function bouwDynamischeContext(ctx: BestuurderContext): string {
  const basis = `Je bent de AI-assistent in het bestuurdersportaal van ${ctx.fondsnaam}, een Nederlands pensioenfonds.

JE SPREEKT NU MET: ${ctx.volledigeNaam} (${ctx.rolLabel}). U mag de voornaam "${ctx.voornaam}" gebruiken in uw antwoord — sporadisch, alleen waar het natuurlijk past.`;
  return ctx.profielsturing ? `${basis}\n\n${ctx.profielsturing}` : basis;
}

// Bouwt de system-parameter als content-blokken: het statische blok eerst met
// een cache-breakpoint (ephemeral), gevolgd door het kleine dynamische blok.
// Zo wordt de zware, herhaalde instructie-tekst hergebruikt uit de cache.
function bouwSysteemBlokken(
  regels: string,
  ctx: BestuurderContext,
  antwoordmodus: Antwoordmodus = "feitelijk"
): Anthropic.Messages.TextBlockParam[] {
  return [
    {
      type: "text",
      text: bouwStatischeInstructies(regels, antwoordmodus),
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

// Locatie-prefix voor een chunk in de volledige documenttekst, bv. "[3.2, pag. 12] ".
function locatieLabel(c: DocumentChunk): string {
  const loc = [c.paragraaf, c.pagina ? `pag. ${c.pagina}` : null]
    .filter(Boolean)
    .join(", ");
  return loc ? `[${loc}] ` : "";
}

// Bouwt één bronkaart per gescoopt document (i.p.v. per chunk). Voor de brede
// strategieën verwijst het antwoord tekstueel naar pagina's; de UI toont het
// document als bron met een link naar het origineel.
function documentBronnen(chunks: DocumentChunk[]): BronVerwijzing[] {
  const perDoc = new Map<string, BronVerwijzing>();
  for (const c of chunks) {
    if (perDoc.has(c.document_id)) continue;
    perDoc.set(c.document_id, {
      document_id: c.document_id,
      titel: c.documenten.titel,
      bron: c.documenten.bron,
      pagina: null,
      paragraaf: null,
      fragment: "",
      heeft_origineel: !!c.documenten.opslag_pad,
    });
  }
  return [...perDoc.values()];
}

// ============================================================
//  Increment F (FO §14) — profielgestuurde PRIORITERING
// ----------------------------------------------------------------------------
//  Bouwt de leesbare profielregel voor het DYNAMISCHE contextblok. Stuurt
//  uitsluitend de VOLGORDE/NADRUK van het antwoord — niet de retrieval, niet de
//  gedeelde feitenbasis (die blijft volledig en zichtbaar). Leest via dezelfde
//  RLS-client (anon-key); join-namen worden per id opgelost (geen embed, robuust
//  bij composite-FK's). Levert null als er niets te sturen valt (leeg profiel).
// ============================================================
type ProfielsturingAspecten = NonNullable<RetrievalMeta["profielsturing_aspecten"]>;

async function bouwProfielsturing(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string
): Promise<{ tekst: string; aspecten: ProfielsturingAspecten } | null> {
  const { data: p } = await supabase
    .from("profielen")
    .select(
      "bestuurlijke_rol, primaire_expertise_id, antwoordvoorkeur, detailniveau"
    )
    .eq("id", userId)
    .single();
  if (!p) return null;

  const [expR, gremR, focusR] = await Promise.all([
    supabase.from("profiel_expertises").select("expertise_id").eq("profiel_id", userId),
    supabase.from("profiel_gremia").select("gremium_id").eq("profiel_id", userId),
    supabase.from("profiel_focusgebieden").select("focusgebied_id").eq("profiel_id", userId),
  ]);
  const secExpIds = (expR.data ?? []).map((r) => r.expertise_id as string);
  const gremIds = (gremR.data ?? []).map((r) => r.gremium_id as string);
  const focusIds = (focusR.data ?? []).map((r) => r.focusgebied_id as string);

  const primExpId = p.primaire_expertise_id as string | null;
  const expIds = Array.from(new Set([...(primExpId ? [primExpId] : []), ...secExpIds]));

  const leeg = { data: [] as { id: string; naam: string }[] };
  const [expNamen, gremNamen, focusNamen] = await Promise.all([
    expIds.length
      ? supabase.from("expertises").select("id, naam").in("id", expIds)
      : Promise.resolve(leeg),
    gremIds.length
      ? supabase.from("gremia").select("id, naam").in("id", gremIds)
      : Promise.resolve(leeg),
    focusIds.length
      ? supabase.from("kritische_focusgebieden").select("id, naam").in("id", focusIds)
      : Promise.resolve(leeg),
  ]);

  const naam = (rij: { data: { id: string; naam: string }[] | null }, id: string) =>
    (rij.data ?? []).find((r) => r.id === id)?.naam ?? null;

  const bestuurlijkeRol =
    typeof p.bestuurlijke_rol === "string" && p.bestuurlijke_rol.trim().length > 0
      ? p.bestuurlijke_rol.trim()
      : null;
  const primaireExpertiseNaam = primExpId ? naam(expNamen, primExpId) : null;
  const secundaireNamen = secExpIds
    .map((id) => naam(expNamen, id))
    .filter((n): n is string => !!n);
  const gremiaNamen = gremIds.map((id) => naam(gremNamen, id)).filter((n): n is string => !!n);
  const focusNamenLijst = focusIds
    .map((id) => naam(focusNamen, id))
    .filter((n): n is string => !!n);
  const antwoordvoorkeur =
    typeof p.antwoordvoorkeur === "string" && p.antwoordvoorkeur.trim().length > 0
      ? p.antwoordvoorkeur.trim()
      : null;
  const detailniveau =
    typeof p.detailniveau === "string" && p.detailniveau.trim().length > 0
      ? p.detailniveau.trim()
      : null;

  const profielRegels: string[] = [];
  if (bestuurlijkeRol) profielRegels.push(`bestuurlijke rol: ${bestuurlijkeRol}`);
  if (primaireExpertiseNaam) profielRegels.push(`primaire expertise: ${primaireExpertiseNaam}`);
  if (secundaireNamen.length) profielRegels.push(`secundaire expertise: ${secundaireNamen.join(", ")}`);
  if (gremiaNamen.length) profielRegels.push(`actief in: ${gremiaNamen.join(", ")}`);
  if (focusNamenLijst.length)
    profielRegels.push(`kritische focusgebieden: ${focusNamenLijst.join(", ")}`);

  const voorkeurRegels: string[] = [];
  if (antwoordvoorkeur) voorkeurRegels.push(`antwoordvoorkeur "${antwoordvoorkeur}"`);
  if (detailniveau) voorkeurRegels.push(`detailniveau "${detailniveau}"`);

  // Niets ingevuld → geen sturing (collectieve weergave is dan de natuurlijke staat).
  if (profielRegels.length === 0 && voorkeurRegels.length === 0) return null;

  const tekst = `PERSOONLIJK PROFIEL VAN DE LEZER — UITSLUITEND VOOR PRIORITERING, NOOIT VOOR FILTERING.
Profiel: ${profielRegels.join("; ") || "geen specifieke aandachtsgebieden opgegeven"}.${
    voorkeurRegels.length ? ` Voorkeuren: ${voorkeurRegels.join(", ")}.` : ""
  }
Stem de VOLGORDE en NADRUK van je antwoord hierop af: behandel wat voor deze focusgebieden/expertise relevant is als eerste en het uitgebreidst. Je mag NIETS weglaten, inkorten of verbergen uit de gedeelde feitenbasis — de volledige, collectieve onderbouwing blijft intact en zichtbaar voor iedereen. Verwijs in je antwoord NIET naar dit profiel, naar "algemeen perspectief" of naar het feit dát je op het profiel hebt geprioriteerd — die transparantie regelt de interface apart, in het paneel "Onderbouwing en bronnen". Geef simpelweg het antwoord in de op het profiel afgestemde volgorde, zonder erover te editorialiseren.`;

  return {
    tekst,
    aspecten: {
      bestuurlijke_rol: !!bestuurlijkeRol,
      primaire_expertise: !!primaireExpertiseNaam,
      secundaire_expertises: secundaireNamen.length,
      gremia: gremiaNamen.length,
      focusgebieden: focusNamenLijst.length,
      antwoordvoorkeur,
      detailniveau,
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      // nieuw: volledige conversatiegeschiedenis
      messages?: ChatBericht[];
      // backwards-compat: één losse vraag
      vraag?: string;
      fonds_id?: string;
      // Increment I-2 (FO §11a) — de zichtbare bron-as is vervangen door
      // automatische bronkeuze. De client stuurt geen bron-modus meer; alleen de
      // expliciete restrictie "Alleen fondsdocumenten" (onder "Aanpassen") en —
      // wanneer de gebruiker een verduidelijkingschip koos — de bevestigde intentie.
      alleen_fondsdocumenten?: boolean;
      bron_intent_override?: "fonds" | "algemeen";
      // Document-scope (increment 1): beperk de vraag tot één/enkele document(en).
      // `algemene_kennis` is increment 2 — in increment 1 forceren we strict.
      document_scope?: { document_ids?: string[]; algemene_kennis?: boolean };
      // Increment G — door de gebruiker vastgezette antwoordmodus (gespreksniveau,
      // gesprekken.actieve_antwoordmodus). null/afwezig = auto-detectie per vraag.
      actieve_antwoordmodus?: Antwoordmodus | null;
      // Increment F (FO §14) — "algemeen perspectief"-toggle. true = profielsturing
      // overslaan: identieke bronnen/retrieval, maar het antwoord wordt NIET op het
      // persoonlijke profiel geprioriteerd (collectieve weergave). Afwezig/false =
      // profielsturing actief (indien de gebruiker een profiel heeft ingevuld).
      algemeen_perspectief?: boolean;
      // Transformatie-vervolgactie (FO §13): true = deze beurt bewerkt het VORIGE
      // antwoord (werk uit / duiding / feitelijker / korter / concreter). De route
      // schakelt dan naar herschrijf-intent i.p.v. een nieuwe documentlookup, zodat
      // strict-document niet onterecht "niet aangetroffen" teruggeeft. De client zet
      // dit alleen voor de gesloten set transformatie-acties (isTransformatieActie).
      transformatie?: boolean;
    };
    const { fonds_id } = body;

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

    // ── Increment F (FO §14) — profielgestuurde PRIORITERING ────────────────
    // Standaard actief; de "algemeen perspectief"-toggle (body.algemeen_perspectief)
    // schakelt de prioritering uit zonder iets aan de bronnen/retrieval te wijzigen.
    // De sturing landt alleen in het dynamische contextblok (zie bouwDynamischeContext),
    // nooit in de gecachte toon-systeemprompt of de retrievalfilters.
    const algemeenPerspectief = body.algemeen_perspectief === true;
    let profielsturingStatus: NonNullable<RetrievalMeta["profielsturing"]>;
    let profielsturingAspecten: ProfielsturingAspecten | undefined;
    if (algemeenPerspectief) {
      profielsturingStatus = "uitgeschakeld";
    } else {
      const sturing = await bouwProfielsturing(supabase, user.id);
      if (sturing) {
        ctxBestuurder.profielsturing = sturing.tekst;
        profielsturingStatus = "actief";
        profielsturingAspecten = sturing.aspecten;
      } else {
        profielsturingStatus = "geen-profiel";
      }
    }

    // ── Document-scope (increment 1): server-side validatie vóór retrieval ──
    // De client mag document_id's meesturen, maar de server valideert altijd
    // (§7): bestaat, actief, toegang (RLS), geïndexeerd. Faalt een check, dan een
    // concrete melding — nooit een stille terugval naar de hele bibliotheek.
    const gevraagdeScopeIds = (body.document_scope?.document_ids ?? []).filter(
      (id) => typeof id === "string" && id.length > 0
    );
    let scopeDocumentIds: string[] | undefined;
    let scopeTitels: string[] = [];

    if (gevraagdeScopeIds.length > 0) {
      // Documentrijen ophalen — RLS beperkt tot eigen fonds (+ generiek). Een
      // vreemd-fonds-id valt buiten deze set en wordt door valideerScope afgewezen.
      const { data: docRows } = await supabase
        .from("documenten")
        .select("id, titel, bron, actief, geindexeerd, gepubliceerd, aangemaakt")
        .in("id", gevraagdeScopeIds);

      // Chunk-presentie per document (is het doorzoekbaar gemaakt?).
      const { data: chunkRows } = await supabase
        .from("document_chunks")
        .select("document_id")
        .in("document_id", gevraagdeScopeIds)
        .limit(2000);
      const metChunks = new Set(
        (chunkRows ?? []).map((r) => r.document_id as string)
      );

      const gevonden: ScopeDocumentRij[] = (docRows ?? []).map((d) => ({
        id: d.id as string,
        titel: (d.titel as string) ?? "(zonder titel)",
        bron: (d.bron as string) ?? "",
        actief: d.actief !== false,
        geindexeerd: d.geindexeerd === true,
        gepubliceerd: (d.gepubliceerd as string | null) ?? null,
        aangemaakt: (d.aangemaakt as string | null) ?? null,
        heeft_chunks: metChunks.has(d.id as string),
      }));

      const validatie = valideerScope(gevraagdeScopeIds, gevonden);
      if (!validatie.ok) {
        return NextResponse.json({ error: validatie.melding }, { status: 400 });
      }
      scopeDocumentIds = validatie.documenten.map((d) => d.id);
      scopeTitels = validatie.documenten.map((d) => d.titel);
    }

    const scopeActief = !!scopeDocumentIds && scopeDocumentIds.length > 0;

    // ── Transformatie-vervolgactie (FO §13) ─────────────────────────────────
    // De beurt bewerkt het vorige antwoord (herschrijf-intent). Vereist dat er
    // daadwerkelijk een eerder assistent-antwoord in de historie staat; anders is
    // er niets te transformeren en valt de route terug op normaal gedrag.
    const heeftVorigAntwoord = messages
      .slice(0, -1)
      .some((m) => m.role === "assistant");
    const transformatieActief = body.transformatie === true && heeftVorigAntwoord;

    // ── Increment I-2 (FO §11a) — automatische bronkeuze ────────────────────
    // Buiten een document-scope bepaalt het systeem zélf of de vraag fonds-,
    // algemeen- of gecombineerd-gericht is (pure heuristiek, lib/vraagtype.ts).
    // Een door de gebruiker gekozen verduidelijkingschip (bron_intent_override)
    // is leidend en zet de twijfel uit. Bij blijvende twijfel vragen we eerst
    // terug i.p.v. te gokken (schijnzekerheid-guardrail).
    const alleenFondsdocumenten =
      !scopeActief && body.alleen_fondsdocumenten === true;
    const intentOverride: BronIntent | undefined =
      body.bron_intent_override === "fonds" || body.bron_intent_override === "algemeen"
        ? body.bron_intent_override
        : undefined;
    const bronIntentResultaat: BronIntentResultaat | null = scopeActief
      ? null
      : intentOverride
      ? { intent: intentOverride, vertrouwen: "zeker" }
      : bepaalBronIntent(vraag);
    const bronIntent: BronIntent | undefined = bronIntentResultaat?.intent;

    // Verduidelijkingstak: twijfel → één SSE-event met de vraag + chips, géén
    // modelcall en géén governance_log-antwoordregel (er is geen antwoord). De
    // beslissing om te verduidelijken is puur reproduceerbaar uit de vraag.
    if (
      !transformatieActief &&
      bronIntentResultaat &&
      moetVerduidelijken(bronIntentResultaat, alleenFondsdocumenten)
    ) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "verduidelijking",
                vraag: VERDUIDELIJKINGSVRAAG,
                opties: VERDUIDELIJKING_OPTIES,
              })}\n\n`
            )
          );
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    // Retrieval-modus (verborgen) volgt Design A "combineren-vloer": tenzij de
    // gebruiker expliciet beperkt tot fondsdocumenten, halen we altijd op — nooit
    // volledig overslaan. Bij een actieve document-scope is dit niet van
    // toepassing (strict-document hieronder).
    const bronModusRetrieval: Modus = scopeActief
      ? "documenten"
      : (bepaalAutoBronModus(alleenFondsdocumenten) as Modus);

    // ── Strategiekeuze (increment 2) bij actieve scope ──────────────────────
    // Specifieke vraag → targeted retrieval (increment 1). Dekkingsbrede vraag →
    // full-document (klein doc) of map-reduce (groot doc). Opt-in algemene kennis
    // staat hier los van: het bepaalt alleen of het eindantwoord strict blijft of
    // de drie-deling krijgt. Vraagtype op de ORIGINELE vraag (niet de zoekvraag).
    const algemeneKennis =
      scopeActief && body.document_scope?.algemene_kennis === true;
    let scopeStrategie: Strategie = "targeted";
    let breedChunks: DocumentChunk[] = [];
    let breedBatches: DocumentChunk[][] = [];
    let breedAfgekapt = false;

    if (scopeActief && !transformatieActief) {
      if (bepaalVraagtype(vraag) === "breed") {
        breedChunks = await haalDocumentChunks(scopeDocumentIds!);
        const totaalTekst = breedChunks.map((c) => c.tekst).join("\n\n");
        scopeStrategie = kiesStrategie(
          "breed",
          schatTokens(totaalTekst),
          VOLLEDIG_DOC_TOKEN_DREMPEL
        );
        if (scopeStrategie === "map_reduce") {
          const r = maakBatches(breedChunks, MAP_BATCH_TOKENS, MAX_BATCHES);
          breedBatches = r.batches;
          breedAfgekapt = r.afgekapt;
        }
      }
    }
    const breedActief =
      scopeActief && !transformatieActief && scopeStrategie !== "targeted";

    // ── Antwoordmodusfamilie (Increment G) ──────────────────────────────────
    // Orthogonaal op de bron-modus. Vastgezet (gesprekken.actieve_antwoordmodus)
    // is leidend; anders auto-detectie op de vraag. Increment I-1 (rustige
    // weergave §11c): de afwijking wordt niet meer als globale wissel-melding
    // getoond maar — waar relevant — als conditionele inline-melding bij het
    // antwoord (interpretatieve duiding/besluitvorming).
    const vastgezetteModus: Antwoordmodus | null = body.actieve_antwoordmodus ?? null;
    const gedetecteerdeModus: Antwoordmodus = bepaalAntwoordmodus(vraag);
    const antwoordmodus: Antwoordmodus = vastgezetteModus ?? gedetecteerdeModus;

    // Retrieval-filters volgen de antwoordmodus (peildatum = vandaag) + de
    // bronsoort-weging volgt het vraagtype. Bij een ACTIEVE document-scope laten
    // we de status-/geldigheidsfilter bewust achterwege: de gebruiker koos dat
    // specifieke stuk en wil het zien, ongeacht actuele-bron-status.
    const vandaag = new Date().toISOString().slice(0, 10);
    const retrievalFilters: RetrievalFilters | undefined = scopeActief
      ? undefined
      : {
          modus: retrievalModusVoor(antwoordmodus),
          peildatum: vandaag,
          bronsoortprofiel: bepaalBronsoortprofiel(vraag),
        };

    // RAG-zoeken: voor de bibliotheek-modi, of bij een actieve scope met een
    // SPECIFIEKE vraag (targeted). Brede scope-vragen halen hieronder hun chunks
    // via haalDocumentChunks (volledige dekking i.p.v. top-N).
    let chunks: DocumentChunk[] = [];
    let bronnen: BronVerwijzing[] = [];
    let contextTekst = "";
    let retrievalMeta: RetrievalMeta | null = null;

    if (!breedActief && (scopeActief || bronModusRetrieval === "documenten" || bronModusRetrieval === "combineren")) {
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

      const res = await zoekRelevanteChunksMetMeta(
        zoekVraag,
        fonds_id,
        CHUNK_BUDGET,
        hybrideAan,
        scopeDocumentIds,
        retrievalFilters
      );
      chunks = res.chunks;
      retrievalMeta = { ...res.meta, zoekvraag: zoekVraag, gereformuleerd };
      // Auditspoor (§9): leg de scope vast waarop deze vraag is beperkt.
      if (scopeActief) {
        retrievalMeta.scope = {
          document_ids: scopeDocumentIds!,
          titels: scopeTitels,
          strategie: "targeted",
          algemene_kennis: algemeneKennis,
        };
      }
      // Increment D — verrijk notulensegment-chunks met vergadering/agendapunt
      // zodat de bronvermelding "Vastgestelde notulen …, agendapunt N — …" klopt.
      chunks = await verrijkNotulenChunks(chunks);
      const ctx = maakContext(chunks);
      contextTekst = ctx.contextTekst;
      bronnen = ctx.bronnen;

      // Besluitvorming-modus (Increment G): voeg de Decision Object-
      // besluitregistratie van de relevante procesinstantie(s) toe als LEIDENDE
      // formele bron (regressietests #5/#12). Afgeleid uit de top-chunks
      // (denorm procesinstantie_id); RLS van decision_objects blijft leidend.
      if (antwoordmodus === "besluitrijpheid") {
        const procesIds = topProcesinstanties(
          chunks.map((c) => c.documenten.procesinstantie_id)
        );
        const besluitBronnen = await haalBesluitBronnen(supabase, procesIds);
        if (besluitBronnen.length > 0) {
          const fb = opmaakBesluitContext(besluitBronnen);
          // Formele bron leidend: vóór de document-context en vóór de bronkaarten.
          contextTekst = `${fb.contextTekst}\n\n---\n\n${contextTekst}`;
          bronnen = [...fb.bronnen, ...bronnen];
          if (retrievalMeta) {
            retrievalMeta = { ...retrievalMeta, besluitbronnen: besluitBronnen.length };
          }
        }
      }
    }

    // Dekkingsbrede scope (increment 2): volledige documentdekking. Bronnen op
    // documentniveau (paginaverwijzingen in de tekst i.p.v. [Bron N]-pills); bij
    // full-document bouwen we de context hier, bij map-reduce in de stream.
    if (breedActief) {
      chunks = breedChunks;
      bronnen = documentBronnen(breedChunks);
      if (scopeStrategie === "full_document") {
        contextTekst = breedChunks
          .map((c) => `${locatieLabel(c)}${c.tekst}`)
          .join("\n\n");
      }
      retrievalMeta = {
        methode: "geen",
        opgehaald: breedChunks.length,
        geselecteerd: breedChunks.length,
        chunks: [],
        scope: {
          document_ids: scopeDocumentIds!,
          titels: scopeTitels,
          strategie: scopeStrategie,
          algemene_kennis: algemeneKennis,
          verwerkte_chunks: breedChunks.length,
          batches: scopeStrategie === "map_reduce" ? breedBatches.length : undefined,
          afgekapt: scopeStrategie === "map_reduce" ? breedAfgekapt : undefined,
        },
      };
    }

    // ── Increment I-2 (FO §11a) — promptkeuze ontkoppeld van retrieval ───────
    // De retrieval-modus (bronModusRetrieval) bepaalt OF en hoe breed we ophalen
    // (Design A: combineren-vloer, altijd ophalen). De PROMPT-modus bepaalt welke
    // van de drie kostbare instructiesets (documenten/combineren/algemeen) de AI
    // krijgt. Die koppelen we aan de automatische bron-intentie: een expliciet
    // algemeen-gerichte vraag zónder fondstreffers krijgt de algemene prompt
    // (geen schijn-onderbouwing op afwezige bronnen); verder is combineren de
    // vloer. "Alleen fondsdocumenten" forceert de strikte documenten-prompt.
    const promptModus: Modus = alleenFondsdocumenten
      ? "documenten"
      : bronIntent === "algemeen" && bronnen.length === 0
      ? "algemeen"
      : "combineren";

    // Bouw prompt op basis van modus, met persoonlijke context
    let systeemBlokken: Anthropic.Messages.TextBlockParam[];
    let gebruikersPrompt: string;

    if (transformatieActief) {
      // Herschrijf-intent (FO §13): bewerk het vorige antwoord (staat al in de
      // historie van claudeBerichten). Géén strict-document-weigering; wel
      // grounding (geen nieuwe fondsfeiten). Eventuele gescoopte fragmenten gaan
      // als verankering mee. De antwoordmodus (besluitrijpheid/duiding/…) komt uit
      // de gekozen vervolgactie en stuurt de antwoordstijl.
      const transTitel =
        scopeTitels.length > 0
          ? scopeTitels.map((t) => `«${t}»`).join(", ")
          : null;
      systeemBlokken = bouwSysteemBlokken(
        SP_TRANSFORMATIE_REGELS,
        ctxBestuurder,
        antwoordmodus
      );
      gebruikersPrompt =
        chunks.length > 0
          ? `ONDERSTEUNENDE FRAGMENTEN${
              transTitel ? ` UIT ${transTitel}` : ""
            } (ter verankering; voeg geen feiten toe die hier of in uw vorige antwoord niet staan):\n\n${contextTekst}\n\n---\n\nOPDRACHT (bewerk uw vorige antwoord hierboven): ${vraag}`
          : `OPDRACHT (bewerk uw vorige antwoord hierboven in de berichtgeschiedenis): ${vraag}`;
    } else if (scopeActief) {
      // Strict-document gedrag overschrijft de gekozen modus. De regels hangen af
      // van opt-in algemene kennis (drie-deling) en van breed vs. specifiek.
      const titelLabel =
        scopeTitels.length === 1
          ? `«${scopeTitels[0]}»`
          : scopeTitels.map((t) => `«${t}»`).join(", ");
      const scopeRegels = algemeneKennis
        ? SP_DOCUMENT_SCOPE_ALG_REGELS
        : breedActief
        ? SP_DOCUMENT_SCOPE_BREED_REGELS
        : SP_DOCUMENT_SCOPE_REGELS;
      systeemBlokken = bouwSysteemBlokken(scopeRegels, ctxBestuurder);

      if (scopeStrategie === "map_reduce") {
        // De gebruikersprompt voor map-reduce wordt in de stream opgebouwd uit de
        // map-deelanalyses; hier een placeholder (wordt daar vervangen).
        gebruikersPrompt = "";
      } else if (breedActief) {
        // full-document: volledige documenttekst in de prompt.
        gebruikersPrompt = `VOLLEDIGE INHOUD VAN HET DOCUMENT ${titelLabel}:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}`;
      } else {
        // targeted (increment 1): top-N fragmenten.
        gebruikersPrompt =
          chunks.length > 0
            ? `BESCHIKBARE FRAGMENTEN UIT HET DOCUMENT ${titelLabel}:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}\n\nBeantwoord de vraag uitsluitend op basis van bovenstaande fragmenten. Staat het antwoord er niet in, zeg dan letterlijk: "Dit is niet in dit document aangetroffen."`
            : `In het document ${titelLabel} zijn geen passages gevonden die op deze vraag aansluiten.\n\nVRAAG: ${vraag}\n\nAls het antwoord niet in dit document staat, antwoord dan letterlijk: "Dit is niet in dit document aangetroffen." Verzin geen antwoord en vul niet aan uit andere bronnen of algemene kennis.`;
      }
    } else if (promptModus === "algemeen") {
      systeemBlokken = bouwSysteemBlokken(SP_ALGEMEEN_REGELS, ctxBestuurder, antwoordmodus);
      gebruikersPrompt = `VRAAG: ${vraag}`;
    } else if (promptModus === "combineren") {
      systeemBlokken = bouwSysteemBlokken(SP_COMBINEREN_REGELS, ctxBestuurder, antwoordmodus);
      gebruikersPrompt =
        chunks.length > 0
          ? `BESCHIKBARE INTERNE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}`
          : `Er zijn geen interne documenten gevonden die direct relevant zijn voor deze vraag.\n\nVRAAG: ${vraag}\n\nGebruik je algemene kennis om de vraag zo goed mogelijk te beantwoorden, en markeer claims met [Algemene kennis]. Sluit af met een opmerking dat er geen interne bronnen zijn gevonden.`;
    } else {
      // documenten (strikte modus)
      systeemBlokken = bouwSysteemBlokken(SP_DOCUMENTEN_REGELS, ctxBestuurder, antwoordmodus);
      gebruikersPrompt =
        chunks.length > 0
          ? `BESCHIKBARE BRONNEN:\n\n${contextTekst}\n\n---\n\nVRAAG: ${vraag}`
          : `Er zijn geen relevante documenten gevonden voor deze vraag.\n\nVRAAG: ${vraag}\n\nGeef aan dat er geen relevante bronnen zijn gevonden en stel voor welk type document zou kunnen helpen.`;
    }

    // Bij een actieve scope is het gedrag strict-document, ongeacht de gekozen
    // modus. Voor de UI-meta en het auditspoor loggen we dat als 'documenten'
    // (strikt op interne bronnen); de scopedetails staan in retrieval_meta.
    const effectieveModus: Modus = scopeActief ? "documenten" : promptModus;

    // ── Increment I-1 (FO §11c) — rustige weergave ──────────────────────────
    // Bronbasis-samenvatting voor het paneel "Onderbouwing en bronnen" en het
    // auditspoor (§11d). Inline-meldingen pre-stream: deterministisch op basis
    // van bron-modus + antwoordmodus + treffers. De #4-melding (algemene kennis
    // náást treffers) hangt van de antwoordinhoud af en wordt ná het streamen
    // herberekend en in het 'done'-event meegestuurd.
    const bronbasis = bronbasisLabel(bronModusRetrieval, bronnen.length, scopeActief);

    // Increment I-3 — uniform bronmodel. De documentbronnen zijn nu al bekend;
    // de model_knowledge-bronnen (algemene kennis) hangen van de antwoordinhoud af
    // en worden ná het streamen afgeleid. Web-retrieval bestaat nog niet (Scenario
    // B), dus web_retrieval_actief = false en er komen geen web-bronnen bij.
    const documentSources: AssistantSource[] = bronnen.map(documentBronNaarSource);
    const sourceSamenvattingPre = bouwSourceSamenvatting(documentSources, false);
    const inlineMeldingenPre = bepaalInlineMeldingen({
      bronModus: bronModusRetrieval,
      antwoordmodus,
      aantalBronnen: bronnen.length,
      scopeActief,
    });

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
          send({
            type: "meta",
            bronnen,
            modus: effectieveModus,
            transformatie: transformatieActief,
            chunks_gevonden: chunks.length,
            scope: scopeActief
              ? {
                  document_ids: scopeDocumentIds,
                  titels: scopeTitels,
                  strategie: scopeStrategie,
                }
              : null,
            // Increment G/I-1 — actieve antwoordmodus + label voor het paneel
            // "Onderbouwing en bronnen" (rustige weergave §11c).
            antwoordmodus,
            antwoordmodus_label: ANTWOORDMODUS_LABEL[antwoordmodus],
            retrieval_modus: retrievalFilters?.modus ?? null,
            peildatum: retrievalFilters?.peildatum ?? null,
            // Increment F (FO §14) — profielsturing-status voor het paneel
            // "Onderbouwing en bronnen". De transparantie ("ordening op uw profiel
            // afgestemd") landt deterministisch hier, niet inline in het antwoord.
            profielsturing: profielsturingStatus,
            // Increment I-1 (FO §11c) — rustige weergave: bronbasis voor het
            // onderbouwingspaneel + deterministische inline-meldingen.
            bronbasis,
            inline_meldingen: inlineMeldingenPre,
            // Increment I-2 (FO §11a) — automatische bronkeuze: de (verborgen)
            // intentie + gekozen retrieval-modus. Géén zichtbare badge in de
            // chat; uitsluitend voor het paneel "Onderbouwing en bronnen".
            bron_intent: bronIntent ?? null,
            bron_vertrouwen: bronIntentResultaat?.vertrouwen ?? null,
            bron_modus_auto: scopeActief ? null : bronModusRetrieval,
            alleen_fondsdocumenten: alleenFondsdocumenten,
            bron_intent_override: scopeActief ? false : intentOverride !== undefined,
            // Increment I-3 — uniform bronmodel voor het paneel "Onderbouwing en
            // bronnen". Documentbronnen zijn nu bekend; model_knowledge volgt in
            // 'done'. web_retrieval_actief signaleert dat er (nog) geen live
            // web-retrieval is — de UI toont dat expliciet.
            sources: documentSources,
            source_summary: sourceSamenvattingPre,
            web_retrieval_actief: false,
          });

          // Map-reduce (increment 2): verwerk het document in batches (map, met
          // het goedkope model) en bouw daaruit de reduce-prompt. De maps zijn
          // niet-streambaar → we sturen progress-events; de reduce-stap streamt
          // wél token-voor-token. De interne calls vallen binnen deze ene
          // gebruikersactie en raken de WP2-rate-limit dus niet (die is bovenaan
          // de route al één keer geteld).
          let streamMessages = claudeBerichten;
          if (scopeStrategie === "map_reduce") {
            const titelLabel = scopeTitels[0] ? `«${scopeTitels[0]}»` : "het document";
            const deelanalyses: string[] = [];
            for (let i = 0; i < breedBatches.length; i++) {
              send({
                type: "progress",
                fase: "analyse",
                batch: i + 1,
                totaal: breedBatches.length,
              });
              const batchTekst = breedBatches[i]
                .map((c) => `${locatieLabel(c)}${c.tekst}`)
                .join("\n\n");
              const mapResp = await anthropic.messages.create({
                model: MAP_MODEL,
                max_tokens: 1200,
                system: SP_MAP_EXTRACTIE,
                messages: [
                  {
                    role: "user",
                    content: `VRAAG: ${vraag}\n\nDOCUMENTDEEL ${i + 1}/${breedBatches.length} uit ${titelLabel}:\n\n${batchTekst}`,
                  },
                ],
              });
              const mapTekst =
                mapResp.content[0]?.type === "text" ? mapResp.content[0].text.trim() : "";
              if (mapTekst && !/^geen$/i.test(mapTekst)) {
                deelanalyses.push(`— Deel ${i + 1}:\n${mapTekst}`);
              }
            }

            const dekkingNoot = breedAfgekapt
              ? "\n\nLET OP: het document was te groot om volledig te verwerken; alleen de eerste delen zijn meegenomen. Meld in het antwoord dat de dekking gedeeltelijk is."
              : "";
            const reducePrompt = `DEELANALYSES VAN HET DOCUMENT ${titelLabel} (${breedBatches.length} delen):\n\n${
              deelanalyses.join("\n\n") || "(geen relevante passages aangetroffen in het document)"
            }\n\n---\n\nVRAAG: ${vraag}\n\nStel op basis van bovenstaande deelanalyses één samenhangend antwoord op het document op. Gebruik paginaverwijzingen "(pag. X)" waar die in de deelanalyses staan.${dekkingNoot}`;

            streamMessages = [{ role: "user" as const, content: reducePrompt }];
          }

          let volledig = "";
          // Duiding/sparring leveren langere, gestructureerde antwoorden → ruimer
          // budget (zoals de env-vlag BESTUURLIJKE_STIJL al deed).
          const ruimBudget =
            BESTUURLIJKE_STIJL || antwoordmodus === "duiding" || antwoordmodus === "sparring";
          const claudeStream = anthropic.messages.stream({
            model: AI_MODEL,
            max_tokens: ruimBudget ? MAX_TOKENS_BESTUURLIJK : MAX_TOKENS,
            system: systeemBlokken,
            messages: streamMessages,
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

          // Increment I-1 (FO §11c) — herbereken de inline-meldingen mét de
          // antwoordinhoud: tel [Algemene kennis]/[Volgens wetgeving]-markeringen
          // zodat de #4-melding (algemene kennis náást fondsdocumenten) verschijnt.
          const algemeneKennisMarkers = (
            volledig.match(/\[(?:Algemene kennis|Volgens wetgeving)\]/gi) || []
          ).length;
          const inlineMeldingenFinaal = bepaalInlineMeldingen({
            bronModus: bronModusRetrieval,
            antwoordmodus,
            aantalBronnen: bronnen.length,
            scopeActief,
            algemeneKennisMarkers,
          });

          // Increment I-3 — leid nu (mét de antwoordinhoud) de model_knowledge-
          // bronnen af: één per door het antwoord GENOEMDE instantie per
          // markertype. Verzint nooit een instantie die niet in de tekst staat.
          // Bij scope of pure documentmodus levert dit niets (geen algemene kennis).
          const modelKennisSources = scopeActief
            ? []
            : modelKennisBronnenUitAntwoord(volledig);
          const alleSources: AssistantSource[] = [
            ...documentSources,
            ...modelKennisSources,
          ];
          const sourceSamenvatting = bouwSourceSamenvatting(alleSources, false);
          // Markeer-handhaving (audit-signaal, geen blokkade): in pure algemeen-
          // modus hoort minstens één algemene-kennismarker te staan. Ontbreekt die,
          // dan is de herkomst-transparantie incompleet → zichtbaar in het auditspoor.
          const markeringOntbreekt = ontbrekendeAlgemeneKennisMarkering(
            scopeActief ? "documenten" : bronModusRetrieval,
            algemeneKennisMarkers
          );

          // Increment G/I-1 — de actieve antwoordmodus, bronbasis en getoonde
          // inline-meldingen horen altijd in het auditspoor (B10, §11d), óók in
          // modus 'algemeen' (geen retrieval → nog geen retrievalMeta).
          const teLoggenMeta: RetrievalMeta = {
            ...(retrievalMeta ?? {
              methode: "geen",
              opgehaald: 0,
              geselecteerd: 0,
              chunks: [],
            }),
            antwoordmodus,
            transformatie: transformatieActief,
            bronbasis,
            inline_meldingen: inlineMeldingenFinaal,
            // Increment I-3 — uniform bronmodel volledig in het auditspoor: alle
            // herkomst (document + model_knowledge) + telling + de markeer-handhaving.
            sources: alleSources,
            source_summary: sourceSamenvatting,
            markeringen: {
              algemene_kennis_markers: algemeneKennisMarkers,
              instanties: modelKennisSources
                .map((s) => s.instantie)
                .filter((i): i is string => i !== null),
              ontbrekend_signaal: markeringOntbreekt,
            },
            // Increment F (FO §14, B10/§11d) — profielsturing volledig herleidbaar:
            // status + welke profielvelden de prioritering voedden. Geen profielinhoud.
            profielsturing: profielsturingStatus,
            ...(profielsturingAspecten
              ? { profielsturing_aspecten: profielsturingAspecten }
              : {}),
            // Increment I-2 (FO §11a/§11d) — automatische bronkeuze in het
            // auditspoor: welke intentie, met welk vertrouwen, welke (verborgen)
            // retrieval-modus, en of de gebruiker tot fondsdocumenten beperkte.
            ...(scopeActief
              ? {}
              : {
                  bron_intent: bronIntent,
                  bron_vertrouwen: bronIntentResultaat?.vertrouwen,
                  bron_modus_auto: bronModusRetrieval,
                  alleen_fondsdocumenten: alleenFondsdocumenten,
                  bron_intent_override: intentOverride !== undefined,
                }),
          };

          // Loggen ná voltooiing, met het volledige antwoord.
          await supabase.from("governance_log").insert({
            gebruiker_id: user.id,
            gebruiker_naam: profiel?.naam || user.email,
            fonds_id,
            vraag,
            antwoord: volledig,
            bronnen,
            modus: effectieveModus,
            model: AI_MODEL,
            retrieval_meta: teLoggenMeta,
          });

          // Stuur de definitieve inline-meldingen mee zodat de UI de #4-melding
          // (content-afhankelijk) kan tonen ná het streamen.
          send({
            type: "done",
            inline_meldingen: inlineMeldingenFinaal,
            // Increment I-3 — de content-afhankelijke model_knowledge-bronnen +
            // bijgewerkte samenvatting voor het paneel "Onderbouwing en bronnen".
            model_kennis: modelKennisSources,
            source_summary: sourceSamenvatting,
          });
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
