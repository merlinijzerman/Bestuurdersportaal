#!/usr/bin/env node
// ============================================================================
//  #407 labsmoke — de uitvoerder. GEEN productiecode, geen CI-stap.
// ----------------------------------------------------------------------------
//  Dit bestand doet drie dingen die de rest van de runner bewust NIET doet: het
//  raakt het netwerk, het praat met de terminal, en het vraagt een mens om
//  akkoord. De beslislogica staat in `smoke.ts`, de volgorde in
//  `orkestratie.ts`; beide zijn daar hermetisch getest.
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
import { parseerSmokeArgumenten } from "./args";
import { meldAan } from "./auth";
import { maakLeesClient } from "./graph";
import { voerSmokeUit } from "./orkestratie";
import { leesLabprofiel, registryMap, LAB_PROFIEL_ID } from "./registry";
import { rapporteer } from "./rapport";
import { meetinstelling, StopFail, VERWACHTE_FIXTURE, type Meetmodus } from "./smoke";

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
async function vraagAkkoord(modus: Meetmodus): Promise<boolean> {
  if (!process.stdin.isTTY) {
    meld("Geen interactieve terminal: er kan geen akkoord worden gegeven, dus geen live call.");
    return false;
  }
  meld("");
  meld("──────────────────────────────────────────────────────────────");
  meld("  AKKOORD NODIG — de volgende stap is een LIVE call naar");
  // Uit de endpointpin, niet overgetypt: één plek waar dit adres staat.
  meld(`  POST ${COPILOT_RETRIEVAL_ENDPOINT}`);
  const instelling = meetinstelling(modus);
  meld(`  scenario ${instelling.scenario}, verwachte fixture ${VERWACHTE_FIXTURE}`);
  if (modus === "exacte_canary") meld(`  vaste exacte canaryvraag: "${instelling.vraag}"`);
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
  const { dryRun, geenBrowser, rapportPad, wachtMs, modus } = parseerSmokeArgumenten(process.argv.slice(2));

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

  const { rapport, exitcode } = await voerSmokeUit({
    profiel,
    aanmelden: async () => aanmelding,
    maakClient: (accessToken) =>
      maakLeesClient({ accessToken, callBudget: GRAPH_CALLBUDGET, signal: afbreker.signal }),
    vraagAkkoord: () => vraagAkkoord(modus),
    retrievalFetch: fetch,
    signal: afbreker.signal,
    dryRun,
    modus,
    meld: (regel) => meld(`\n${regel}`),
  });

  const tekst = rapporteer(rapport);
  process.stdout.write(tekst);
  if (rapportPad) {
    writeFileSync(resolve(process.cwd(), rapportPad), tekst, "utf8");
    meld(`Rapport geschreven naar ${rapportPad}`);
  }
  return exitcode;
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
