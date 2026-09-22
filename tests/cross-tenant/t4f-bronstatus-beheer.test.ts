// ============================================================================
//  #434 T4-F — route/status en beheerweergave.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk, geen database.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bouwBronstatusDto } from "../../core/lib/retrieval/bronstatus-dto";
import { aggregeerAdapterMeta } from "../../core/lib/retrieval/adaptermeta-beheer";
import { ADAPTERMETA_NAMEN, ADAPTERMETA_RESULTATEN } from "../../core/lib/retrieval/adaptermeta";
import { maakZoekRespons } from "../../core/lib/retrieval/productiepaden-core";
import type { Bronstatus } from "../../core/lib/retrieval/contract";

const lees = (pad: string) => readFileSync(fileURLToPath(new URL(`../../${pad}`, import.meta.url)), "utf8");

// ── 1. Legacy: zonder bronstatus blijft de respons byte-identiek ───────────

test("zonder bronstatus ontbreekt het veld volledig in de zoekrespons", () => {
  const zonder = maakZoekRespons({
    resultaten: [], procesinstanties: [], methode: "hybride_rrf",
    opgehaald: 3, geselecteerd: 2, modus: "breed",
  });
  assert.equal("bronstatus" in zonder.meta, false, "een leeg veld verandert elke bestaande snapshot");
  // En een lege lijst mag geen veld opleveren: dat is hetzelfde als niets melden.
  assert.equal(bouwBronstatusDto([]), undefined);
  assert.equal(bouwBronstatusDto(undefined), undefined);
});

// ── 2. `meld`: zichtbaar én inhoudsvrij ────────────────────────────────────

test("een niet-geraadpleegde bron wordt zichtbaar als gesloten categorie", () => {
  const intern: Bronstatus[] = [
    { adapter: "microsoft-sharepoint", bronsoort: "sharepoint", geraadpleegd: false, reden: "providerfout" },
  ];
  const dto = bouwBronstatusDto(intern);
  assert.deepEqual(dto, [
    { categorie: "bron_niet_geraadpleegd", bronsoort: "sharepoint", reden: "providerfout" },
  ]);
  const respons = maakZoekRespons({
    resultaten: [], procesinstanties: [], methode: "hybride_rrf",
    opgehaald: 0, geselecteerd: 0, modus: "breed", bronstatus: dto,
  });
  assert.ok(respons.meta.bronstatus, "de gebruiker moet kunnen zien dat een bron ontbreekt");
});

test("een bron die WEL is geraadpleegd en niets vond, wordt niet gemeld", () => {
  // Anders leest de gebruiker een lege uitslag als een storing.
  const dto = bouwBronstatusDto([
    { adapter: "supabase-rag", bronsoort: "fonds", geraadpleegd: true, reden: "geen_resultaten" },
  ]);
  assert.equal(dto, undefined);
});

// ── 4. Geen interne of providerdata via de route ───────────────────────────

test("VIJANDIG: extra velden op het interne object bereiken de route niet", () => {
  // De DTO is een expliciete projectie, geen serialisatie. Zou zij het interne
  // object doorgeven, dan verlaat elk veld dat er ooit bij komt vanzelf de route.
  const vervuild = [
    {
      adapter: "microsoft-sharepoint",
      bronsoort: "sharepoint",
      geraadpleegd: false,
      reden: "token_ongeldig",
      // Alles hieronder mag de route NIET verlaten.
      providerbericht: "AADSTS700016: application not found in tenant",
      webUrl: "https://host.sharepoint.com/sites/pgb/Documenten/A.docx",
      bronregistratieRef: "22222222-2222-4222-8222-222222222222",
      tenantId: "e4ff0e8d-5b92-4695-9f58-2f97200199f9",
      documentnaam: "Herstelplan.docx",
    },
  ] as unknown as Bronstatus[];
  const dto = bouwBronstatusDto(vervuild);
  assert.ok(dto);
  assert.deepEqual(Object.keys(dto[0]).sort(), ["bronsoort", "categorie", "reden"]);
  const serie = JSON.stringify(dto);
  for (const verboden of ["AADSTS", "https://", ".docx", "2222", "e4ff0e8d", "Herstelplan"]) {
    assert.equal(serie.includes(verboden), false, `de route lekt "${verboden}"`);
  }
});

test("een reden of bronsoort buiten de gesloten verzameling wordt weggelaten", () => {
  const dto = bouwBronstatusDto([
    { adapter: "supabase-rag", bronsoort: "verzonnen", geraadpleegd: false, reden: "providerfout" },
    { adapter: "supabase-rag", bronsoort: "fonds", geraadpleegd: false, reden: "vrije tekst" },
  ] as unknown as Bronstatus[]);
  assert.equal(dto, undefined, "een onbekende waarde hoort niet naar de client te gaan");
});

// ── 5. Beheerweergave: uitsluitend gesloten velden ─────────────────────────

test("de beheeraggregatie levert alleen gesloten velden en eindige tellers", () => {
  const rij = {
    naam: "microsoft-sharepoint", methode: "sharepoint_live", resultaat: "treffers",
    netwerkpogingen: 2, latency_ms: 40, downloads: 1, bytes: 1024, throttles: 0, retries: 1,
    kandidaten_voor_poort: 10, kandidaten_na_poort: 4,
    afwijzing_root: 1, afwijzing_mapping: 2, afwijzing_binding: 0, afwijzing_rechten: 0,
    afwijzing_versie: 0, afwijzing_download: 0, afwijzing_extractie: 0,
    afwijzing_lokalisatie: 0, afwijzing_grens: 0,
    opgenomen_passages: 3, opgenomen_documenten: 2,
  };
  const uit = aggregeerAdapterMeta([{ adapters: [rij, rij] }]);
  assert.equal(uit.length, 1);
  assert.equal(uit[0].beurten, 2);
  assert.equal(uit[0].afwijzingen_totaal, 6, "afwijzingen worden over de gronden opgeteld");
  for (const [veld, waarde] of Object.entries(uit[0])) {
    if (veld === "naam") assert.ok((ADAPTERMETA_NAMEN as readonly string[]).includes(waarde as string));
    else assert.ok(typeof waarde === "number" && Number.isFinite(waarde) && waarde >= 0, veld);
  }
  const serie = JSON.stringify(uit);
  assert.equal(serie.includes("sharepoint_live"), false, "methode is geen beheerveld en hoort er niet in");
});

test("een onleesbare rij wordt OVERGESLAGEN, niet met nullen ingevuld", () => {
  // Een beheerstand die een kapotte rij aanvult, toont een werkelijkheid die er
  // niet was. Overslaan is het eerlijke alternatief.
  const uit = aggregeerAdapterMeta([
    { adapters: [{ naam: "onbekend", resultaat: "treffers" }] },
    { adapters: "geen array" },
    null,
    { adapters: [{ naam: "supabase-rag", resultaat: "leeg" }] },
  ]);
  assert.equal(uit.length, 1);
  assert.equal(uit[0].naam, "supabase-rag");
  assert.equal(uit[0].leeg, 1);
});

// ── 6. Autorisatie en tenantisolatie ───────────────────────────────────────

test("de beheerroute draagt de bestaande capability, een inline poort én een fondsfilter", () => {
  const bron = lees("app/api/beheer/adapterstatus/route.ts");
  assert.match(bron, /capability: "fonds\.config\.manage"/, "geen nieuw leesrecht, de bestaande capability");
  assert.match(bron, /requireCapability\(ctx\.gebruikerId, "fonds\.config\.manage"\)/, "de wrapperdeclaratie is een belofte; de inline poort is de weigering");
  assert.match(bron, /\.eq\("fonds_id", ctx\.fondsId\)/, "cross-tenant leesbaarheid mag niet alleen van RLS afhangen");
  // Op GEBRUIK matchen, niet op proza: de route bevat zelf een commentaarregel
  // die zegt dát er geen service-role is, en een naïeve regex vindt juist die.
  const zonderCommentaar = bron.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(
    /SERVICE_ROLE|createServiceRole|service_role/i.test(zonderCommentaar),
    false,
    "geen service-role in een fondsroute"
  );
  assert.match(bron, /hostGuard: "afdwingen"/);
});

// ── 7. Eén enumverzameling over route, audit en beheer ─────────────────────

test("route, auditprojectie en beheerweergave delen dezelfde gesloten enums", () => {
  // Drie plekken die uiteen kunnen lopen: de TS-validator, de SQL-projectie en
  // de beheeraggregatie. Loopt er één uit de pas, dan toont de beheerstand iets
  // anders dan het auditspoor bevat.
  const migratie = lees("supabase/migrations/2026_09_22_434_meta_adapters.sql");
  for (const naam of ADAPTERMETA_NAMEN) {
    assert.ok(migratie.includes(`'${naam}'`), `SQL kent adapternaam ${naam} niet`);
  }
  for (const resultaat of ADAPTERMETA_RESULTATEN) {
    assert.ok(migratie.includes(`'${resultaat}'`), `SQL kent resultaatcategorie ${resultaat} niet`);
  }
  // En de andere kant op: de SQL mag geen waarde kennen die TypeScript niet kent.
  const naamlijst = /e->>'naam' not in \(([^)]*)\)/.exec(migratie);
  assert.ok(naamlijst);
  const uitSql = [...naamlijst[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(uitSql, [...ADAPTERMETA_NAMEN].sort());
});
