#!/usr/bin/env node
// Gedragstest van dezelfde V3-gate die CI op de wegwerpdatabase uitvoert.
// Alleen tijdelijke tabellen binnen een teruggedraaide transactie.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const databaseUrl = process.env.V3_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("V3_TEST_DATABASE_URL ontbreekt");

const gate = readFileSync("supabase/checks/2026_08_20_v3_grants_volledig.sql", "utf8");
const marker = "-- Alleen de zes vervangen functies en twee toegevoegde triggerfuncties mogen";
if (gate.split(marker).length !== 2) throw new Error("V3-injectiepunt is gewijzigd");

const oudeNamen = [
  "get_size_by_bucket", "list_multipart_uploads_with_delimiter",
  "list_objects_with_delimiter", "search", "search_by_timestamp", "search_v2",
];
const oudeLijst = oudeNamen.map((naam) => "'" + naam + "'").join(", ");
const nieuweVorm = `
  delete from v3_actual
   where sectie = 'FUNC' and sch = 'storage'
     and split_part(obj, '(', 1) in (${oudeLijst});
  delete from v3_actual
   where sectie = 'FUNC' and sch = 'storage'
     and obj in (select obj from v3_storage_objectversioning_allow);
  insert into v3_actual select * from v3_storage_objectversioning_allow;
`;

const gevallen = [
  { naam: "nieuwe vorm", injectie: nieuweVorm, verwacht: "groen" },
  {
    naam: "mengvorm",
    injectie: nieuweVorm + `
      insert into v3_actual values
        ('FUNC','storage','get_size_by_bucket()','function','anon','EXECUTE');
    `,
    verwacht: "LEK onbekend object",
  },
  {
    naam: "afwijkend recht",
    injectie: nieuweVorm + `
      update v3_actual set rechten = '-'
       where sch = 'storage' and obj = 'protect_bucket_control_columns()'
         and rol = 'anon';
    `,
    verwacht: "LEK ontbrekende rechten",
  },
  {
    naam: "onvolledige nieuwe allowlist",
    injectie: nieuweVorm + `
      delete from v3_storage_objectversioning_allow
       where obj = 'protect_bucket_control_columns()';
    `,
    verwacht: "Storage-platformallowlist heeft ongeldige vorm",
  },
];

for (const geval of gevallen) {
  const sql = "begin;\n" + gate.replace(marker, geval.injectie + "\n" + marker) + "\nrollback;\n";
  const uitkomst = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-", databaseUrl], {
    input: sql,
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60000,
  });
  if (uitkomst.error) throw uitkomst.error;
  const groen = uitkomst.status === 0;
  if (geval.verwacht === "groen" ? !groen : groen || !uitkomst.stderr.includes(geval.verwacht)) {
    // Geen connectiestring, query of providerfouttekst in CI-uitvoer.
    throw new Error(`V3-varianttest ${geval.naam}: onverwachte uitkomst (exit ${uitkomst.status})`);
  }
  console.log(`V3-varianttest ${geval.naam}: ${groen ? "groen" : "terecht rood"}`);
}
