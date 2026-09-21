// ============================================================================
//  #407 labsmoke — de uitvoer.
// ----------------------------------------------------------------------------
//  WAT ER IN EEN RAPPORT MAG STAAN, staat in de opdracht: categorieën,
//  tellingen, latency en fixturecodes. Verder niets.
//
//  Daarom is dit een aparte module met één ingang. De rendering krijgt een
//  DICHTGETIMMERD object mee — geen `unknown`, geen doorgeefluik, geen
//  `JSON.stringify(alles)` — zodat er geen pad is waarlangs een webUrl, een
//  bestandsnaam, een extract of een token in de tekst kan sijpelen. De
//  bijbehorende test toetst dat op de gerenderde uitvoer zelf, met een echte
//  labachtige respons als invoer: een controle die alleen naar het type kijkt,
//  merkt niets van een veld dat later wordt toegevoegd.
// ============================================================================
import type { Driftbevinding, Hitcategorie, Poortoordeel, Retrievaluitslag } from "./smoke";

export interface Scanregel {
  /** Vaste naam van de scan; geen vrije tekst. */
  naam: "inhoudscan" | "bestandsnaamscan";
  /** De gezochte term of prefix. Codevast, geen gebruikersinvoer. */
  sleutel: string;
  treffers: number;
  binnenRoot: number;
  afgekapt?: boolean;
  /** Treffers waarvan is vastgesteld dat ze buiten de bronroot liggen. */
  buitenRoot?: number;
  /** Treffers waarvan de locatie niet vast te stellen was. */
  nietVerifieerbaar?: number;
  /** Verse DriveItem-lezingen die deze scan heeft gekost. */
  verseHerlezingen?: number;
  /** Tellingen per vaste reden. Uitsluitend codes — nooit een pad of naam. */
  redenen?: Record<string, number>;
}

export interface Smokerapport {
  uitgevoerdOp: string;
  profielId: string;
  tenantDomein: string;
  actorUpn: string;
  siteHostnaam: string;
  scenario: string;
  verwachteFixture: string;
  /** Wat de registry over de index zei toen de run begon; puur context. */
  geregistreerdeIndexstand: string | null;
  drift: Driftbevinding[];
  scans: Scanregel[];
  poort: Poortoordeel;
  akkoordGevraagd: boolean;
  akkoordGegeven: boolean;
  graphCalls: number;
  retrieval: Retrievaluitslag | null;
  /** Vaste eindcode; de enige plek waar de uitkomst van de run in één woord staat. */
  eindstand:
    | "gestopt_op_drift"
    | "gestopt_op_poort"
    | "gestopt_op_akkoord"
    | "gemeten";
}

const CATEGORIE_LABEL: Record<Hitcategorie, string> = {
  verwachte_fixture: "verwachte fixture",
  binnen_root_andere_fixture: "binnen root, andere fixture",
  binnen_root_onbekend: "binnen root, geen fixturecode",
  buiten_bronroot: "buiten bronroot (afgewezen)",
  zonder_locator: "zonder locator",
};

const POORT_UITLEG: Record<string, string> = {
  geen_zoekresultaat: "de zoekindex kent de canaryterm niet; wachten op herindexering",
  zoekresultaat_niet_verifieerbaar:
    "de zoekindex geeft een treffer, maar de locatie ervan is niet vast te stellen; uitzoeken vóór een meting",
  zoekresultaat_buiten_root: "de zoekindex geeft een treffer, maar die ligt aantoonbaar buiten de bronroot",
  bestand_niet_aanwezig: "het verwachte bestand staat niet in de bronroot",
  beide_nul: "geen inhoudstreffer en geen bestandstreffer binnen de bronroot",
};

/** Rendert het rapport als markdown. Geen URL, geen bestandsnaam, geen extract. */
export function rapporteer(rapport: Smokerapport): string {
  const regels: string[] = [];
  regels.push(`# Copilot Retrieval labsmoke — ${rapport.scenario}`);
  regels.push("");
  regels.push(`- uitgevoerd op: ${rapport.uitgevoerdOp}`);
  regels.push(`- retrievalprofiel: \`${rapport.profielId}\``);
  regels.push(`- tenant: ${rapport.tenantDomein}`);
  regels.push(`- actor: ${rapport.actorUpn}`);
  regels.push(`- SharePoint-host: ${rapport.siteHostnaam}`);
  regels.push(`- verwachte fixture: \`${rapport.verwachteFixture}\``);
  regels.push(`- geregistreerde indexstand bij start: ${rapport.geregistreerdeIndexstand ?? "niet geregistreerd"}`);
  regels.push(`- read-only Graph-calls: ${rapport.graphCalls}`);
  regels.push("");

  regels.push("## Driftcontrole");
  regels.push("");
  if (rapport.drift.length === 0) {
    regels.push("Geen drift op tenant, actor, appregistratie of bronroot.");
  } else {
    regels.push("| as | code |");
    regels.push("| --- | --- |");
    for (const bevinding of rapport.drift) regels.push(`| ${bevinding.soort} | \`${bevinding.code}\` |`);
  }
  regels.push("");

  regels.push("## Stopregel — read-only scans");
  regels.push("");
  regels.push("| scan | sleutel | treffers | binnen bronroot |");
  regels.push("| --- | --- | ---: | ---: |");
  for (const scan of rapport.scans) {
    const sleutel = scan.naam === "bestandsnaamscan" ? `${scan.sleutel}*` : scan.sleutel;
    regels.push(`| ${scan.naam} | \`${sleutel}\` | ${scan.treffers} | ${scan.binnenRoot} |`);
  }
  // De uitsplitsing die de poortcode draagt. Zonder deze regels is "0 binnen
  // de bronroot" niet te onderscheiden van "de index kent de term niet".
  const metOordeel = rapport.scans.filter(
    (scan) => scan.buitenRoot !== undefined || scan.nietVerifieerbaar !== undefined,
  );
  if (metOordeel.length > 0) {
    regels.push("");
    regels.push("| scan | geverifieerd binnen root | buiten root | niet verifieerbaar | verse herlezingen |");
    regels.push("| --- | ---: | ---: | ---: | ---: |");
    for (const scan of metOordeel) {
      regels.push(
        `| ${scan.naam} | ${scan.binnenRoot} | ${scan.buitenRoot ?? 0} | ${scan.nietVerifieerbaar ?? 0} | ${scan.verseHerlezingen ?? 0} |`,
      );
    }
    const redenen = metOordeel.flatMap((scan) => Object.entries(scan.redenen ?? {}));
    if (redenen.length > 0) {
      regels.push("");
      regels.push(`Redenen: ${redenen.map(([code, aantal]) => `\`${code}\` ×${aantal}`).join(", ")}`);
    }
  }

  const afgekapt = rapport.scans.some((scan) => scan.afgekapt);
  if (afgekapt) regels.push("");
  if (afgekapt) regels.push("> De bestandsnaamscan is op een scangrens gestopt; de telling is een ondergrens.");
  regels.push("");
  if (rapport.poort.doorgelaten) {
    regels.push("Beide scans leverden treffers binnen de bronroot. De poort is open.");
  } else {
    regels.push(`**Poort dicht** — \`${rapport.poort.code}\`: ${POORT_UITLEG[rapport.poort.code]}.`);
    regels.push("");
    regels.push("Er is geen Copilot Retrieval-call uitgevoerd.");
  }
  regels.push("");

  regels.push("## Retrievalmeting");
  regels.push("");
  if (!rapport.retrieval) {
    const reden = rapport.eindstand === "gestopt_op_drift"
      ? "de driftcontrole stopte de run vóór de poort"
      : rapport.eindstand === "gestopt_op_akkoord"
        ? "de poort was open, maar er is geen akkoord gegeven voor de live call"
        : "de poort bleef dicht";
    regels.push(`Niet uitgevoerd: ${reden}.`);
    regels.push("");
    regels.push(`- akkoord gevraagd: ${rapport.akkoordGevraagd ? "ja" : "nee"}`);
    regels.push(`- Retrieval API-netwerkpogingen: 0`);
  } else {
    const uitslag = rapport.retrieval.uitslag;
    regels.push(`- Retrieval API-netwerkpogingen: ${rapport.retrieval.netwerkpogingen}`);
    regels.push(`- latency: ${rapport.retrieval.latencyMs} ms`);
    regels.push(`- kandidaten in de respons: ${rapport.retrieval.kandidaten}`);
    regels.push(`- kandidaten met tekstfragmenten: ${uitslag.hitsMetExtracts} (fragmenten zelf niet bewaard)`);
    regels.push(`- serververtrouwde status van de verwachte fixture: ${rapport.retrieval.verwachteFixtureStatus ?? "onbekend"}`);
    regels.push("");
    regels.push("| categorie | aantal |");
    regels.push("| --- | ---: |");
    for (const [categorie, aantal] of Object.entries(uitslag.categorieen)) {
      regels.push(`| ${CATEGORIE_LABEL[categorie as Hitcategorie]} | ${aantal} |`);
    }
    regels.push("");
    regels.push(`- fixturecodes binnen de bronroot: ${uitslag.fixturecodes.length > 0 ? uitslag.fixturecodes.map((code) => `\`${code}\``).join(", ") : "geen"}`);
    regels.push(`- verwachte fixture gevonden: ${uitslag.verwachteFixtureGevonden ? "ja" : "nee"}`);
  }
  regels.push("");
  regels.push(`## Eindstand: \`${rapport.eindstand}\``);
  regels.push("");
  return `${regels.join("\n")}\n`;
}
