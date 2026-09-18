#!/usr/bin/env node
// ============================================================================
//  #407 T2 — reproduceerbare runner voor de vaste kwaliteitsvergelijking.
// ----------------------------------------------------------------------------
//  Dezelfde harde lokale grendel als de #353-runner: uitsluitend lokaal, nooit
//  in CI, Vercel of productie. Deze runner wijzigt geen permission, consent,
//  billing of featureflag en slaat geen inhoud, extract of embedding op.
//
//  LET OP — een LIVE run vereist eerst het expliciete licentie-, kosten- en
//  consentbesluit uit `COPILOT-RETRIEVAL-407-LICENTIE-EN-CONSENT.md` (T3), met
//  delegated `Files.Read.All` ÉN `Sites.Read.All` samen. Zonder dat levert de
//  Copilot-arm `toestemming_geweigerd/copilot_toegang_geweigerd` (401/403,
//  consent óf licentie — bewust niet zelf geduid) of `copilot_licentie_of_billing`
//  (402). Beide zijn stopresultaten, geen aanleiding om zelf scope of billing
//  te zetten.
// ============================================================================
import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { stderr } from "node:process";
import { maakKwaliteitsrapport, VERGELIJK_ARMEN, voerVergelijkingUit, type VergelijkArm } from "./vergelijking";
import { VERGELIJK_SCENARIO_CODES, vergelijkScenario, type VergelijkScenario } from "./vergelijking-scenarios";
import { sharePointRetrievalFixtureStatus } from "../../../core/lib/microsoft-sharepoint-retrieval-smoke-core";
import type { SpikeBronSnapshot, VeiligeVergelijkrij } from "./types";

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
  rondes?: number;
  armen?: VergelijkArm[];
  scenarios?: VergelijkScenario[];
  fixtures?: ConfigFixture[];
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
  if (config.doel !== "PGB Preview-pilot" || !uuid.test(config.fondsId) || !uuid.test(config.gebruikerId)) {
    throw new Error("doel, fondsId of gebruikerId is ongeldig");
  }
  if (typeof config.rondes !== "number" || !Number.isInteger(config.rondes) || config.rondes < 2 || config.rondes > 10) {
    throw new Error("rondes moet tussen 2 en 10 liggen");
  }
  if (config.armen !== undefined && (!Array.isArray(config.armen) || config.armen.length === 0 || config.armen.some((arm) => !VERGELIJK_ARMEN.includes(arm)))) {
    throw new Error("armen is ongeldig");
  }
  if (config.scenarios !== undefined && (!Array.isArray(config.scenarios) || config.scenarios.length === 0 || config.scenarios.some((code) => !VERGELIJK_SCENARIO_CODES.includes(code)))) {
    throw new Error("scenarios is ongeldig");
  }
  if (!Array.isArray(config.fixtures) || config.fixtures.length === 0 || config.fixtures.some((fixture) => !fixture.fixtureCode || !uuid.test(fixture.ref))) {
    throw new Error("fixtures ontbreken of bevatten ongeldige lokale refs");
  }
  return config;
}

async function main() {
  hardeLokaleGrendel();
  const config = await leesLokaleConfig(configPadUitArgv());
  const connector = await import("../../../core/lib/microsoft-connector");
  const vault = await import("../../../core/lib/microsoft-vault");
  const context = { fondsId: config.fondsId, gebruikerId: config.gebruikerId };

  const leesBron = async (): Promise<SpikeBronSnapshot> => {
    const [bron, verbinding] = await Promise.all([
      vault.leesSharePointBron(config.fondsId),
      vault.leesVerbinding(config.fondsId, config.gebruikerId),
    ]);
    if (!bron) throw new Error("geen SharePoint-bron voor het fonds");
    if (bron.gebruiker_id !== config.gebruikerId) throw new Error("SharePoint-bron hoort niet bij de testgebruiker");
    if (!verbinding || verbinding.status !== "gekoppeld" || verbinding.tenant_id !== bron.tenant_id || !verbinding.microsoft_object_id) {
      throw new Error("Microsoft-identiteit hoort niet bij de actuele SharePoint-bron");
    }
    const documenten = await Promise.all((config.fixtures ?? []).map(async (fixture) => {
      const fixtureStatus = sharePointRetrievalFixtureStatus(fixture.fixtureCode);
      if (!fixtureStatus) throw new Error(`fixture ${fixture.fixtureCode} heeft geen serververtrouwde status`);
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
        fixtureStatus,
        geregistreerdMappad: document.mappad,
        verwachteMappad: fixture.verwachteMappad,
      };
    }));
    return {
      fondsId: config.fondsId,
      actorId: config.gebruikerId,
      microsoftActorObjectId: verbinding.microsoft_object_id,
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

  const delegatedToken = async () => {
    const token = await connector.sharepointAccessToken(context);
    return { accessToken: token.accessToken, tenantId: token.tenantId, actorObjectId: token.objectId };
  };

  const armen = config.armen ?? [...VERGELIJK_ARMEN];
  const scenarios = config.scenarios ?? VERGELIJK_SCENARIO_CODES;
  const rijen: VeiligeVergelijkrij[] = [];
  for (let ronde = 1; ronde <= config.rondes!; ronde += 1) {
    for (const code of scenarios) {
      rijen.push(...await voerVergelijkingUit({ leesBron, delegatedToken }, {
        ronde,
        vraag: vergelijkScenario(code),
        armen,
        correlationId: () => randomUUID(),
        timeoutMs: 20_000,
        concurrency: 3,
      }));
    }
  }

  process.stdout.write(`${JSON.stringify(maakKwaliteitsrapport({
    doel: config.doel,
    gemetenOp: new Date().toISOString(),
    rondes: config.rondes!,
    armen,
    rijen,
  }), null, 2)}\n`);
}

main().catch((fout) => {
  // Alleen de lokale, vaste foutmelding; nooit het foutobject, Graph-body,
  // token, pad of config dumpen.
  stderr.write(`Copilot-retrievalvergelijking gestopt: ${fout instanceof Error ? fout.message : "onbekende fout"}\n`);
  process.exitCode = 1;
});
