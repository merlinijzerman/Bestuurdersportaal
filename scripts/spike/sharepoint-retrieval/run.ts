#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { voerSharePointRetrievalSpikeUit, maakVeiligeMeetrij, vatMetingenSamen } from "./prototype";
import type { SpikeBronSnapshot, SpikeDocumentMapping, SpikeFase, SpikeRoute, SpikeVraag, VeiligeMeetrij } from "./types";

type ConfigFixture = {
  fixtureCode: string;
  ref: string;
  bestandstype: "docx" | "pdf" | "pptx" | "anders";
  verwachteMappad?: string;
};

type Config = {
  doel: "PGB Preview-pilot";
  fondsId: string;
  gebruikerId: string;
  rondes: number;
  routes: SpikeRoute[];
  fixtures: ConfigFixture[];
  vragen: SpikeVraag[];
  pauze?: {
    fase: "na_zoeken" | "na_eerste_rechtencheck" | "na_content" | "voor_laatste_rechtencheck" | "voor_toelating";
    fixtureCode?: string;
    instructie: string;
  };
};

function hardeLokaleGrendel(): void {
  if (process.env.M365_RETRIEVAL_SPIKE !== "local") throw new Error("lokale spikegrendel staat niet op 'local'");
  if (process.env.CI || process.env.VERCEL || process.env.NODE_ENV === "production") throw new Error("spike weigert CI, Vercel en productie");
}

function configPadUitArgv(): string {
  const waarde = process.argv.find((arg) => arg.startsWith("--config="))?.slice("--config=".length);
  if (!waarde) throw new Error("gebruik --config=<pad-naar-.local.json>");
  return resolve(waarde);
}

async function leesLokaleConfig(pad: string): Promise<Config> {
  const echt = await realpath(pad);
  const rel = relative(process.cwd(), echt);
  if (rel.startsWith("..") || rel === "" || !echt.endsWith(".local.json")) throw new Error("config moet een .local.json binnen deze worktree zijn");
  const info = await stat(echt);
  if ((info.mode & 0o077) !== 0) throw new Error("config moet bestandsrechten 0600 hebben");
  const config = JSON.parse(await readFile(echt, "utf8")) as Config;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (config.doel !== "PGB Preview-pilot" || !uuid.test(config.fondsId) || !uuid.test(config.gebruikerId)) throw new Error("doel, fondsId of gebruikerId is ongeldig");
  if (!Number.isInteger(config.rondes) || config.rondes < 3 || config.rondes > 10) throw new Error("rondes moet tussen 3 en 10 liggen");
  if (!Array.isArray(config.routes) || config.routes.length === 0 || config.routes.some((route) => route !== "microsoft_search" && route !== "drive_search_extract")) throw new Error("routes is ongeldig");
  if (!Array.isArray(config.fixtures) || config.fixtures.length === 0 || config.fixtures.some((fixture) => !fixture.fixtureCode || !uuid.test(fixture.ref))) throw new Error("fixtures ontbreken of bevatten ongeldige lokale refs");
  if (!Array.isArray(config.vragen) || config.vragen.length === 0 || config.vragen.some((vraag) => !vraag.code || !vraag.vraag || !Array.isArray(vraag.verwachteFixtures))) throw new Error("acceptatievragen ontbreken of zijn ongeldig");
  return config;
}

async function main() {
  hardeLokaleGrendel();
  const config = await leesLokaleConfig(configPadUitArgv());
  const connector = await import("../../../core/lib/microsoft-connector");
  const vault = await import("../../../core/lib/microsoft-vault");
  const context = { fondsId: config.fondsId, gebruikerId: config.gebruikerId };

  const leesBron = async (): Promise<SpikeBronSnapshot> => {
    const bron = await vault.leesSharePointBron(config.fondsId);
    if (!bron) throw new Error("geen SharePoint-bron voor het fonds");
    if (bron.gebruiker_id !== config.gebruikerId) throw new Error("SharePoint-bron hoort niet bij de testgebruiker");
    const documenten = await Promise.all(config.fixtures.map(async (fixture) => {
      const document = await vault.leesSharePointDocument(config.fondsId, fixture.ref);
      if (!document) throw new Error(`fixture ${fixture.fixtureCode} heeft geen actuele lokale ref`);
      if (
        document.bron_id !== bron.id
        || document.drive_id !== bron.drive_id
        || document.root_item_id !== bron.root_item_id
        || document.site_hostnaam !== bron.site_hostnaam
        || document.configuratieversie !== bron.configuratieversie
        || document.status !== "gezien"
        || document.bron_status !== "actief"
      ) throw new Error(`fixture ${fixture.fixtureCode} valt buiten de actuele bronbinding`);
      return {
        fixtureCode: fixture.fixtureCode,
        ref: fixture.ref,
        itemId: document.item_id,
        titel: document.naam,
        bestandstype: fixture.bestandstype,
        geregistreerdMappad: document.mappad,
        verwachteMappad: fixture.verwachteMappad,
      };
    }));
    return {
      fondsId: config.fondsId,
      actorId: config.gebruikerId,
      tenantId: bron.tenant_id,
      bronId: bron.id,
      status: bron.status,
      configuratieversie: bron.configuratieversie,
      siteId: bron.site_id,
      siteHostnaam: bron.site_hostnaam,
      driveId: bron.drive_id,
      driveNaam: bron.drive_weergavenaam,
      rootItemId: bron.root_item_id,
      documenten,
    };
  };

  let gepauzeerd = false;
  const onFase = config.pauze ? async (fase: SpikeFase, document?: SpikeDocumentMapping) => {
    if (gepauzeerd || fase !== config.pauze?.fase || (config.pauze.fixtureCode && document?.fixtureCode !== config.pauze.fixtureCode)) return;
    gepauzeerd = true;
    stderr.write(`\nPAUZE ${fase}${document ? ` (${document.fixtureCode})` : ""}: ${config.pauze.instructie}\nDruk Enter nadat de mutatie is uitgevoerd.\n`);
    const terminal = createInterface({ input: stdin, output: stderr });
    await terminal.question("");
    terminal.close();
  } : undefined;

  const rijen: VeiligeMeetrij[] = [];
  for (let ronde = 1; ronde <= config.rondes; ronde += 1) {
    for (const route of config.routes) {
      for (const vraag of config.vragen) {
        const uitkomst = await voerSharePointRetrievalSpikeUit({
          leesBron,
          delegatedToken: async () => {
            const token = await connector.sharepointAccessToken(context);
            return { accessToken: token.accessToken, tenantId: token.tenantId, actorObjectId: token.objectId };
          },
          onFase,
        }, {
          route,
          correlationId: randomUUID(),
          vraag,
          timeoutMs: 15_000,
          concurrency: 3,
        });
        rijen.push(maakVeiligeMeetrij(ronde, vraag, uitkomst));
      }
    }
  }

  process.stdout.write(`${JSON.stringify({
    schemaVersie: 1,
    doel: config.doel,
    gemetenOp: new Date().toISOString(),
    inhoudPersistentOpgeslagen: false,
    routes: config.routes,
    rondes: config.rondes,
    samenvatting: vatMetingenSamen(rijen),
    metingen: rijen,
  }, null, 2)}\n`);
}

main().catch((fout) => {
  // Alleen de lokale, vaste foutmelding; nooit het foutobject, Graph-body,
  // token, pad of config dumpen.
  stderr.write(`SharePoint-retrievalspike gestopt: ${fout instanceof Error ? fout.message : "onbekende fout"}\n`);
  process.exitCode = 1;
});
