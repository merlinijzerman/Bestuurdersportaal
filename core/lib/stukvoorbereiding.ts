// ============================================================================
//  "Een stuk voorbereiden" — pure sectie-/instructielaag (T2, bureau-stand).
// ----------------------------------------------------------------------------
//  Eén bron van waarheid voor: de stuksoorten, de vaste secties per stuksoort,
//  de zichtbare leesbare beurt (client), de server-side samengestelde instructie
//  (route) en de gelogde promptvariant (auditspoor). Zo lopen UI, /api/chat en de
//  eval niet uiteen.
//
//  Zusje van core/lib/doorgrond.ts en exact hetzelfde patroon: puur en
//  programmatisch narekenbaar (zie stukvoorbereiding.sanity.ts) — geen DB, geen
//  React, geen modelaanroep. De instructie wordt aan de GEBRUIKERSPROMPT
//  toegevoegd (niet aan de toon-systeemprompt SP_* — CLAUDE.md-guardrail).
//
//  DRIE DINGEN DIE DEZE MODULE HARD MAAKT (ontwerp §6.2/§6.3, guardrails G3/G8/G13):
//   1. Vaste secties per stuksoort — GEEN sectie-picker (halveert de promptmatrix
//      en de evallast, R8). De gebruiker kiest de stuksoort, niet de secties.
//   2. Een verplichte, NIET-uitzetbare slotsectie "Aannames en open punten"
//      (G13, klasse D): SLOTSECTIE staat bewust NIET in de per-stuksoort-lijst,
//      maar wordt door bouwStukInstructie() altijd als laatste toegevoegd. Er is
//      geen parameter om dat te onderdrukken.
//   3. De guardrail-verruiming (B-3/§6.3): een aanbeveling mag, maar UITSLUITEND
//      als voorstel ván het bureau áán het bestuur — nooit als besluit of eigen
//      oordeel, en wat niet uit de bronnen te onderbouwen is komt onder de
//      slotsectie, niet ingevuld met algemene kennis (G8).
//
//  Vaste lengtenorm, GEEN lengteknop: net als doorgrond.ts is de lengte achteraf
//  te sturen via de bestaande vervolgacties (maak_korter/maak_concreter).
// ============================================================================

export type Stuksoort = "oplegger" | "bestuursnotitie" | "memo" | "toelichting";

export interface StuksoortDef {
  id: Stuksoort;
  /** Label in de UI-keuze. */
  titel: string;
  /** Toelichting onder de keuze in de scherpsteltoestand. */
  uiHint: string;
  /**
   * De INHOUDELIJKE secties, in de vaste volgorde waarin ze in het stuk
   * verschijnen. De verplichte slotsectie "Aannames en open punten" staat hier
   * bewust NIET tussen — die wordt door bouwStukInstructie() altijd toegevoegd
   * en is daarmee niet uit te zetten (G13).
   */
  secties: readonly string[];
}

/**
 * De verplichte, niet-uitzetbare slotsectie (G13). Bewust een losse constante en
 * niet één van de per-stuksoort-secties: zo is in de code én in de sanitytest
 * zichtbaar dat geen enkele stuksoort hem kan weglaten.
 */
export const SLOTSECTIE = "Aannames en open punten" as const;

/** De vier stuksoorten met hun vaste secties (ontwerp §6.2). */
export const STUKSOORTEN: readonly StuksoortDef[] = [
  {
    id: "oplegger",
    titel: "Oplegger",
    uiHint: "Beknopte begeleiding bij een stuk: aanleiding en gevraagd besluit.",
    secties: ["Aanleiding", "Gevraagd besluit", "Toelichting"],
  },
  {
    id: "bestuursnotitie",
    titel: "Bestuursnotitie",
    uiHint: "Onderbouwde notitie met een voorstel aan het bestuur.",
    secties: [
      "Samenvatting",
      "Achtergrond",
      "Analyse",
      "Overwegingen",
      "Voorstel aan het bestuur",
    ],
  },
  {
    id: "memo",
    titel: "Memo",
    uiHint: "Kort intern stuk over één onderwerp.",
    secties: ["Aanleiding", "Kern", "Overwegingen"],
  },
  {
    id: "toelichting",
    titel: "Toelichting bij een agendapunt",
    uiHint: "Duiding van een agendapunt ter voorbereiding op de bespreking.",
    secties: ["Onderwerp", "Wat speelt er", "Aandachtspunten voor de bespreking"],
  },
];

/**
 * Versie-identifier van het instructietemplate. Wordt in de Governance Log
 * (retrieval_meta.bureau.promptvariant) vastgelegd zodat achteraf te
 * reconstrueren is wélk template een stuk voortbracht (FR-12, ontwerp §6.4).
 */
export const STUK_PROMPTVARIANT = "bureau_stuk_v1";

// ── Beschikbaarheid + validatie ──────────────────────────────────────────────

const STUKSOORT_IDS: ReadonlySet<Stuksoort> = new Set(STUKSOORTEN.map((s) => s.id));

/** Is dit een geldige stuksoort? Backstop voor de client-invoer in de route. */
export function isStuksoort(waarde: unknown): waarde is Stuksoort {
  return typeof waarde === "string" && STUKSOORT_IDS.has(waarde as Stuksoort);
}

/** De definitie bij een stuksoort, of null bij een onbekende waarde. */
export function stuksoortDef(id: Stuksoort): StuksoortDef | null {
  return STUKSOORTEN.find((s) => s.id === id) ?? null;
}

// ── Zichtbare beurt (client) ──────────────────────────────────────────────────

/**
 * De leesbare gebruikersbeurt die in de chat verschijnt. Bewust kort — de
 * samengestelde instructie is langer en wordt server-side opgebouwd; daarom legt
 * het auditspoor (retrieval_meta.bureau) de parameters vast, niet alleen deze zin.
 *   "Bereid een bestuursnotitie voor over «Wijziging beleggingsbeleid»."
 */
export function bouwStukZin(stuksoort: Stuksoort, onderwerp: string): string {
  const def = stuksoortDef(stuksoort);
  const naam = def ? def.titel.toLowerCase() : "stuk";
  const kern = onderwerp.trim();
  return kern
    ? `Bereid een ${naam} voor over «${kern}».`
    : `Bereid een ${naam} voor.`;
}

// ── Samengestelde instructie (server, gebruikersprompt) ───────────────────────

/**
 * De server-side instructie die in de gebruikersprompt komt (niet in SP_* —
 * CLAUDE.md-guardrail). Somt de vaste secties van de stuksoort op als koppen,
 * voegt ALTIJD de verplichte slotsectie toe (G13) en legt de guardrail-verruiming
 * op (G3/G8): een voorstel mag, maar uitsluitend als voorstel van het bureau aan
 * het bestuur, en ongefundeerde punten horen onder de slotsectie.
 */
export function bouwStukInstructie(stuksoort: Stuksoort): string {
  const def = stuksoortDef(stuksoort);
  // Fail-safe: bij een onbekende stuksoort valt de route hier nooit binnen (de
  // route valideert met isStuksoort), maar we mogen dan geen instructie zonder
  // slotsectie produceren. Een lege sectielijst + de verplichte slotsectie is de
  // veilige ondergrens.
  const inhoud = def?.secties ?? [];
  const koppen = [...inhoud, SLOTSECTIE]
    .map(
      (titel) =>
        `## ${titel}\n${sectieHint(titel, stuksoort)}`
    )
    .join("\n\n");

  return (
    `Stel een concept-${def ? def.titel.toLowerCase() : "stuk"} op, in deze vaste ` +
    `secties, elk onder de opgegeven kop en in deze volgorde:\n\n` +
    koppen +
    `\n\nU levert een CONCEPT ter bewerking, geen eindproduct. Een voorstel of ` +
    `aanbeveling formuleert u uitsluitend als voorstel ván het bureau áán het ` +
    `bestuur — nooit als besluit en nooit als uw eigen oordeel. Wat u niet uit de ` +
    `aangeleverde bronnen kunt onderbouwen, zet u onder "${SLOTSECTIE}"; vul dat ` +
    `niet in met algemene kennis. De sectie "${SLOTSECTIE}" laat u nooit weg, ook ` +
    `niet als u meent dat er geen open punten zijn — benoem dat dan expliciet. ` +
    `Houd het geheel bestuurlijk bruikbaar en to the point.` +
    // T5 A3/A5: het stuk is een afgebakend document, geen chatbeurt. Geen
    // conversationele omlijsting en geen eigen titel — de titel staat al in de
    // exportkop, en de interface toont zelf vervolgacties.
    `\n\nLever UITSLUITEND het stuk zelf op, als afgebakend document. Begin direct ` +
    `met de eerste kop hierboven; schrijf géén begroeting, inleiding, aanhef of ` +
    `eigen titelregel ervóór. Sluit af met "${SLOTSECTIE}" en schrijf daarná niets ` +
    `meer — geen afsluitende vraag, geen aanbod om het korter of anders te maken. ` +
    `Eventuele vervolgacties toont de interface zelf.`
  );
}

// ── Afbakening voor de Word-export (T5 A5) ────────────────────────────────────
// De export mag uitsluitend het stuk bevatten, geen conversationele in-/uitleiding.
// De instructie hierboven laat het model het stuk al kaal opleveren; deze pure
// functie is de afdwingende vangnetlaag: ze knipt een eventuele lead-in vóór de
// eerste kop weg en een conversationele afsluiting ná de inhoud. Ze raakt koppen,
// opsommingen en tabellen nooit aan (die zijn per definitie het stuk).

/** Herkent een conversationele afsluitingsregel (aanbod/vraag ná het stuk). */
const OUTRO_PATROON =
  /^(een paar keuzes|wilt u|zal ik\b|wil ik\b|hieronder (de|het|volgt)|graag,|met vriendelijke groet|laat (het )?mij|hopelijk)/i;

export function extraheerStukBlok(antwoord: string): string {
  const regels = antwoord.split("\n");

  // Start: de eerste markdown-kop. Alles ervóór is een conversationele lead-in.
  const start = regels.findIndex((r) => /^#{1,6}\s+\S/.test(r.trim()));
  const kern = start > 0 ? regels.slice(start) : regels.slice();

  // Einde: knip trailing conversationele alinea's (die het OUTRO-patroon volgen).
  // We scannen van onderaf; een kop/opsomming/tabel/genummerd item stopt het
  // knippen direct — dat is inhoud, geen gesprekstekst.
  let einde = kern.length;
  for (let i = kern.length - 1; i >= 0; i--) {
    const t = kern[i].trim();
    if (!t) continue;
    if (/^#{1,6}\s/.test(t) || /^[-*•]\s/.test(t) || t.startsWith("|") || /^\d+[.)]\s/.test(t)) {
      break;
    }
    if (OUTRO_PATROON.test(t)) {
      einde = i;
      continue;
    }
    break;
  }

  return kern.slice(0, einde).join("\n").trim();
}

/** Korte, per-sectie sturende zin. Houdt het model bij de bedoeling van de kop. */
function sectieHint(titel: string, stuksoort: Stuksoort): string {
  if (titel === SLOTSECTIE) {
    return (
      "Benoem expliciet de aannames waarop dit concept steunt, wat nog niet uit " +
      "de bronnen is te onderbouwen, en welke informatie of navraag nog ontbreekt."
    );
  }
  switch (titel) {
    case "Aanleiding":
      return "Waarom ligt dit voor; wat is de directe aanleiding?";
    case "Gevraagd besluit":
      return "Welk besluit wordt aan het bestuur gevraagd? Formuleer het als voorstel, niet als vaststelling.";
    case "Toelichting":
      return "Onderbouw beknopt waarom dit voorligt en wat de overwegingen zijn.";
    case "Samenvatting":
      return "De kern in enkele regels: wat en waarom.";
    case "Achtergrond":
      return "Context en relevante voorgeschiedenis uit de bronnen.";
    case "Analyse":
      return "Wat blijkt uit de bronnen, en hoe is dat te lezen?";
    case "Overwegingen":
      return "Afwegingen, varianten, voor- en nadelen.";
    case "Voorstel aan het bestuur":
      return "Het voorstel van het bureau, expliciet als voorstel geformuleerd — geen besluit.";
    case "Kern":
      return "Waar het in dit memo om draait.";
    case "Onderwerp":
      return "Waar dit agendapunt over gaat.";
    case "Wat speelt er":
      return "De actuele stand van zaken rond dit punt, op basis van de bronnen.";
    case "Aandachtspunten voor de bespreking":
      return "Wat het bestuur bij de bespreking scherp zou moeten hebben.";
    default:
      // Geen exhaustieve dwang: onbekende koppen krijgen een neutrale hint zodat
      // een latere sectie-uitbreiding niet stilzwijgend zonder sturing landt.
      return "Vul deze sectie op basis van de aangeleverde bronnen.";
  }
}
