#!/usr/bin/env node
// ============================================================================
//  #407 labsmoke — de uitvoerder. GEEN productiecode, geen CI-stap.
// ----------------------------------------------------------------------------
//  Dit bestand doet drie dingen die de rest van de runner bewust NIET doet: het
//  raakt het netwerk, het praat met de terminal, en het vraagt een mens om
//  akkoord. Alle beslislogica staat in `smoke.ts` en is daar hermetisch getest.
//
//  DE GRENDELS, van buiten naar binnen:
//    • `M365_COPILOT_LAB_SMOKE=local` moet gezet zijn, en CI/Vercel/productie
//      worden geweigerd. Deze runner hoort op één laptop te draaien.
//    • het retrievalprofiel ligt vast op `pgb_m365_lab_copilot`.
//    • `--dry-run` stopt vóór de live call, ook als de poort openstaat.
//    • zonder een interactieve terminal is er geen akkoord te geven, en dus
//      geen call. Een pipe of een cronjob komt hier niet voorbij.
//
//  WAT ER NOOIT OP STDOUT KOMT: een access token, een id-token, een
//  autorisatiecode, een documentfragment of een bestandsnaam. De rapportage
//  loopt via één dichtgetimmerde renderer (`rapport.ts`).
// ============================================================================
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { COPILOT_RETRIEVAL_ENDPOINT } from "../../../core/lib/microsoft-retrieval/endpoint";
import { meldAan } from "./auth";
import { bestandsnaamscan, inhoudscan, leesActor, leesBron, maakLeesClient } from "./graph";
import { leesLabprofiel, registryMap, LAB_PROFIEL_ID } from "./registry";
import { rapporteer, type Scanregel, type Smokerapport } from "./rapport";
import {
  BESTANDSNAAM_PREFIX,
  INHOUDSCAN_TERM,
  SCENARIO,
  StopFail,
  VERWACHTE_FIXTURE,
  beoordeelPoort,
  meet,
  toetsDrift,
} from "./smoke";
import { hitUrlBinnenRoot } from "../../spike/sharepoint-retrieval/copilot-retrieval";

/** De zin die letterlijk getypt moet worden vóór de eerste live call. */
const AKKOORDZIN = "JA, VOER DE RETRIEVAL-CALL UIT";

/** Budget voor de read-only voorbereidingscalls. Ruim, maar eindig. */
const GRAPH_CALLBUDGET = 40;

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

function hardeLokaleGrendel(): void {
  if (process.env.M365_COPILOT_LAB_SMOKE !== "local") {
    throw new Error("lokale grendel staat niet op 'local' (zet M365_COPILOT_LAB_SMOKE=local)");
  }
  if (process.env.CI || process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error("deze smoke weigert CI, Vercel en productie");
  }
}

function vlag(naam: string): boolean {
  return process.argv.includes(`--${naam}`);
}

function waarde(naam: string): string | null {
  const prefix = `--${naam}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function meld(regel: string): void {
  // Alles wat niet het rapport is, gaat naar stderr. Zo blijft stdout precies
  // het rapport en kan het zonder nabewerking worden opgeslagen.
  process.stderr.write(`${regel}\n`);
}

/** Opent de autorisatie-URL in de standaardbrowser; faalt stil. */
function openBrowser(url: string): void {
  try {
    const kind = spawn("open", [url], { stdio: "ignore", detached: true });
    kind.on("error", () => {});
    kind.unref();
  } catch {
    // Geen browser? Dan is de URL op stderr genoeg.
  }
}

/**
 * Vraagt akkoord, vlak vóór de enige live Retrieval-call.
 *
 * Bewust een exacte zin en geen `y/n`: een enkele toetsaanslag is te makkelijk
 * per ongeluk te geven, en dit is de stap die geld kost en quotum verbruikt.
 * Zonder TTY is er niemand om het te vragen, en dan is het antwoord nee.
 */
async function vraagAkkoord(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    meld("Geen interactieve terminal: er kan geen akkoord worden gegeven, dus geen live call.");
    return false;
  }
  meld("");
  meld("──────────────────────────────────────────────────────────────");
  meld("  AKKOORD NODIG — de volgende stap is een LIVE call naar");
  // Uit de endpointpin, niet overgetypt: één plek waar dit adres staat.
  meld(`  POST ${COPILOT_RETRIEVAL_ENDPOINT}`);
  meld(`  scenario ${SCENARIO.code}, verwachte fixture ${VERWACHTE_FIXTURE}`);
  meld("  precies één netwerkpoging; dit verbruikt Copilot-quotum.");
  meld("──────────────────────────────────────────────────────────────");
  const lezer = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const antwoord = await lezer.question(`Typ exact "${AKKOORDZIN}" om door te gaan: `);
    return antwoord.trim() === AKKOORDZIN;
  } finally {
    lezer.close();
  }
}

async function main(): Promise<number> {
  hardeLokaleGrendel();

  const dryRun = vlag("dry-run");
  const geenBrowser = vlag("geen-browser");
  const rapportPad = waarde("rapport");
  const wachtMs = Number(waarde("wacht-s") ?? "300") * 1000;

  const map = registryMap(REPO_ROOT);
  meld(`Registry: ${map}`);
  const profiel = leesLabprofiel(map, LAB_PROFIEL_ID);
  meld(`Profiel ${profiel.profielId} — tenant ${profiel.tenantDomein}, actor ${profiel.actorUpn}`);
  meld(`Bronroot: ${profiel.rootUrl}`);
  meld(`Geregistreerde indexstand: ${profiel.indexStatus ?? "niet geregistreerd"}`);

  const afbreker = new AbortController();
  const stop = () => afbreker.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  meld("");
  meld("Aanmelden via public-client-PKCE. Er wordt geen token bewaard of gelogd.");
  const aanmelding = await meldAan({
    tenantId: profiel.tenantId,
    clientId: profiel.clientId,
    delegatedPermissions: profiel.delegatedPermissions,
    loginHint: profiel.actorUpn,
    redirectUris: profiel.redirectUris,
    wachtMs,
    signal: afbreker.signal,
    toonUrl: (url) => {
      meld("");
      meld("Open deze URL en meld aan als de geregistreerde labidentiteit:");
      meld(url);
      if (!geenBrowser) openBrowser(url);
    },
  });
  meld("");
  meld(`Aangemeld. Toegekende scopes: ${aanmelding.toegekendeScopes.join(", ") || "onbekend"}`);

  const client = maakLeesClient({
    accessToken: aanmelding.accessToken,
    callBudget: GRAPH_CALLBUDGET,
    signal: afbreker.signal,
  });

  const actor = await leesActor(client);
  const bron = await leesBron(client, profiel.siteHostnaam, profiel.siteRelatiefPad);

  const drift = toetsDrift(profiel, aanmelding, actor, bron);
  const basisrapport: Omit<Smokerapport, "eindstand" | "scans" | "poort" | "retrieval" | "graphCalls"> = {
    uitgevoerdOp: new Date().toISOString(),
    profielId: profiel.profielId,
    tenantDomein: profiel.tenantDomein,
    actorUpn: profiel.actorUpn,
    siteHostnaam: profiel.siteHostnaam,
    scenario: SCENARIO.code,
    verwachteFixture: VERWACHTE_FIXTURE,
    geregistreerdeIndexstand: profiel.indexStatus,
    drift,
    akkoordGevraagd: false,
    akkoordGegeven: false,
  };

  const schrijfRapport = (rapport: Smokerapport): void => {
    const tekst = rapporteer(rapport);
    process.stdout.write(tekst);
    if (rapportPad) {
      writeFileSync(resolve(process.cwd(), rapportPad), tekst, "utf8");
      meld(`Rapport geschreven naar ${rapportPad}`);
    }
  };

  if (drift.length > 0) {
    meld("");
    meld("DRIFT VASTGESTELD — de run stopt fail-closed vóór elke scan.");
    schrijfRapport({
      ...basisrapport,
      scans: [],
      poort: { doorgelaten: false, code: "beide_nul" },
      graphCalls: client.pogingen(),
      retrieval: null,
      eindstand: "gestopt_op_drift",
    });
    return 2;
  }

  const binnenRoot = (webUrl: string | undefined) => hitUrlBinnenRoot(webUrl, profiel.rootUrl, profiel.siteHostnaam);

  meld("");
  meld(`Inhoudscan op "${INHOUDSCAN_TERM}" …`);
  const inhoud = await inhoudscan(client, bron.driveId, INHOUDSCAN_TERM, binnenRoot);
  meld(`  ${inhoud.treffers} treffer(s), ${inhoud.binnenRoot} binnen de bronroot`);

  meld(`Bestandsnaamscan op "${BESTANDSNAAM_PREFIX}*" …`);
  const naam = await bestandsnaamscan(client, bron.driveId, BESTANDSNAAM_PREFIX, binnenRoot);
  meld(`  ${naam.treffers} treffer(s) binnen de bronroot, ${naam.bekeken} item(s) bekeken`);

  const scans: Scanregel[] = [
    { naam: "inhoudscan", sleutel: INHOUDSCAN_TERM, treffers: inhoud.treffers, binnenRoot: inhoud.binnenRoot },
    { naam: "bestandsnaamscan", sleutel: BESTANDSNAAM_PREFIX, treffers: naam.treffers, binnenRoot: naam.treffers, afgekapt: naam.afgekapt },
  ];
  const poort = beoordeelPoort(inhoud, naam);

  if (!poort.doorgelaten) {
    meld("");
    meld(`POORT DICHT (${poort.code}) — er wordt geen Retrieval-call uitgevoerd.`);
    schrijfRapport({
      ...basisrapport,
      scans,
      poort,
      graphCalls: client.pogingen(),
      retrieval: null,
      eindstand: "gestopt_op_poort",
    });
    return 3;
  }

  if (dryRun) {
    meld("");
    meld("--dry-run: de poort staat open, maar er wordt geen live call gedaan.");
    schrijfRapport({
      ...basisrapport,
      scans,
      poort,
      graphCalls: client.pogingen(),
      retrieval: null,
      eindstand: "gestopt_op_akkoord",
    });
    return 0;
  }

  const akkoord = await vraagAkkoord();
  if (!akkoord) {
    meld("Geen akkoord — de run stopt zonder Retrieval-call.");
    schrijfRapport({
      ...basisrapport,
      akkoordGevraagd: true,
      scans,
      poort,
      graphCalls: client.pogingen(),
      retrieval: null,
      eindstand: "gestopt_op_akkoord",
    });
    return 4;
  }

  meld("");
  meld("Eén Retrieval-poging …");
  const retrieval = await meet(profiel, {
    accessToken: aanmelding.accessToken,
    signal: afbreker.signal,
    fetchImpl: fetch,
  });

  schrijfRapport({
    ...basisrapport,
    akkoordGevraagd: true,
    akkoordGegeven: true,
    scans,
    poort,
    graphCalls: client.pogingen(),
    retrieval,
    eindstand: "gemeten",
  });
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((fout: unknown) => {
    // Alleen naam en boodschap. Onze eigen fouten dragen per constructie geen
    // provider- of tokeninhoud; een stack trace van een onbekende fout zou dat
    // niet garanderen.
    const naam = fout instanceof Error ? fout.name : "Fout";
    const boodschap = fout instanceof StopFail || fout instanceof Error ? fout.message : "onbekende fout";
    meld(`${naam}: ${boodschap}`);
    process.exitCode = 1;
  });
