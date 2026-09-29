// ============================================================================
//  Wetsgeschiedenis A-light R-3 (#492) — juridisch bronbeleid in de selectie.
// ----------------------------------------------------------------------------
//  PUUR en PROVIDERNEUTRAAL: geen I/O, geen DB, geen chunkvorm. De centrale
//  selectie (`selectie.ts`) roept dit aan; de rol van een kandidaat komt uit
//  `documenttype` + `wetsgeschiedenis_subtype` (weergavemetadata die de adapter
//  al vóór de toelatingspoort verrijkt, #426 D-6) via de bestaande duiding in
//  `wetsgeschiedenis.ts`. Een adapter die geen documenttype levert (SharePoint,
//  web) heeft dus nooit een juridische rol en houdt exact het bestaande gedrag.
//
//  DE POORT (review R-3, punt 1). R-2 geeft `historische_peildatum` ook bij een
//  ankerloze vraag zonder fondscontext ("Welke afspraak gold in de vorige
//  vergadering?" → peildatum/onzeker). Het beleid grijpt daarom alleen in als
//  de vraag aantoonbaar juridisch is:
//    • signaal `juridisch_anker`, of
//    • signaal `zwak_anker` zónder `fondscontext`, of
//    • vertrouwen `zeker`.
//  Anders is het beleid `null` en gedraagt de selectie zich exact als bij
//  `onbekend`: dezelfde volgorde, dezelfde diagnostiek, geen extra sleutel.
//
//  HET BELEID PER INTENTIE. Alleen de posities die JURIDISCHE kandidaten
//  (wetgeving/wetsgeschiedenis) al innamen worden opnieuw gevuld; fonds- en
//  niet-juridische generieke kandidaten behouden hun relatieve volgorde en hun
//  eigen weging. Een laag scorende wetspassage wordt zo niet boven alle
//  fondsstukken getild, maar neemt de plek in van de toelichting die haar anders
//  uit het bronbudget zou drukken.
//    geldend_recht                       — wetgeving vult de juridische plekken;
//                                          wetsgeschiedenis gaat naar de staart
//                                          (alleen als er wetgeving is: zonder
//                                          actuele norm blijft ze staan en meldt
//                                          de antwoordgrens de ontbrekende norm).
//    geldend_recht_en_wetsgeschiedenis   — eerst de beste wetspassage, direct
//                                          gevolgd door de beste wetsgeschiedenis
//                                          (representatie voor beide rollen),
//                                          daarna overige wetgeving vóór overige
//                                          wetsgeschiedenis.
//    bedoeling_totstandkoming            — eerst de beste wetspassage (normatieve
//                                          basis), dan de beste wetsgeschiedenis;
//                                          de rest in oorspronkelijke volgorde.
//    historische_peildatum               — actuele wetgeving wordt UITGESLOTEN:
//                                          zij is geen antwoord op wat destijds
//                                          gold. De antwoordgrens meldt dat
//                                          historische wetsversies ontbreken.
//
//  Een aangenomen amendement heeft via `juridischeDuiding` de rol
//  wetsgeschiedenis: het verklaart de tekst, maar is nooit de actuele norm.
//
//  VOLGORDE IN DE SELECTIE: ná de bronsoortweging én ná de regime-demotie. De
//  door het regime gedemoveerde bronnen (PW↔Wvb) zijn voor dit beleid VAST: ze
//  houden hun plek onderaan, dus het juridisch beleid kan een tegengesteld
//  regime nooit terug omhoog halen (werkticket: regime vóór ranking afdwingen).
//
//  POSITIES. Bij `bedoeling_totstandkoming` en `geldend_recht_en_wetsgeschiedenis`
//  komen de beste wetspassage en de beste wetsgeschiedenis AANEEN op de eerste
//  juridische plek; een niet-juridische kandidaat schuift daardoor hoogstens één
//  plek op. Bij `geldend_recht` en `historische_peildatum` zakt een niet-
//  juridische kandidaat nooit.
// ============================================================================
import type { JuridischeVraagintentie, JuridischeVraagintentieResultaat } from "../vraagtype";
import { juridischeDuiding, type JuridischeRol } from "../wetsgeschiedenis";

/** De intenties waarvoor een juridisch bronbeleid bestaat. */
export type JuridischBeleid = Exclude<JuridischeVraagintentie, "onbekend">;

/** Waarom de poort openging — gesloten, uitlegbaar, inhoudsvrij. */
export type JuridischePoort =
  | "juridisch_anker"
  | "zwak_anker_zonder_fondscontext"
  | "vertrouwen_zeker";

export interface JuridischBeleidsbesluit {
  beleid: JuridischBeleid;
  poort: JuridischePoort;
}

const BELEIDEN: ReadonlySet<string> = new Set<JuridischBeleid>([
  "geldend_recht",
  "bedoeling_totstandkoming",
  "geldend_recht_en_wetsgeschiedenis",
  "historische_peildatum",
]);

/**
 * De poort: vertaalt de R-2-intentie naar een toe te passen beleid, of `null`
 * (= exact het bestaande gedrag). Een onbekende of ontbrekende waarde is `null`.
 */
export function bepaalJuridischBeleid(
  intentie: JuridischeVraagintentieResultaat | null | undefined
): JuridischBeleidsbesluit | null {
  if (!intentie || !BELEIDEN.has(intentie.intentie)) return null;
  const signalen = new Set(intentie.signalen ?? []);
  const poort: JuridischePoort | null = signalen.has("juridisch_anker")
    ? "juridisch_anker"
    : signalen.has("zwak_anker") && !signalen.has("fondscontext")
      ? "zwak_anker_zonder_fondscontext"
      : intentie.vertrouwen === "zeker"
        ? "vertrouwen_zeker"
        : null;
  if (!poort) return null;
  return { beleid: intentie.intentie as JuridischBeleid, poort };
}

/** Juridische rol van een kandidaat; `null` = niet juridisch (gedrag ongewijzigd). */
export function juridischeRolVan(
  documenttype: string | null | undefined,
  wetsgeschiedenisSubtype: string | null | undefined
): JuridischeRol | null {
  return juridischeDuiding(documenttype, wetsgeschiedenisSubtype)?.rol ?? null;
}

export interface JuridischeHerordening<T> {
  /** De nieuwe volgorde, zonder de uitgesloten kandidaten. */
  volgorde: T[];
  /** Kandidaten die dit beleid uit de selectie haalt. */
  uitgesloten: T[];
  /** Kandidaten die dit beleid naar een latere plek verschoof. */
  gedemoveerd: Set<T>;
}

/**
 * Pas het beleid toe op een al gewogen volgorde. Zonder juridische kandidaten
 * komt exact dezelfde array terug (zelfde referentie).
 *
 * `vastVan` markeert kandidaten die hun plek HOUDEN, ook als ze juridisch zijn:
 * de selectie geeft hier de door de regimeweging gedemoveerde (PW↔Wvb) bronnen
 * mee, zodat dit beleid een tegengesteld regime nooit terug omhoog haalt. Een
 * vaste wetspassage wordt bij een historische peildatum wél uitgesloten.
 */
export function herordenJuridisch<T>(
  items: T[],
  rolVan: (item: T) => JuridischeRol | null,
  beleid: JuridischBeleid,
  vastVan: (item: T) => boolean = () => false
): JuridischeHerordening<T> {
  const rollen = items.map(rolVan);
  if (rollen.every((r) => r === null)) return { volgorde: items, uitgesloten: [], gedemoveerd: new Set() };

  const rol = new Map(items.map((item, i) => [item, rollen[i]] as const));
  const uitgesloten =
    beleid === "historische_peildatum" ? items.filter((c) => rol.get(c) === "geldend_recht") : [];
  const uitSet = new Set(uitgesloten);
  const beweegbaar = items.map((c, i) => rollen[i] !== null && !vastVan(c) && !uitSet.has(c));
  const juridisch = items.filter((_, i) => beweegbaar[i]);
  const wet = juridisch.filter((c) => rol.get(c) === "geldend_recht");
  const toelichting = juridisch.filter((c) => rol.get(c) === "wetsgeschiedenis");
  const kop =
    beleid === "bedoeling_totstandkoming" || beleid === "geldend_recht_en_wetsgeschiedenis"
      ? [wet[0], toelichting[0]].filter((c): c is T => c !== undefined)
      : [];
  const zonderKop = (lijst: T[]) => lijst.filter((c) => !kop.includes(c));

  // Wat ná de kop de juridische plekken vult, en wat naar de staart gaat.
  let rest: T[];
  let staart: T[] = [];
  switch (beleid) {
    case "geldend_recht":
      // Zonder actuele wetspassage verandert er niets: de antwoordgrens meldt
      // dan de ontbrekende normbasis in plaats van de toelichting te verstoppen.
      rest = wet.length > 0 ? wet : juridisch;
      staart = wet.length > 0 ? toelichting : [];
      break;
    case "geldend_recht_en_wetsgeschiedenis":
      rest = [...zonderKop(wet), ...zonderKop(toelichting)];
      break;
    case "bedoeling_totstandkoming":
      rest = zonderKop(juridisch);
      break;
    case "historische_peildatum":
      rest = juridisch;
      break;
  }

  // De kop (beste wet + beste toelichting) staat AANEEN op de eerste juridische
  // plek: dat reserveert representatie voor beide rollen. Overige juridische
  // plekken worden in volgorde gevuld; een vrijgevallen plek schuift op.
  const wachtrij = [...rest];
  const volgorde: T[] = [];
  let kopGeplaatst = kop.length === 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (uitSet.has(item)) continue;
    if (!beweegbaar[i]) {
      volgorde.push(item);
    } else if (!kopGeplaatst) {
      volgorde.push(...kop);
      kopGeplaatst = true;
    } else if (wachtrij.length > 0) {
      volgorde.push(wachtrij.shift() as T);
    }
  }
  volgorde.push(...staart);

  const oud = new Map(items.map((item, i) => [item, i] as const));
  const gedemoveerd = new Set<T>();
  volgorde.forEach((item, nieuw) => {
    if (rol.get(item) !== null && nieuw > (oud.get(item) ?? nieuw)) gedemoveerd.add(item);
  });
  return { volgorde, uitgesloten, gedemoveerd };
}

// ── Antwoordgrens ────────────────────────────────────────────────────────────

/** Gesloten meldingstypen die het beleid aan de bestaande inline-meldingen levert. */
export type JuridischeGrens = "historische_wetsversie_niet_beschikbaar" | "geen_actuele_normbasis";

/**
 * Welke eerlijke beperking(en) het antwoord moet melden, op basis van de
 * intentie en de UITEINDELIJK geselecteerde bronnen (over alle sporen).
 *   • historische peildatum → altijd: historische wetsversies zijn niet
 *     beschikbaar en de actuele tekst is niet als historisch antwoord gebruikt;
 *   • anders: wetsgeschiedenis geselecteerd zónder actuele wetspassage → de
 *     actuele normbasis ontbreekt.
 */
export function juridischeAntwoordgrens(
  intentie: JuridischeVraagintentieResultaat | null | undefined,
  geselecteerd: readonly { documenttype?: string | null; wetsgeschiedenisSubtype?: string | null }[]
): JuridischeGrens[] {
  const besluit = bepaalJuridischBeleid(intentie);
  if (!besluit) return [];
  if (besluit.beleid === "historische_peildatum") return ["historische_wetsversie_niet_beschikbaar"];
  const rollen = geselecteerd.map((b) => juridischeRolVan(b.documenttype, b.wetsgeschiedenisSubtype));
  const heeftWet = rollen.includes("geldend_recht");
  const heeftToelichting = rollen.includes("wetsgeschiedenis");
  return heeftToelichting && !heeftWet ? ["geen_actuele_normbasis"] : [];
}
