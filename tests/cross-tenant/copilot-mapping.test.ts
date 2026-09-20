// ============================================================================
//  #413 T4-C — De locatorstap: rootgrens, canonicalisering, registeropzoeking.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk, geen database. De registeropzoeking wordt
//  geïnjecteerd.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canoniekeWebUrl,
  hitBinnenRoot,
  zoekBronreferentie,
  type GeregistreerdDocument,
} from "../../core/lib/microsoft-retrieval/mapping";

const HOST = "check.sharepoint.com";
const ROOT = `https://${HOST}/sites/pgb/Documenten`;

/**
 * DE GEDEELDE VECTORLIJST. Exact deze paren staan ook in de SQL-gedragssuite
 * (`supabase/checks/2026_09_20_413_weburl_canonicalisering_vectoren.sql`), en de
 * laatste test in dit bestand houdt de twee tegen elkaar. Lopen de TS- en de
 * SQL-canonicalisering uiteen, dan zoekt de adapter op een waarde die nooit is
 * opgeslagen — en dat faalt stil, niet luid.
 */
export const VECTOREN: [string, string | null][] = [
  [`https://${HOST}/sites/pgb/Beleid.docx`, `https://${HOST}/sites/pgb/Beleid.docx`],
  [`https://${HOST}/sites/pgb/Beleid.docx/`, `https://${HOST}/sites/pgb/Beleid.docx`],
  [`https://${HOST}/sites/pgb/Beleid.docx///`, `https://${HOST}/sites/pgb/Beleid.docx`],
  [`https://${HOST}/sites/pgb/Beleid.docx?web=1`, `https://${HOST}/sites/pgb/Beleid.docx`],
  [`https://${HOST}/sites/pgb/Beleid.docx#fragment`, `https://${HOST}/sites/pgb/Beleid.docx`],
  [`https://${HOST}/sites/pgb/Beleid.docx?web=1#x`, `https://${HOST}/sites/pgb/Beleid.docx`],
  [`https://${HOST}:443/sites/pgb/Beleid.docx`, `https://${HOST}/sites/pgb/Beleid.docx`],
  [`https://CHECK.sharepoint.com/sites/pgb/Beleid.docx`, `https://${HOST}/sites/pgb/Beleid.docx`],
  // Padsegmenten blijven byte-gelijk: %2F wordt NOOIT een padscheiding.
  [`https://${HOST}/sites/pgb/map%2FX.docx`, `https://${HOST}/sites/pgb/map%2FX.docx`],
  [`https://${HOST}/sites/pgb/map/X.docx`, `https://${HOST}/sites/pgb/map/X.docx`],
  [`https://${HOST}/sites/pgb/Gedeelde%20documenten/X.docx`, `https://${HOST}/sites/pgb/Gedeelde%20documenten/X.docx`],
  // Alles wat geen https-SharePoint-URL met pad is, heeft geen canonieke vorm.
  [`http://${HOST}/sites/pgb/Beleid.docx`, null],
  [`https://user@${HOST}/sites/pgb/Beleid.docx`, null],
  [`https://check.example.com/sites/pgb/Beleid.docx`, null],
  [`https://${HOST}`, null],
  [`https://${HOST}/`, null],
  ["geen-url", null],
  ["", null],
];

test("de canonicalisering volgt de vectorlijst", () => {
  for (const [invoer, verwacht] of VECTOREN) {
    assert.equal(canoniekeWebUrl(invoer), verwacht, invoer);
  }
});

test("controletekens worden op de RUWE string geweigerd", () => {
  // `new URL()` zou tab, CR en LF stilzwijgend verwijderen; de canonicalisering
  // mag zo'n URL niet alsnog schoon teruggeven.
  for (const teken of ["\u0000", "\t", "\n", "\r", "\u007f"]) {
    assert.equal(canoniekeWebUrl(`https://${HOST}/sites/pgb/Bel${teken}eid.docx`), null, JSON.stringify(teken));
  }
});

test("de rootgrens vergelijkt op segmentgrens, niet op prefix", () => {
  assert.equal(hitBinnenRoot(`${ROOT}/Map/A.docx`, ROOT), `${ROOT}/Map/A.docx`);
  assert.equal(hitBinnenRoot(ROOT, ROOT), ROOT);
  // Het klassieke prefixlek: /Documenten-geheim ligt NIET onder /Documenten.
  assert.equal(hitBinnenRoot(`https://${HOST}/sites/pgb/Documenten-geheim/A.docx`, ROOT), null);
  assert.equal(hitBinnenRoot(`https://${HOST}/sites/ander/Documenten/A.docx`, ROOT), null);
  assert.equal(hitBinnenRoot(`https://andere.sharepoint.com/sites/pgb/Documenten/A.docx`, ROOT), null);
  assert.equal(hitBinnenRoot(`https://${HOST}/sites/pgb`, ROOT), null);
});

test("een trailing slash of poort op de root verandert de grens niet", () => {
  for (const root of [`${ROOT}/`, `https://${HOST}:443/sites/pgb/Documenten`, `https://CHECK.sharepoint.com/sites/pgb/Documenten`]) {
    assert.equal(hitBinnenRoot(`${ROOT}/A.docx`, root), `${ROOT}/A.docx`, root);
  }
});

function document(extra: Partial<GeregistreerdDocument> = {}): GeregistreerdDocument {
  return {
    ref: "11111111-1111-4111-8111-111111111111",
    bronId: "22222222-2222-4222-8222-222222222222",
    driveId: "drive-1",
    itemId: "item-1",
    rootItemId: "root-1",
    naam: "A.docx",
    bestandstype: "docx",
    mappad: "",
    status: "gezien",
    bronStatus: "actief",
    siteHostnaam: HOST,
    configuratieversie: 1,
    ...extra,
  };
}

test("een hit buiten de root bereikt de registeropzoeking niet", async () => {
  let gezocht = 0;
  const uitkomst = await zoekBronreferentie(
    `https://${HOST}/sites/ander/Documenten/A.docx`,
    ROOT,
    async () => { gezocht++; return document(); },
  );
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "root");
  assert.equal(gezocht, 0, "er is toch in het register gezocht");
});

test("een bekende, actieve URL levert de private referentie", async () => {
  const uitkomst = await zoekBronreferentie(`${ROOT}/A.docx`, ROOT, async (canoniek) => {
    assert.equal(canoniek, `${ROOT}/A.docx`, "er is op een niet-canonieke waarde gezocht");
    return document();
  });
  assert.ok(uitkomst.ok);
  assert.equal(uitkomst.document.ref, "11111111-1111-4111-8111-111111111111");
  assert.equal(uitkomst.canoniek, `${ROOT}/A.docx`);
});

test("de opzoeking gebruikt de CANONIEKE vorm, niet de ruwe hit-URL", async () => {
  let gezochtMet = "";
  await zoekBronreferentie(`${ROOT}/A.docx?web=1`, ROOT, async (canoniek) => {
    gezochtMet = canoniek;
    return document();
  });
  assert.equal(gezochtMet, `${ROOT}/A.docx`);
});

test("geen registratie, quarantaine of ambiguïteit: allemaal fail-closed", async () => {
  // De DB-functie geeft in al deze gevallen niets terug (count = 1 en alleen
  // actieve rijen); de adapter ziet dan hetzelfde als bij een onbekende URL.
  const uitkomst = await zoekBronreferentie(`${ROOT}/A.docx`, ROOT, async () => undefined);
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "mapping");
});

test("een ontkoppelde bron of een gemarkeerd document is geen kandidaat", async () => {
  for (const afwijkend of [
    document({ bronStatus: "ontkoppeld" }),
    document({ bronStatus: "toestemming_nodig" }),
    document({ status: "verwijderd" }),
    document({ status: "ontoegankelijk" }),
  ]) {
    const uitkomst = await zoekBronreferentie(`${ROOT}/A.docx`, ROOT, async () => afwijkend);
    assert.equal(uitkomst.ok, false, `${afwijkend.bronStatus}/${afwijkend.status}`);
    assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "mapping");
  }
});

test("de TS- en de SQL-canonicalisering delen één vectorlijst", () => {
  // Twee implementaties van dezelfde regel lopen vroeg of laat uiteen. De
  // SQL-suite draait blokkerend mee in scripts/cross-tenant-ci.sh; deze test
  // bewaakt dat zij exact dezelfde gevallen dekt als de TS-kant hierboven.
  const sql = readFileSync(
    resolve(import.meta.dirname, "../../supabase/checks/2026_09_20_413_weburl_canonicalisering_vectoren.sql"),
    "utf8",
  );
  const ontbrekend: string[] = [];
  for (const [invoer, verwacht] of VECTOREN) {
    // De SQL-suite noteert elk paar als ('<invoer>', '<verwacht>' | null).
    const regel = `(${sqlLiteral(invoer)}, ${verwacht === null ? "null" : sqlLiteral(verwacht)})`;
    if (!sql.includes(regel)) ontbrekend.push(regel);
  }
  assert.deepEqual(ontbrekend, [], "vectoren ontbreken in de SQL-suite");

  // En andersom: geen enkele vector in de SQL-suite mag hier onbekend zijn.
  const inSql = [...sql.matchAll(/^\s*\((?:'[^']*'|null), (?:'[^']*'|null)\),?\s*$/gm)].map((m) => m[0].trim().replace(/,$/, ""));
  assert.equal(
    inSql.length,
    VECTOREN.length,
    `SQL-suite telt ${inSql.length} vectoren, TS-lijst ${VECTOREN.length}`,
  );
});

function sqlLiteral(waarde: string): string {
  return `'${waarde.replace(/'/g, "''")}'`;
}
