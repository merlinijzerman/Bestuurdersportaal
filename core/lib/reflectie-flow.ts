// ============================================================================
//  core/lib/reflectie-flow.ts — Plateau B / B-1: de reflectietoestandsmachine
//  als pure, testbare kern.
// ----------------------------------------------------------------------------
//  WAAROM DIT BESTAAT
//
//  De toestandsmachine is server-controlled (besluit 0110): de autoriteit ligt
//  in `public.reflectie_transitie()`, die de actuele status opnieuw uitleest en
//  daartegen valideert. Een clientwaarde is nooit leidend (FR-67).
//
//  Deze module is daarom NIET de autoriteit maar de SPIEGEL — hetzelfde patroon
//  als core/lib/audit-meta.ts tegenover meta_basisniveau() in SQL. Ze bestaat om
//  drie redenen:
//
//    1. De UI moet weten welke acties nu zichtbaar mogen zijn, zonder een
//       netwerkrondje per knop.
//    2. De transitietabel wordt op één plek in TypeScript bevroren
//       (reflectie-flow.sanity.ts), zodat een stille wijziging aan de SQL-kant
//       zichtbaar wordt als een verschil in plaats van als vreemd gedrag.
//    3. De labels en ingangen staan hier letterlijk, zodat AC-26 (de drie
//       afrondlabels; "Niet opslaan"/"Niets bewaren"/"Alleen voor mij bewaren"
//       en "Verwijderen" komen NIET voor) programmatisch toetsbaar is.
//
//  ⚠ GEEN REFLECTIEMARKERING, NERGENS (besluit 0112). Deze module bevat geen
//  enkel pad naar `governance_log`, `retrieval_meta` of een andere registratie.
//  De flowstatus leeft uitsluitend in `gesprek_reflectie_state`, is auteur-only
//  leesbaar en verdwijnt met het gesprek.
//
//  Pure functies, geen DB-toegang, geen I/O. Getest via reflectie-flow.sanity.ts.
// ============================================================================

/** De statussen uit de CHECK-constraint op `gesprek_reflectie_state.status`. */
export const REFLECTIE_STATUSSEN = [
  "niet_actief",
  "ingang_gekozen",
  "verdieping_1",
  "verdieping_2",
  "verdieping_3",
  "conceptweergave",
  "afgerond",
] as const;

export type ReflectieStatus = (typeof REFLECTIE_STATUSSEN)[number];

/** De acties die `reflectie_transitie(p_actie)` accepteert. */
export const REFLECTIE_ACTIES = [
  "start",
  "antwoord",
  "concept",
  "afronden",
  "afbreken",
  // B-opt tranche 1a (besluit "herformuleren als expliciete transitie"): de
  // bestuurder scherpt vanuit de conceptweergave zijn EIGEN tekst aan. Blijft in
  // `conceptweergave` en verhoogt de beurt NIET — het is geen extra
  // verdiepingsvraag maar dezelfde overweging opnieuw verwoord. De normale
  // invoerbalk blijft de reflectie beëindigen (FR-56); dit is het aparte pad dat
  // de belofte van de knop "Aanpassen" waarmaakt.
  "herformuleren",
] as const;

export type ReflectieActie = (typeof REFLECTIE_ACTIES)[number];

/**
 * De reflectie-ingangen uit ontwerp v1.0 §9.3. De gekozen ingang wordt een
 * gebruikersbericht in de chat en staat daarnaast in de flowstatus — nergens
 * anders.
 *
 * "Geen aanvullende reflectie" staat hier bewust NIET tussen: die keuze slaat de
 * functie over en wordt nergens opgeslagen (FR-22). Ze is geen waarde.
 */
export const REFLECTIE_INGANGEN = [
  "informatie_ontbreekt",
  "onderbouwing",
  "uitvoeringsrisico",
  "evenwichtigheid",
  "alternatief",
  "uitlegbaarheid",
  "niet_te_plaatsen",
  "overtuiging",
] as const;

export type ReflectieIngang = (typeof REFLECTIE_INGANGEN)[number];

/** Labels van de ingangen, letterlijk uit v1.0 §9.3. */
export const INGANG_LABEL: Record<ReflectieIngang, string> = {
  informatie_ontbreekt: "Ik mis informatie",
  onderbouwing: "Ik twijfel aan de onderbouwing",
  uitvoeringsrisico: "Ik zie een uitvoeringsrisico",
  evenwichtigheid: "Ik twijfel aan de evenwichtigheid",
  alternatief: "Ik mis een serieus alternatief",
  uitlegbaarheid: "Ik vind dit moeilijk uitlegbaar",
  niet_te_plaatsen: "Er klopt iets niet, maar ik kan het nog niet plaatsen",
  overtuiging: "Ik wil vastleggen wat mij juist overtuigt",
};

/**
 * De verdiepingsvraag per ingang (v1.0 §9.6). De assistent stelt hem in eigen
 * woorden; deze tekst is de deterministische val-terug én het anker voor de
 * toon. Er wordt nooit op inhoud geclassificeerd — de ingang bepaalt de vraag.
 */
export const INGANG_VERDIEPING: Record<ReflectieIngang, string> = {
  informatie_ontbreekt:
    "Welke informatie ontbreekt om een oordeel te kunnen vormen?",
  onderbouwing: "Gaat het om bronnen, cijfers, aannames of de redenering?",
  uitvoeringsrisico:
    "Zit dit in capaciteit, techniek, proces, leverancier of planning?",
  evenwichtigheid:
    "Welke groep of welk belang krijgt mogelijk onvoldoende gewicht?",
  alternatief: "Welk alternatief zou nog onderzocht moeten worden?",
  uitlegbaarheid: "Aan wie, en op welk onderdeel?",
  niet_te_plaatsen:
    "Welke ervaring, passage of mogelijke uitkomst roept dit op?",
  overtuiging: "Welk argument of gegeven geeft juist vertrouwen?",
};

/**
 * Bij `niet_te_plaatsen` drie optionele open vragen waarvan de gebruiker er één
 * kiest (v1.0 §9.6). De derde gebruikt een pre-mortemtechniek. Het stellen
 * ervan is geen aanwijzing dat er een probleem is.
 */
export const NIET_TE_PLAATSEN_VRAGEN = [
  "Wat zou er moeten kloppen om dit besluit wél navolgbaar te maken?",
  "Wie zou hier heel anders naar kijken, en waarom?",
  "Stel dat dit over twee jaar verkeerd is uitgepakt — wat was dan waarschijnlijk de oorzaak?",
] as const;

/**
 * De drie afrondlabels bij de conceptweergave (FR-58, AC-26, besluit 0113).
 *
 * Deze lijst is bindend. "Niet opslaan", "Niets bewaren" en "Alleen voor mij
 * bewaren" komen niet voor: de dialoog staat op dat moment al in de privéchat,
 * dus die woorden zouden liegen. "Verwijderen" is geen bestemming binnen de
 * reflectieflow (FR-59) — een chat verwijderen is een afzonderlijke beheeractie.
 */
export const AFRONDLABELS = [
  "Klopt",
  "Aanpassen",
  "Afronden zonder aparte notitie",
] as const;

/** Labels die nooit in de reflectie-interface mogen staan. Bewaakt door de sanitytest. */
export const VERBODEN_LABELS = [
  "Niet opslaan",
  "Niets bewaren",
  "Alleen voor mij bewaren",
  "Verwijderen",
] as const;

/**
 * Fail-safe-termijn voor een onderbroken flow (TO §6.1, FR-57).
 *
 * ⚠ WERKHYPOTHESE, gevalideerd in de gebruikerstoets van besluit 0122. Bij
 * twijfel valt de status terug op `niet_actief`: liever een reflectie die de
 * gebruiker opnieuw moet starten dan een chat die morgen onverwacht in
 * reflectiemodus staat.
 */
export const FAILSAFE_UREN = 24;

/** Maximaal aantal verdiepingsbeurten; daarna is `conceptweergave` verplicht. */
export const MAX_BEURTEN = 3;

/**
 * De transitietabel uit TO §6.1 / v1.0 §9.4.
 *
 * ⚠ CORRECTIE OP TO §6.1. Het TO schrijft twee regels die elkaar uitsluiten:
 * `verdieping_2 + antwoord → verdieping_3 of conceptweergave` mét "bij beurt ≥ 3
 * verplicht conceptweergave", én `verdieping_3 + antwoord → conceptweergave`.
 * Omdat `beurt` het aantal gegeven antwoorden telt, is de beurt ná een antwoord
 * vanuit `verdieping_2` altijd 3 — de status `verdieping_3` zou daarmee
 * onbereikbaar zijn, en de regel eronder dode letter. Andersom zou een vierde
 * antwoord vanuit `verdieping_3` het maximum van "twee of drie
 * verdiepingsvragen" (v1.0 §9.6) overschrijden.
 *
 * Opgelost door `beurt` strikt als plafond te lezen:
 *
 *   • het derde antwoord landt in `verdieping_3` (dus alle drie de statussen
 *     zijn bereikbaar en `MAX_BEURTEN` betekent echt iets);
 *   • vanuit `verdieping_3` is `antwoord` geweigerd — het plafond is bereikt;
 *   • `concept` brengt de flow vanuit elke verdieping naar de conceptweergave,
 *     zowel wanneer de assistent eerder al genoeg heeft als wanneer het plafond
 *     is bereikt.
 *
 * Netto: maximaal drie verdiepingsantwoorden, precies zoals v1.0 §9.6 vraagt.
 */
const TRANSITIES: ReadonlyArray<{
  van: ReflectieStatus;
  actie: ReflectieActie;
  naar: readonly ReflectieStatus[];
}> = [
  { van: "niet_actief", actie: "start", naar: ["ingang_gekozen"] },
  { van: "ingang_gekozen", actie: "antwoord", naar: ["verdieping_1"] },
  { van: "verdieping_1", actie: "antwoord", naar: ["verdieping_2"] },
  { van: "verdieping_2", actie: "antwoord", naar: ["verdieping_3"] },
  // GEEN `verdieping_3 + antwoord`: het beurtplafond is dan bereikt. Zie de
  // correctie hierboven.
  //
  // `concept` is de expliciete sprong naar de conceptweergave — wanneer de
  // assistent na beurt 1 of 2 al genoeg heeft, én wanneer het plafond is
  // bereikt. `antwoord` verhoogt de beurt, deze actie niet.
  { van: "verdieping_1", actie: "concept", naar: ["conceptweergave"] },
  { van: "verdieping_2", actie: "concept", naar: ["conceptweergave"] },
  { van: "verdieping_3", actie: "concept", naar: ["conceptweergave"] },
  // `herformuleren` is een zelf-lus op de conceptweergave (B-opt tranche 1a): de
  // bestuurder herformuleert zijn eigen overweging, waarna het concept opnieuw
  // wordt opgebouwd. De status blijft `conceptweergave` en de beurt verandert
  // niet — het is geen nieuwe verdiepingsvraag. Enkel vanuit `conceptweergave`
  // toegestaan; vanuit elke andere status valt hij door naar ongeldige_transitie.
  { van: "conceptweergave", actie: "herformuleren", naar: ["conceptweergave"] },
  { van: "conceptweergave", actie: "afronden", naar: ["afgerond"] },
  // Afbreken kan vanuit elke status waarin de flow leeft. Wordt óók getriggerd
  // door een gewone chatbeurt via de normale invoerbalk (FR-56).
  { van: "ingang_gekozen", actie: "afbreken", naar: ["niet_actief"] },
  { van: "verdieping_1", actie: "afbreken", naar: ["niet_actief"] },
  { van: "verdieping_2", actie: "afbreken", naar: ["niet_actief"] },
  { van: "verdieping_3", actie: "afbreken", naar: ["niet_actief"] },
  { van: "conceptweergave", actie: "afbreken", naar: ["niet_actief"] },
  // Na afronding: bestemmingskeuze (plateau C) of "terug naar het gesprek".
  { van: "afgerond", actie: "afbreken", naar: ["niet_actief"] },
];

/** Alle statussen waarin de reflectieflow actief is (dus: alles behalve `niet_actief`). */
export function isActief(status: ReflectieStatus): boolean {
  return status !== "niet_actief";
}

/**
 * De toegestane doelstatussen voor (status, actie). Lege array = de transitie
 * bestaat niet en moet `ongeldige_transitie` opleveren.
 */
export function toegestaneDoelen(
  status: ReflectieStatus,
  actie: ReflectieActie
): readonly ReflectieStatus[] {
  const rij = TRANSITIES.find((t) => t.van === status && t.actie === actie);
  return rij ? rij.naar : [];
}

/** Is deze overgang toegestaan? Spiegelt de validatie in `reflectie_transitie()`. */
export function magTransitie(
  status: ReflectieStatus,
  actie: ReflectieActie,
  doel?: ReflectieStatus
): boolean {
  const doelen = toegestaneDoelen(status, actie);
  if (doelen.length === 0) return false;
  return doel === undefined ? true : doelen.includes(doel);
}

/**
 * De volgende status bij een `antwoord`-actie, gegeven de beurt die daarná zou
 * gelden. Retourneert null wanneer de overgang niet bestaat — óók wanneer het
 * beurtplafond zou worden overschreden. Dat laatste is de regel die voorkomt
 * dat de assistent blijft doorvragen.
 */
export function volgendeNaAntwoord(
  status: ReflectieStatus,
  nieuweBeurt: number
): ReflectieStatus | null {
  if (nieuweBeurt > MAX_BEURTEN) return null;
  const doelen = toegestaneDoelen(status, "antwoord");
  if (doelen.length === 0) return null;
  return doelen[0];
}

/**
 * Is het beurtplafond bereikt, zodat de volgende stap verplicht de
 * conceptweergave is? De chatroute gebruikt dit om ná het derde antwoord geen
 * vierde verdiepingsvraag te stellen maar het concept te tonen.
 */
export function moetNaarConcept(status: ReflectieStatus, beurt: number): boolean {
  return isActief(status) && status !== "conceptweergave" && status !== "afgerond"
    ? beurt >= MAX_BEURTEN
    : false;
}

/**
 * Fail-safe uit FR-57 / TO §6.1: een status die te lang stil heeft gelegen telt
 * niet meer. Puur op tijd; de tweede voorwaarde ("het laatste bericht is geen
 * reflectiebericht") kan alleen de aanroeper beoordelen en wordt daar toegepast.
 *
 * `nu` en `bijgewerktOp` in milliseconden sinds epoch.
 */
export function isVerlopen(bijgewerktOp: number, nu: number): boolean {
  return nu - bijgewerktOp > FAILSAFE_UREN * 60 * 60 * 1000;
}

/**
 * De status zoals de applicatie hem mag gebruiken: verlopen ⇒ `niet_actief`.
 * "Bij twijfel staat hij op niet_actief" (AC-23) is hier letterlijk de default.
 */
export function effectieveStatus(
  status: ReflectieStatus | null | undefined,
  bijgewerktOp: number | null | undefined,
  nu: number,
  laatsteBerichtIsReflectie = true
): ReflectieStatus {
  if (!status || !REFLECTIE_STATUSSEN.includes(status)) return "niet_actief";
  if (status === "niet_actief") return "niet_actief";
  if (bijgewerktOp === null || bijgewerktOp === undefined) return "niet_actief";
  if (isVerlopen(bijgewerktOp, nu)) return "niet_actief";
  if (!laatsteBerichtIsReflectie) return "niet_actief";
  return status;
}

/** Type-guards voor invoer die van buiten komt (querystring, requestbody). */
export function isReflectieStatus(waarde: unknown): waarde is ReflectieStatus {
  return (
    typeof waarde === "string" &&
    (REFLECTIE_STATUSSEN as readonly string[]).includes(waarde)
  );
}

export function isReflectieActie(waarde: unknown): waarde is ReflectieActie {
  return (
    typeof waarde === "string" &&
    (REFLECTIE_ACTIES as readonly string[]).includes(waarde)
  );
}

export function isReflectieIngang(waarde: unknown): waarde is ReflectieIngang {
  return (
    typeof waarde === "string" &&
    (REFLECTIE_INGANGEN as readonly string[]).includes(waarde)
  );
}
