#!/usr/bin/env node

// Fail-closed controle op het github-native alertkanaal (besluit 0185).
//
// Zonder webhook is de rode workflowrun zélf het meldkanaal: GitHub stuurt bij
// een mislukte scheduled run een notificatie. Dat kanaal werkt dus alleen zolang
// iedere inhoudelijke afwijking de run daadwerkelijk rood maakt. Verdwijnt één
// `exit 1`, of komt er ergens een `continue-on-error` bij, dan blijft de run
// groen en is de bewaking stil kapot — precies de storing die je nooit ziet.
//
// Deze controle draait in de job "Alertkanaalconfiguratie controleren" en is
// daarmee de tegenhanger van de secretcontrole die bij een webhookkanaal draait.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";

// De jobs die een inhoudelijke afwijking kunnen vaststellen. Een lege of
// onbekende job is een fout: dan is de bewaking hernoemd zonder deze controle
// mee te nemen.
export const CONTROLEJOBS = Object.freeze(["freshness-alert", "inventory-freshness-alert"]);

export function controleerFailClosed(workflow) {
  const bevindingen = [];
  const jobs = workflow?.jobs ?? {};

  for (const jobId of CONTROLEJOBS) {
    const job = jobs[jobId];
    if (!job) {
      bevindingen.push(`job ontbreekt: ${jobId}`);
      continue;
    }
    if (job["continue-on-error"] === true) {
      bevindingen.push(`job mag niet doorlopen na een fout: ${jobId}`);
    }

    const stappen = Array.isArray(job.steps) ? job.steps : [];
    const alertStappen = stappen.filter(
      (stap) => typeof stap?.run === "string" && stap.run.includes("send-backup-alert.mjs")
    );
    if (alertStappen.length === 0) {
      bevindingen.push(`job stelt geen enkele afwijking meer vast: ${jobId}`);
    }

    for (const stap of stappen) {
      if (stap?.["continue-on-error"] === true) {
        bevindingen.push(`stap mag niet doorlopen na een fout: ${jobId} · ${stap.name ?? "naamloos"}`);
      }
    }

    for (const stap of alertStappen) {
      if (!stap.run.includes("exit 1")) {
        bevindingen.push(
          `afwijking maakt de run niet rood: ${jobId} · ${stap.name ?? "naamloos"}`
        );
      }
    }
  }

  return bevindingen;
}

async function main() {
  const pad = process.argv[2] ?? ".github/workflows/supabase-backup-watchdog.yml";
  const bevindingen = controleerFailClosed(yaml.load(await readFile(pad, "utf8")));
  if (bevindingen.length > 0) {
    for (const bevinding of bevindingen) {
      process.stderr.write(`::error title=Alertkanaal niet fail-closed::${bevinding}\n`);
    }
    throw new Error("De bewaking maakt een echte afwijking niet meer zichtbaar.");
  }
  process.stdout.write(
    "Alertkanaal github-native: iedere inhoudelijke afwijking maakt de run aantoonbaar rood.\n"
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
