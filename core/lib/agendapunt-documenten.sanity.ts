import assert from "node:assert/strict";
import {
  bepaalGevraagdeDocumentIds,
  haalAgendapuntDocumentKoppelingen,
  type AgendapuntDocumentLezer,
} from "./agendapunt-documenten";

type Rij = Record<string, unknown>;

function maakLezer(tabellen: Record<string, Rij[]>): AgendapuntDocumentLezer {
  return {
    from(tabel: string) {
      return {
        select() {
          let rijen = [...(tabellen[tabel] ?? [])];
          const bouwer = {
            eq(kolom: string, waarde: unknown) {
              rijen = rijen.filter((rij) => rij[kolom] === waarde);
              return bouwer;
            },
            in(kolom: string, waarden: readonly string[]) {
              rijen = rijen.filter((rij) => waarden.includes(String(rij[kolom] ?? "")));
              return bouwer;
            },
            abortSignal() {
              return bouwer;
            },
            then(op: (waarde: { data: Rij[]; error: null }) => unknown) {
              return Promise.resolve({ data: rijen, error: null }).then(op);
            },
          };
          return bouwer;
        },
      };
    },
  } as AgendapuntDocumentLezer;
}

let n = 0;
async function check(naam: string, fn: () => Promise<void> | void) {
  await fn();
  n += 1;
  console.log(`  ✓ ${naam}`);
}

console.log("agendapunt-documenten sanity-tests:");

async function main() {
await check("verenigt primaire en secundaire koppelingen en ontdubbelt", async () => {
  const lezer = maakLezer({
    documenten: [
      { id: "primair", titel: "Primair stuk", agendapunt_id: "ap", actief: true },
      { id: "secundair", titel: "Secundair stuk", agendapunt_id: null, actief: true },
    ],
    document_agendapunten: [
      { document_id: "secundair", agendapunt_id: "ap" },
      { document_id: "primair", agendapunt_id: "ap" },
    ],
  });
  const uit = await haalAgendapuntDocumentKoppelingen(lezer, ["ap"]);
  assert.deepEqual(uit, [
    { id: "primair", titel: "Primair stuk", agendapunt_id: "ap" },
    { id: "secundair", titel: "Secundair stuk", agendapunt_id: "ap" },
  ]);
});

await check("sluit inactieve secundaire documenten uit", async () => {
  const lezer = maakLezer({
    documenten: [
      { id: "actief", titel: "Actief", agendapunt_id: null, actief: true },
      { id: "oud", titel: "Oud", agendapunt_id: null, actief: false },
    ],
    document_agendapunten: [
      { document_id: "actief", agendapunt_id: "ap" },
      { document_id: "oud", agendapunt_id: "ap" },
    ],
  });
  const uit = await haalAgendapuntDocumentKoppelingen(lezer, ["ap"]);
  assert.deepEqual(uit.map((rij) => rij.id), ["actief"]);
});

await check("B-1: een geldige agendapuntmodus negeert een bevroren clientscope", () => {
  assert.deepEqual(
    bepaalGevraagdeDocumentIds({
      agendapuntModusActief: true,
      actueleAgendapuntDocumentIds: ["nieuw", "nieuw"],
      clientDocumentIds: ["oud-opgeslagen", "ander-fonds"],
      volledigeAnalyseDocumentId: "client-volledige-analyse",
    }),
    ["nieuw"]
  );
});

await check("opnieuw oplossen volgt de actuele koppelingen per beurt", () => {
  const basis = {
    agendapuntModusActief: true,
    clientDocumentIds: ["bevroren"],
  };
  assert.deepEqual(
    bepaalGevraagdeDocumentIds({ ...basis, actueleAgendapuntDocumentIds: ["versie-1"] }),
    ["versie-1"]
  );
  assert.deepEqual(
    bepaalGevraagdeDocumentIds({ ...basis, actueleAgendapuntDocumentIds: ["versie-2"] }),
    ["versie-2"]
  );
});

await check("buiten agendapuntmodus blijven analyse- en clientscopes intact", () => {
  assert.deepEqual(
    bepaalGevraagdeDocumentIds({
      agendapuntModusActief: false,
      actueleAgendapuntDocumentIds: ["agenda"],
      clientDocumentIds: ["client", "client", ""],
    }),
    ["client"]
  );
  assert.deepEqual(
    bepaalGevraagdeDocumentIds({
      agendapuntModusActief: false,
      actueleAgendapuntDocumentIds: [],
      volledigeAnalyseDocumentId: "analyse",
      clientDocumentIds: ["client"],
    }),
    ["analyse"]
  );
});

console.log(`\n${n} sanity-tests geslaagd.`);
}

void main();
