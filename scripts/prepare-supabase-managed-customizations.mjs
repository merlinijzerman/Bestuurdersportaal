#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ALLOWED_PSQL_STATUS_LINES = new Set([
  "Output format is unaligned.",
  "Tuples only is on.",
  "Pager usage is off.",
]);
const PSQL_STATUS_PREFIX = /^(Output format is|Tuples only is|Pager usage is)/;
const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const MANAGED_FUNCTION = new RegExp(
  String.raw`^create or replace (?:function|procedure) (${IDENTIFIER})\.(${IDENTIFIER})\b`,
  "i",
);
const MANAGED_RLS = new RegExp(
  String.raw`^alter table (?:only )?(${IDENTIFIER})\.(${IDENTIFIER}) (?:enable|force) row level security;$`,
  "i",
);
const DROP_POLICY = new RegExp(
  String.raw`^drop policy if exists (${IDENTIFIER}) on (${IDENTIFIER})\.(${IDENTIFIER});$`,
  "i",
);
const CREATE_POLICY = new RegExp(
  String.raw`^create policy (${IDENTIFIER}) on (${IDENTIFIER})\.(${IDENTIFIER})\b[\s\S]*;$`,
  "i",
);
const DROP_TRIGGER = new RegExp(
  String.raw`^drop trigger if exists (${IDENTIFIER}) on (${IDENTIFIER})\.(${IDENTIFIER});$`,
  "i",
);
const CREATE_TRIGGER = new RegExp(
  String.raw`^create (?:constraint )?trigger (${IDENTIFIER})\b[\s\S]*?\bon (?:only )?(${IDENTIFIER})\.(${IDENTIFIER})\b[\s\S]*\bexecute (?:function|procedure) (${IDENTIFIER})\.(${IDENTIFIER})\s*\([\s\S]*\);$`,
  "i",
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function unquoteIdentifier(value) {
  return value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value;
}

function isManagedSchema(value) {
  return ["auth", "storage"].includes(unquoteIdentifier(value).toLowerCase());
}

function stripLeadingComments(value) {
  let remaining = value.trim();
  while (remaining.startsWith("--") || remaining.startsWith("/*")) {
    if (remaining.startsWith("--")) {
      const newline = remaining.indexOf("\n");
      if (newline === -1) return "";
      remaining = remaining.slice(newline + 1).trimStart();
      continue;
    }
    const end = remaining.indexOf("*/", 2);
    if (end === -1) throw new Error("Niet-afgesloten SQL-blokcommentaar");
    remaining = remaining.slice(end + 2).trimStart();
  }
  return remaining.trim();
}

export function splitSqlStatements(input) {
  const statements = [];
  let start = 0;
  let quote = null;
  let dollarTag = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (dollarTag) {
      if (input.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }

    if (character === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "$") {
      const match = input.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (character === ";") {
      statements.push(input.slice(start, index + 1));
      start = index + 1;
    }
  }

  if (quote || dollarTag || blockComment) throw new Error("Niet-afgesloten SQL-quote of commentaar");
  const tail = input.slice(start);
  if (stripLeadingComments(tail)) throw new Error(`SQL-statement mist afsluitende puntkomma: ${stripLeadingComments(tail).slice(0, 80)}`);
  if (tail.trim()) statements.push(tail);
  return statements.filter((statement) => statement.trim());
}

function customizationEntry(match, statement) {
  const [, name, schema, table] = match;
  return {
    schema: unquoteIdentifier(schema),
    table: unquoteIdentifier(table),
    name: unquoteIdentifier(name),
    sha256: sha256(statement.trim()),
  };
}

export function prepareManagedCustomizations(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("Managed-customizations SQL is leeg");
  }

  let removedStatusLines = 0;
  const withoutStatus = input
    .split("\n")
    .filter((rawLine) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (ALLOWED_PSQL_STATUS_LINES.has(line)) {
        removedStatusLines += 1;
        return false;
      }
      if (PSQL_STATUS_PREFIX.test(line)) throw new Error(`Onverwachte psql-statusregel: ${line}`);
      return true;
    })
    .join("\n");

  let removedManagedFunctions = 0;
  let removedManagedRls = 0;
  const policies = [];
  const triggers = [];
  const kept = [];

  for (const rawStatement of splitSqlStatements(withoutStatus)) {
    const statement = stripLeadingComments(rawStatement);
    if (!statement) {
      kept.push(rawStatement.trim());
      continue;
    }

    const managedFunction = statement.match(MANAGED_FUNCTION);
    if (managedFunction) {
      if (!isManagedSchema(managedFunction[1])) {
        throw new Error(`Managed functie buiten auth/storage geweigerd: ${statement.slice(0, 100)}`);
      }
      removedManagedFunctions += 1;
      continue;
    }

    const managedRls = statement.match(MANAGED_RLS);
    if (managedRls) {
      if (!isManagedSchema(managedRls[1])) throw new Error(`RLS-statement buiten auth/storage geweigerd: ${statement}`);
      removedManagedRls += 1;
      continue;
    }

    const dropPolicy = statement.match(DROP_POLICY);
    if (dropPolicy) {
      if (!isManagedSchema(dropPolicy[2])) throw new Error(`Policy buiten auth/storage geweigerd: ${statement}`);
      kept.push(rawStatement.trim());
      continue;
    }

    const createPolicy = statement.match(CREATE_POLICY);
    if (createPolicy) {
      if (!isManagedSchema(createPolicy[2])) throw new Error(`Policy buiten auth/storage geweigerd: ${statement}`);
      policies.push(customizationEntry(createPolicy, statement));
      kept.push(rawStatement.trim());
      continue;
    }

    const dropTrigger = statement.match(DROP_TRIGGER);
    if (dropTrigger) {
      if (!isManagedSchema(dropTrigger[2])) throw new Error(`Trigger buiten auth/storage geweigerd: ${statement}`);
      kept.push(rawStatement.trim());
      continue;
    }

    const createTrigger = statement.match(CREATE_TRIGGER);
    if (createTrigger) {
      if (!isManagedSchema(createTrigger[2])) throw new Error(`Trigger buiten auth/storage geweigerd: ${statement}`);
      if (unquoteIdentifier(createTrigger[4]).toLowerCase() !== "public") {
        throw new Error(`Triggerfunctie buiten portable public-schema geweigerd: ${statement}`);
      }
      triggers.push(customizationEntry(createTrigger, statement));
      kept.push(rawStatement.trim());
      continue;
    }

    throw new Error(`Niet-toegestaan managed-customization-statement: ${statement.slice(0, 160)}`);
  }

  const sql = `${kept.filter(Boolean).join("\n\n")}\n`;
  if (!sql.trim()) throw new Error("Managed-customizations SQL bevat na voorbereiding geen inhoud");

  const sortEntries = (entries) => entries.sort((left, right) =>
    `${left.schema}.${left.table}.${left.name}`.localeCompare(`${right.schema}.${right.table}.${right.name}`),
  );
  const manifest = {
    schema_version: 1,
    sql_sha256: sha256(sql),
    statement_count: kept.filter((statement) => stripLeadingComments(statement)).length,
    policies: sortEntries(policies),
    triggers: sortEntries(triggers),
  };

  return {
    sql,
    manifest,
    removedStatusLines,
    removedManagedFunctionLines: removedManagedFunctions,
    removedManagedRlsLines: removedManagedRls,
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Gebruik: --input <bestand> --output <bestand> [--manifest <bestand>]");
    }
    values[key.slice(2)] = value;
  }
  if (!values.input || !values.output) throw new Error("--input en --output zijn verplicht");
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = await readFile(args.input, "utf8");
  const prepared = prepareManagedCustomizations(input);
  await writeFile(args.output, prepared.sql, { encoding: "utf8", mode: 0o600 });
  if (args.manifest) {
    await writeFile(args.manifest, `${JSON.stringify(prepared.manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  process.stderr.write(
    [
      "Managed customizations voorbereid;",
      `${prepared.removedStatusLines} psql-statusregel(s),`,
      `${prepared.removedManagedFunctionLines} Supabase-beheerfunctie(s) en`,
      `${prepared.removedManagedRlsLines} standaard-RLS-statement(s) verwijderd;`,
      `${prepared.manifest.policies.length} policy(s) en ${prepared.manifest.triggers.length} trigger(s) toegelaten.`,
    ].join(" ") + "\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
