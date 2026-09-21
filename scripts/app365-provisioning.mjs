#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bevestigApp365Doel } from "./app365-provisioning-doel.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BESTANDEN = Object.freeze({
  preview: Object.freeze({
    provision: "supabase/seeds/preview/2026_09_22_428_app365_preview_provision.sql",
    check: "supabase/seeds/preview/2026_09_22_428_app365_preview_CHECK.sql",
    rollback: "supabase/rollbacks/2026_09_22_428_app365_preview_ROLLBACK.sql",
  }),
  production: Object.freeze({
    provision: "supabase/seeds/production/2026_09_22_428_app365_production_provision.sql",
    check: "supabase/seeds/production/2026_09_22_428_app365_production_CHECK.sql",
    rollback: "supabase/rollbacks/2026_09_22_428_app365_production_ROLLBACK.sql",
  }),
});

export function voerApp365SqlUit({ omgeving, actie, databaseUrl, mutatieAkkoord, spawn = spawnSync }) {
  const doel = bevestigApp365Doel({ omgeving, actie, databaseUrl, mutatieAkkoord });
  const bestand = resolve(ROOT, BESTANDEN[omgeving][actie]);
  const resultaat = spawn("psql", ["--set", "ON_ERROR_STOP=1", "--file", bestand], {
    cwd: ROOT,
    env: { ...process.env, PGDATABASE: databaseUrl },
    stdio: "inherit",
  });
  if (resultaat.error) throw resultaat.error;
  if (resultaat.status !== 0) throw new Error(`app365 ${actie} stopte met status ${resultaat.status}.`);
  return doel;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const actie = process.argv[2];
  try {
    const doel = voerApp365SqlUit({
      omgeving: process.env.APP365_DOELOMGEVING,
      actie,
      databaseUrl: process.env.APP365_DATABASE_URL,
      mutatieAkkoord: process.env.APP365_MUTATIE_AKKOORD,
    });
    console.log(`app365 ${doel.actie} voltooid voor ${doel.omgeving} (${doel.projectRef}).`);
  } catch (fout) {
    console.error(fout instanceof Error ? fout.message : "app365 uitvoering geblokkeerd.");
    process.exitCode = 1;
  }
}
