#!/usr/bin/env node

import { constants, copyFileSync, existsSync, openSync, closeSync, readFileSync, statSync, chmodSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const templatePath = resolve(root, "tests/e2e/fixtures/pgb-sharepoint/private-mapping.example.json");
const mappingPath = resolve(root, ".pgb-sharepoint-fixtures.local.json");
const evidencePath = resolve(root, ".pgb-sharepoint-bewijs.local.ndjson");
const manifestPath = resolve(root, "tests/e2e/fixtures/pgb-sharepoint/manifest.json");
const command = process.argv[2];

function mode(path) {
  return statSync(path).mode & 0o777;
}

function assertPrivate(path) {
  if (!existsSync(path)) throw new Error(`Lokaal bestand ontbreekt: ${path}`);
  if (mode(path) !== 0o600) throw new Error(`Onveilige bestandsmodus voor ${path}; verwacht 0600.`);
}

function init() {
  if (!existsSync(mappingPath)) {
    copyFileSync(templatePath, mappingPath, constants.COPYFILE_EXCL);
  }
  chmodSync(mappingPath, 0o600);
  if (!existsSync(evidencePath)) {
    const handle = openSync(evidencePath, "wx", 0o600);
    closeSync(handle);
  }
  chmodSync(evidencePath, 0o600);
  console.log("Lokale PGB-mapping en bewijslog bestaan met bestandsmodus 0600.");
}

function check() {
  assertPrivate(mappingPath);
  assertPrivate(evidencePath);
  const mapping = JSON.parse(readFileSync(mappingPath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (mapping.schema_version !== 1) throw new Error("Onbekende mappingversie.");
  const expected = new Set(manifest.fixtures.map((fixture) => fixture.code));
  const actual = new Set(Object.keys(mapping.fixtures ?? {}));
  for (const code of expected) {
    if (!actual.has(code)) throw new Error(`Fixture ontbreekt in lokale mapping: ${code}`);
  }
  for (const code of actual) {
    if (!expected.has(code)) throw new Error(`Onbekende fixture in lokale mapping: ${code}`);
  }
  console.log("Schema van de lokale PGB-state is compleet en heeft bestandsmodus 0600; private waarden zijn niet getoond.");
}

function ready() {
  check();
  const mapping = JSON.parse(readFileSync(mappingPath, "utf8"));
  const vereisteSitevelden = ["host_name", "server_relative_path", "site_id", "drive_id", "root_item_id"];
  for (const veld of vereisteSitevelden) {
    if (typeof mapping.site?.[veld] !== "string" || mapping.site[veld].length === 0) {
      throw new Error("Lokale PGB-state is nog niet gereed voor een live run; vul eerst alle private sitevelden in.");
    }
  }
  if (typeof mapping.accounts?.rol_a?.user_principal_name !== "string" || mapping.accounts.rol_a.user_principal_name.length === 0) {
    throw new Error("Lokale PGB-state is nog niet gereed voor een live run; rol A ontbreekt.");
  }
  for (const fixture of Object.values(mapping.fixtures ?? {})) {
    for (const veld of ["item_id", "local_ref", "e_tag", "c_tag"]) {
      if (typeof fixture?.[veld] !== "string" || fixture[veld].length === 0) {
        throw new Error("Lokale PGB-state is nog niet gereed voor een live run; fixturemapping of versiebewijs ontbreekt.");
      }
    }
  }
  console.log("Lokale PGB-state is gereed voor een live run; private waarden zijn niet getoond.");
}

if (command === "init") init();
else if (command === "check") check();
else if (command === "ready") ready();
else {
  console.error("Gebruik: node scripts/pgb-sharepoint-local-state.mjs <init|check|ready>");
  process.exitCode = 2;
}
