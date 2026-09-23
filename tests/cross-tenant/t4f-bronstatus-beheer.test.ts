// ============================================================================
//  #434 T4-F — route/status en beheerweergave.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk, geen database.
//
//  De autorisatie- en tenanttests in §6 draaien het ECHTE leespad met een
//  onbevoegde gebruiker en met twee fondsen in de dataset. Een eerdere versie
//  van deze suite las daarvoor de broncode van de route met een reguliere
//  expressie; dat bewijst dat een regel STAAT, niet dat er iets GEBEURT.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bouwBronstatusDto, BRONSTATUS_ONBEKEND } from "../../core/lib/retrieval/bronstatus-dto";
import { aggregeerAdapterMeta } from "../../core/lib/retrieval/adaptermeta-beheer";
import {
  leesAdapterstand,
  ADAPTERSTATUS_LIMIET,
  ADAPTERSTAND_RPC,
  type MetaBron,
  type MetaQuery,
} from "../../core/lib/retrieval/adapterstatus-lezer";
import {
  ADAPTERMETA_NAMEN,
  ADAPTERMETA_RESULTATEN,
  ADAPTERMETA_METHODEN,
  ADAPTERMETA_MAX_RIJEN,
  ADAPTERMETA_DUURZAME_REF,
  ADAPTERMETA_FOUTCATEGORIE,
  AdaptermetadataOngeldig,
} from "../../core/lib/retrieval/adaptermeta";
import { foutcategorieVoor } from "../../core/lib/retrieval/orkestratie";
import { maakZoekRespons } from "../../core/lib/retrieval/productiepaden-core";
import type { Bronstatus } from "../../core/lib/retrieval/contract";

const lees = (pad: string) => readFileSync(fileURLToPath(new URL(`../../${pad}`, import.meta.url)), "utf8");

/** Een volledig geldige adapterrij; tests wijzigen er telkens één veld in. */
const geldigeRij = (naam: string = "microsoft-sharepoint") => ({
  naam,
  methode: "sharepoint_live",
  resultaat: "treffers",
  netwerkpogingen: 2, latency_ms: 40, downloads: 1, bytes: 1024, throttles: 0, retries: 1,
  kandidaten_voor_poort: 10, kandidaten_na_poort: 4,
  afwijzing_root: 1, afwijzing_mapping: 2, afwijzing_binding: 0, afwijzing_rechten: 0,
  afwijzing_versie: 0, afwijzing_download: 0, afwijzing_extractie: 0,
  afwijzing_lokalisatie: 0, afwijzing_grens: 0,
  opgenomen_passages: 3, opgenomen_documenten: 2,
});

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

// ── 3. Een onbekende waarde laat de WAARSCHUWING staan ─────────────────────

test("een onbekende reden of bronsoort wordt afgevlakt, NIET weggelaten", () => {
  // Dit was de vorige keuze en die was fout: de rij bestaat juist omdát een
  // bron ontbrak. Wie hem weggooit, gooit de waarschuwing weg en niet het
  // risico — het antwoord oogt dan weer volledig.
  const dto = bouwBronstatusDto([
    { adapter: "supabase-rag", bronsoort: "verzonnen", geraadpleegd: false, reden: "providerfout" },
    { adapter: "supabase-rag", bronsoort: "fonds", geraadpleegd: false, reden: "vrije tekst met AADSTS700016" },
  ] as unknown as Bronstatus[]);
  assert.ok(dto, "de melding mag niet verdwijnen omdat één veld onbekend is");
  assert.equal(dto.length, 2, "beide ontbrekende bronnen blijven zichtbaar");
  assert.deepEqual(dto[0], {
    categorie: "bron_niet_geraadpleegd",
    bronsoort: BRONSTATUS_ONBEKEND,
    reden: "providerfout",
  });
  assert.deepEqual(dto[1], {
    categorie: "bron_niet_geraadpleegd",
    bronsoort: "fonds",
    reden: BRONSTATUS_ONBEKEND,
  });
  // En de onbekende tekst zelf gaat nog steeds niet mee naar de client.
  assert.equal(JSON.stringify(dto).includes("AADSTS"), false, "de vrije tekst lekt naar de route");
});

test("een rij waarvan `geraadpleegd` geen boolean is, wordt gemeld en niet genegeerd", () => {
  // Van een onleesbare rij kunnen we niet vaststellen DÁT de bron geraadpleegd
  // is. Fail-closed betekent hier: melden.
  const dto = bouwBronstatusDto([
    { adapter: "supabase-rag", bronsoort: "fonds", reden: "providerfout" },
  ] as unknown as Bronstatus[]);
  assert.ok(dto);
  assert.equal(dto.length, 1);
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

// ── 5. Beheerweergave: gesloten velden én een eerlijke dekking ─────────────

test("de beheeraggregatie levert alleen gesloten velden en eindige tellers", () => {
  const rij = geldigeRij();
  const uit = aggregeerAdapterMeta([{ adapters: [rij, rij] }]);
  assert.equal(uit.regels.length, 1);
  assert.equal(uit.regels[0].beurten, 2);
  assert.equal(uit.regels[0].afwijzingen_totaal, 6, "afwijzingen worden over de gronden opgeteld");
  assert.equal(uit.volledig, true);
  assert.equal(uit.dekking.metarijen_gelezen, 1);
  for (const [veld, waarde] of Object.entries(uit.regels[0])) {
    if (veld === "naam") assert.ok((ADAPTERMETA_NAMEN as readonly string[]).includes(waarde as string));
    else assert.ok(typeof waarde === "number" && Number.isFinite(waarde) && waarde >= 0, veld);
  }
  const serie = JSON.stringify(uit.regels);
  assert.equal(serie.includes("sharepoint_live"), false, "methode is geen beheerveld en hoort er niet in");
});

test("een onleesbare rij wordt overgeslagen én GETELD, en de stand heet niet volledig", () => {
  // Overslaan zonder tellen is de stille degradatie in beheervorm: de stand
  // ziet er compleet uit en niemand kan zien dat hij het niet is. Aanvullen met
  // nullen is even fout — dat toont een werkelijkheid die er niet was.
  const uit = aggregeerAdapterMeta([
    { adapters: [{ ...geldigeRij(), naam: "onbekend" }] },
    { adapters: "geen array" },
    null,
    { adapters: [geldigeRij("supabase-rag")] },
    // Geen `adapters`: een beurt met één adaptergroep. GEEN degradatie.
    { methode: "hybride_rrf" },
  ]);
  assert.equal(uit.regels.length, 1);
  assert.equal(uit.regels[0].naam, "supabase-rag");
  assert.equal(uit.regels[0].treffers, 1);
  assert.equal(uit.volledig, false, "de stand verzwijgt dat er iets ontbreekt");
  assert.equal(uit.dekking.adapterrijen_overgeslagen, 1);
  assert.equal(uit.dekking.metarijen_overgeslagen, 2, "«geen array» en «null» zijn kapotte regels");
  assert.equal(uit.dekking.metarijen_zonder_adapters, 1, "één adapter is geen kapotte regel");
  assert.equal(uit.dekking.metarijen_gelezen, 2);
});

test("de aggregatie hanteert DEZELFDE gesloten vorm als het schrijfpad", () => {
  // Een eigen, lossere toets in de beheerlaag is precies hoe een beheerstand
  // iets anders kan tonen dan het auditspoor bevat. Deze rij heeft een geldige
  // naam en een geldig resultaat — de oude toets keek niet verder.
  const uit = aggregeerAdapterMeta([
    { adapters: [{ naam: "supabase-rag", resultaat: "treffers", bron_url: "https://host/doc.docx" }] },
  ]);
  assert.equal(uit.regels.length, 0, "een rij met een identifier erin is geen bruikbare rij");
  assert.equal(uit.dekking.adapterrijen_overgeslagen, 1);
  assert.equal(uit.volledig, false);
});

// ── 6. Autorisatie en tenantisolatie — WERKELIJK GEDRAG ────────────────────

/**
 * De kolommen die `governance_log` WERKELIJK heeft, gelezen uit de
 * schemabaseline.
 *
 * Dit is geen franje. De eerste versie van dit leespad sorteerde op
 * `aangemaakt_op` — een kolom die op diverse andere tabellen bestaat maar niet
 * op deze. PostgREST faalt daar pas op de server op, dus de route gaf in de
 * praktijk 503 terwijl de testsuite groen stond: de namaakketen slikte elke
 * kolomnaam. Een namaak die alles accepteert, toetst niets.
 */
function kolommenVanGovernanceLog(): Set<string> {
  const baseline = lees("supabase/baseline/2026_08_14_preview_public.sql");
  const start = baseline.indexOf('CREATE TABLE IF NOT EXISTS "public"."governance_log" (');
  assert.ok(start > 0, "de schemabaseline kent governance_log niet meer");
  const blok = baseline.slice(start, baseline.indexOf(");", start));
  const namen = [...blok.matchAll(/^\s+"([a-z_]+)"/gm)].map((m) => m[1]);
  assert.ok(namen.length > 5, "kolommen niet herkend — de baseline-vorm is veranderd");
  return new Set(namen);
}

const GOVERNANCE_LOG_KOLOMMEN = kolommenVanGovernanceLog();

/**
 * Een eerlijke namaak-queryketen: zij past ALLEEN de filters toe die de code
 * daadwerkelijk zet, en zij weigert een kolomnaam die niet bestaat. Laat het
 * leespad `.eq("fonds_id", …)` weg, dan komen de rijen van het andere fonds
 * gewoon terug en gaat de test rood — dat is de negatieve controle, ingebakken
 * in de fixture.
 */
function namaakBron(
  rijen: { fonds_id: string; retrieval_meta: unknown }[],
  rpcUitkomst: { data: unknown; error: unknown } = { data: null, error: { code: "PGRST202" } }
) {
  const gezien = {
    filters: [] as [string, string][],
    limiet: 0,
    tabel: "",
    geselecteerd: "",
    sortering: "",
    rpc: [] as [string, Record<string, unknown>][],
  };
  const eisKolom = (kolom: string) => {
    assert.ok(
      GOVERNANCE_LOG_KOLOMMEN.has(kolom),
      `het leespad noemt kolom "${kolom}", die governance_log niet heeft`
    );
  };
  const maakQuery = (huidig: typeof rijen): MetaQuery => ({
    select(kolommen) {
      for (const k of kolommen.split(",")) eisKolom(k.trim());
      gezien.geselecteerd = kolommen;
      return maakQuery(huidig);
    },
    eq(kolom, waarde) {
      eisKolom(kolom);
      gezien.filters.push([kolom, waarde]);
      return maakQuery(huidig.filter((r) => (r as Record<string, unknown>)[kolom] === waarde));
    },
    not(kolom, _operator, _waarde) {
      eisKolom(kolom);
      return maakQuery(huidig.filter((r) => r.retrieval_meta !== null));
    },
    order(kolom) {
      eisKolom(kolom);
      gezien.sortering = kolom;
      return maakQuery(huidig);
    },
    limit(aantal) {
      gezien.limiet = aantal;
      return Promise.resolve({
        data: huidig.slice(0, aantal).map((r) => ({ retrieval_meta: r.retrieval_meta })),
        error: null,
      });
    },
  });
  const bron: MetaBron = {
    from(tabel) {
      gezien.tabel = tabel;
      return maakQuery(rijen);
    },
    rpc(naam, parameters) {
      gezien.rpc.push([naam, parameters]);
      return Promise.resolve(rpcUitkomst);
    },
  };
  return { bron, gezien };
}

const FONDS_A = "11111111-1111-4111-8111-111111111111";
const FONDS_B = "22222222-2222-4222-8222-222222222222";

test("een gebruiker ZONDER de capability krijgt 403 en er wordt niets gelezen", async () => {
  // De volgorde is de eis: een weigering ná de query heeft de rijen al
  // opgehaald. Daarom telt deze test de aanroepen van de bron.
  let gelezen = 0;
  const uitkomst = await leesAdapterstand({
    gebruikerId: "zonder-recht",
    fondsId: FONDS_A,
    magBeheren: async () => false,
    bron: {
      from() {
        gelezen += 1;
        throw new Error("het leespad mag hier nooit komen");
      },
      rpc() {
        gelezen += 1;
        throw new Error("ook het fondsbrede pad mag hier nooit komen");
      },
    },
  });
  assert.equal(uitkomst.status, 403);
  assert.equal(gelezen, 0, "er is gelezen vóórdat de capability was getoetst");
});

test("TERUGVAL — CROSS-TENANT: de stand bevat uitsluitend de eigen fondsrijen", async () => {
  const { bron, gezien } = namaakBron([
    { fonds_id: FONDS_A, retrieval_meta: { adapters: [geldigeRij("supabase-rag")] } },
    { fonds_id: FONDS_B, retrieval_meta: { adapters: [geldigeRij("microsoft-sharepoint")] } },
    { fonds_id: FONDS_B, retrieval_meta: { adapters: [geldigeRij("microsoft-sharepoint")] } },
  ]);
  const uitkomst = await leesAdapterstand({
    gebruikerId: "beheerder-a",
    fondsId: FONDS_A,
    magBeheren: async () => true,
    bron,
  });
  assert.equal(uitkomst.status, 200);
  assert.ok(uitkomst.status === 200);
  assert.deepEqual(
    uitkomst.stand.regels.map((r) => r.naam),
    ["supabase-rag"],
    "de beheerstand van fonds A toont een adapter die alleen bij fonds B draaide"
  );
  assert.equal(uitkomst.stand.dekking.metarijen_gelezen, 1);
  // En het filter is werkelijk gezet — niet alleen in de uitkomst zichtbaar.
  assert.deepEqual(gezien.filters, [["fonds_id", FONDS_A]]);
  assert.equal(gezien.tabel, "governance_log");
  assert.equal(gezien.geselecteerd, "retrieval_meta");
  assert.equal(gezien.limiet, ADAPTERSTATUS_LIMIET);
  assert.equal(gezien.sortering, "aangemaakt", "governance_log heeft geen kolom `aangemaakt_op`");
  // En de stand noemt zichzelf niet fondsbreed: onder RLS ziet dit pad alleen
  // de eigen beurten van de kijker.
  assert.equal(uitkomst.stand.reikwijdte, "eigen_beurten");
});

test("een profiel zonder fonds leest niets en krijgt een lege, volledige stand", async () => {
  let gelezen = 0;
  const uitkomst = await leesAdapterstand({
    gebruikerId: "beheerder-zonder-fonds",
    fondsId: null,
    magBeheren: async () => true,
    bron: {
      from() {
        gelezen += 1;
        throw new Error("zonder fonds is er geen tenant om binnen te blijven");
      },
      rpc() {
        gelezen += 1;
        throw new Error("zonder fonds is er geen tenant om binnen te blijven");
      },
    },
  });
  assert.equal(gelezen, 0);
  assert.ok(uitkomst.status === 200);
  assert.deepEqual(uitkomst.stand.regels, []);
});

test("een leesfout levert 503 en geen half gevulde stand", async () => {
  const kapot: MetaBron = {
    from: () => {
      const q: MetaQuery = {
        select: () => q,
        eq: () => q,
        not: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data: null, error: { message: "rls" } }),
      };
      return q;
    },
    rpc: () => Promise.resolve({ data: null, error: { code: "PGRST202" } }),
  };
  const uitkomst = await leesAdapterstand({
    gebruikerId: "beheerder-a", fondsId: FONDS_A, magBeheren: async () => true, bron: kapot,
  });
  assert.equal(uitkomst.status, 503);
});

// ── 6b. Het FONDSBREDE pad, en waarom het bestaat ─────────────────────────

test("FONDSBREED: beurten van een collega tellen mee in de stand", async () => {
  // De kern van de bevinding. De RLS-policy op governance_log is
  // `gebruiker_id = auth.uid() or mag_audit(fonds_id)`, en `mag_audit()` eist de
  // aparte grant `governance_audit_read` die `fonds.config.manage` niet geeft.
  // Via het tabelpad ziet een beheerder dus alleen zichzelf. Het definer-pad
  // levert het hele fonds, en uitsluitend de gesloten tellers.
  const { bron, gezien } = namaakBron([], {
    data: {
      fondsbreed: true,
      rijen: [
        { adapters: [geldigeRij("supabase-rag")] },         // eigen beurt
        { adapters: [geldigeRij("microsoft-sharepoint")] }, // beurt van een collega
        {},                                                 // beurt met één adapter
      ],
    },
    error: null,
  });
  const uitkomst = await leesAdapterstand({
    gebruikerId: "beheerder-a", fondsId: FONDS_A, magBeheren: async () => true, bron,
  });
  assert.ok(uitkomst.status === 200);
  assert.equal(uitkomst.stand.reikwijdte, "fonds");
  assert.deepEqual(
    uitkomst.stand.regels.map((r) => r.naam).sort(),
    ["microsoft-sharepoint", "supabase-rag"],
    "de beurt van de collega ontbreekt — dan is dit geen fondsstand"
  );
  assert.equal(uitkomst.stand.dekking.metarijen_zonder_adapters, 1);
  assert.equal(uitkomst.stand.volledig, true);
  // Geen fondsparameter: de functie leidt fonds én rol af uit auth.uid(), dus
  // er valt niets mee te geven wat de tenantgrens verplaatst.
  assert.deepEqual(gezien.rpc, [[ADAPTERSTAND_RPC, { p_limiet: ADAPTERSTATUS_LIMIET }]]);
  assert.equal(
    JSON.stringify(gezien.rpc).includes(FONDS_A),
    false,
    "een fonds-id als parameter is een tenantgrens die de aanroeper kan verzetten"
  );
  // En het RLS-beperkte tabelpad is dan niet gebruikt.
  assert.equal(gezien.tabel, "");
});

test("FONDSBREED: een onleesbare regel komt als null terug en wordt geteld", async () => {
  // De definer-functie vangt per rij `check_violation` af en levert null. Zou
  // zij die rij stil weglaten, dan noemde de stand zich alsnog volledig.
  const { bron } = namaakBron([], {
    data: { fondsbreed: true, rijen: [{ adapters: [geldigeRij("supabase-rag")] }, null] },
    error: null,
  });
  const uitkomst = await leesAdapterstand({
    gebruikerId: "beheerder-a", fondsId: FONDS_A, magBeheren: async () => true, bron,
  });
  assert.ok(uitkomst.status === 200);
  assert.equal(uitkomst.stand.volledig, false);
  assert.equal(uitkomst.stand.dekking.metarijen_overgeslagen, 1);
});

test("zonder het fondsbrede pad valt de stand terug ÉN zegt zij dat", async () => {
  // Supabase-eerst is de conventie, maar een code-deploy kan vóór de migratie
  // liggen. Dan is een gelabelde, beperkte stand beter dan een lege pagina —
  // mits zij zichzelf geen fondsstand noemt.
  const { bron } = namaakBron(
    [{ fonds_id: FONDS_A, retrieval_meta: { adapters: [geldigeRij("supabase-rag")] } }],
    { data: null, error: { code: "42883", message: "function does not exist" } }
  );
  const uitkomst = await leesAdapterstand({
    gebruikerId: "beheerder-a", fondsId: FONDS_A, magBeheren: async () => true, bron,
  });
  assert.ok(uitkomst.status === 200);
  assert.equal(uitkomst.stand.reikwijdte, "eigen_beurten");
  assert.equal(uitkomst.stand.regels.length, 1);
});

test("een RPC-fout die GÉÉN ontbrekende functie is, levert 503 en geen terugval", async () => {
  // Een weigering, een defecte functie of een mislukte inzageregel mag niet
  // lijken op een normale, beperkte stand. Dat zou dezelfde stille degradatie
  // zijn in een nieuwe vermomming: de kijker ziet cijfers en merkt niets.
  for (const fout of [
    { code: "42501", message: "insufficient privilege" },
    { code: "P0001", message: "iets anders stuk" },
    { message: "zonder code" },
  ]) {
    const { bron, gezien } = namaakBron(
      [{ fonds_id: FONDS_A, retrieval_meta: { adapters: [geldigeRij("supabase-rag")] } }],
      { data: null, error: fout }
    );
    const uitkomst = await leesAdapterstand({
      gebruikerId: "beheerder-a", fondsId: FONDS_A, magBeheren: async () => true, bron,
    });
    assert.equal(uitkomst.status, 503, `fout ${JSON.stringify(fout)} leverde geen 503`);
    assert.equal(gezien.tabel, "", "er is stilletjes op het tabelpad teruggevallen");
  }
});

test("een onherkenbaar RPC-antwoord levert 503, geen halve stand", async () => {
  for (const data of [null, [], { rijen: [] }, { fondsbreed: "ja", rijen: [] }, "tekst"]) {
    const { bron } = namaakBron([], { data, error: null });
    const uitkomst = await leesAdapterstand({
      gebruikerId: "beheerder-a", fondsId: FONDS_A, magBeheren: async () => true, bron,
    });
    assert.equal(uitkomst.status, 503, `antwoord ${JSON.stringify(data)} werd geaccepteerd`);
  }
});

test("de beheerpagina TOONT de reikwijdte; zij kan hem niet vergeten", () => {
  const pagina = lees("app/(dashboard)/beheer/adapterstatus/page.tsx");
  assert.match(pagina, /reikwijdte === "eigen_beurten"/);
  assert.match(pagina, /Alleen uw eigen beurten/);
  assert.match(pagina, /governance_audit_read/, "de pagina hoort te zeggen wat zij NIET opent");
});

// ── 6c. Het auditbeleid van 0119 wordt gevolgd, niet uitgezonderd ─────────

test("de poort is de CAPABILITY, niet een rol", async () => {
  // Besluit 0119 heeft "rol beheerder als autorisatie" expliciet verworpen. De
  // functie beslist zelf op `mag_audit()` en meldt welke stand zij leverde;
  // deze laag leidt de reikwijdte NIET af, want dat zou een gok zijn.
  const { bron, gezien } = namaakBron([], {
    data: { fondsbreed: false, rijen: [{ adapters: [geldigeRij("supabase-rag")] }] },
    error: null,
  });
  const uitkomst = await leesAdapterstand({
    gebruikerId: "beheerder-zonder-grant", fondsId: FONDS_A, magBeheren: async () => true, bron,
  });
  assert.ok(uitkomst.status === 200);
  assert.equal(uitkomst.stand.reikwijdte, "eigen_beurten");
  assert.equal(uitkomst.stand.regels.length, 1);
  // En er is NIET alsnog stiekem op het tabelpad overgestapt.
  assert.equal(gezien.tabel, "");
});

test("de SQL-poort is `mag_audit()` en schrijft een inzageregel", () => {
  const migratie = lees("supabase/migrations/2026_09_23_434_adapterstand_fonds.sql");
  const zonderCommentaar = migratie
    .replace(/^\s*--.*$/gm, "")
    .replace(/comment on function[\s\S]*?';/g, "");
  assert.match(zonderCommentaar, /create or replace function public\.fn_adapterstand_fonds/);
  assert.match(zonderCommentaar, /v_fondsbreed := public\.mag_audit\(v_fonds\);/);
  assert.match(zonderCommentaar, /insert into public\.governance_audit_inzage/);
  // GEEN rolgate meer: dat was precies het verworpen alternatief uit 0119.
  assert.equal(
    /p\.rol|'beheerder'|'voorzitter'/.test(zonderCommentaar),
    false,
    "een rol is permanent en grofmazig; 0119 heeft dat alternatief verworpen"
  );
  // De inzageregel hoort bij de FONDSBREDE tak, niet bij een eigen-standlezing.
  assert.match(
    zonderCommentaar,
    /if v_fondsbreed then[\s\S]*?insert into public\.governance_audit_inzage/
  );
  // Basisniveau, dus geen motivering — conform de CHECK op de inzagetabel.
  assert.match(zonderCommentaar, /false, null\);/);
});

test("het besluit is vastgelegd en verwijst naar 0119", () => {
  // De keuze om deze tellers NIET uit te zonderen is een governancebesluit, geen
  // implementatiedetail. Zonder vastlegging staat er over een jaar een rolgate
  // terug omdat niemand meer weet waarom die er niet mocht staan.
  const besluit = lees("decisions/0214-adapterstand-volgt-het-auditbeleid.md");
  assert.match(besluit, /\[\[0119\]\]/);
  assert.match(besluit, /fn_adapterstand_fonds/);
  assert.match(besluit, /governance_audit_inzage/);
});

test("het nieuwe databaseobject staat in de grants-allowlist", () => {
  // De V3-grants-gate gaat anders rood met "LEK onbekend object"; die regel
  // staat in de Definition of Done en is vorige ronde al een keer gemist.
  const tsv = lees("supabase/checks/allowlist-grants.tsv");
  for (const [rol, recht] of [["anon", "-"], ["authenticated", "EXECUTE"], ["service_role", "EXECUTE"]]) {
    assert.ok(
      tsv.includes(`FUNC\tpublic\tfn_adapterstand_fonds(p_limiet integer)\tfunction\t${rol}\t${recht}`),
      `allowlist mist de regel voor ${rol}`
    );
  }
  assert.match(lees("supabase/checks/allowlist-grants.toelichting.md"), /fn_adapterstand_fonds/);
});

test("de beheerroute en de beheerpagina delen één leespad en dragen geen service-role", () => {
  // Structurele controle, NIET het autorisatiebewijs: dat staat hierboven en
  // draait de code. Wat hier wordt vastgelegd, is dat route en scherm niet
  // ieder hun eigen query krijgen — twee leespaden is hoe een scherm iets
  // anders gaat tonen dan de API teruggeeft.
  for (const pad of [
    "app/api/beheer/adapterstatus/route.ts",
    "app/(dashboard)/beheer/adapterstatus/page.tsx",
  ]) {
    const bron = lees(pad);
    assert.match(bron, /leesAdapterstand\(/, `${pad} bouwt een eigen leespad`);
    assert.match(bron, /"fonds\.config\.manage"/, `${pad} draagt de bestaande capability niet`);
    assert.equal(/\.from\(["']governance_log["']\)/.test(bron), false, `${pad} bevraagt zelf de tabel`);
    // Op GEBRUIK matchen, niet op proza: de bestanden bevatten zelf een
    // commentaarregel die zegt dát er geen service-role is.
    const zonderCommentaar = bron.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(
      /SERVICE_ROLE|createServiceRole|service_role/i.test(zonderCommentaar),
      false,
      `geen service-role in ${pad}`
    );
  }
  assert.match(lees("app/api/beheer/adapterstatus/route.ts"), /hostGuard: "afdwingen"/);
});

// ── 7. De foutcategorie bereikt het DUURZAME spoor ─────────────────────────

test("een geweigerde adaptermetadatavorm is een genormaliseerde foutcategorie", () => {
  // Droeg alleen het Error-object de categorie, dan bestond de weigering na
  // afloop van het verzoek nergens meer. Via `foutcategorieVoor()` belandt zij
  // op `ai_actie.resultaat_ref` — hetzelfde pad als timeout en annulering.
  assert.equal(foutcategorieVoor(new AdaptermetadataOngeldig("bytes")), ADAPTERMETA_FOUTCATEGORIE);
  assert.equal(foutcategorieVoor(new Error("iets anders")), null);
  // De duurzame verwijzing draagt de categorie en NOOIT het afgewezen veld.
  assert.equal(ADAPTERMETA_DUURZAME_REF, `retrieval:${ADAPTERMETA_FOUTCATEGORIE}`);
  assert.equal(ADAPTERMETA_DUURZAME_REF.includes("bytes"), false);

  // Structureel: de chatroute schrijft de categorie strikt weg (met alarm) en
  // meldt de gebruiker dat er daarom geen antwoord is.
  const chat = lees("app/api/chat/route.ts");
  assert.match(chat, /rondAfStrikt\(\s*supabase,\s*aiActieId,\s*"mislukt",\s*`\$\{fase\}:\$\{afbreekreden\}`/);
  assert.match(chat, /afbreekreden === "adaptermetadata_ongeldig"/);
  // En `fase` is op het retrievalmoment nog "retrieval", dus de duurzame
  // verwijzing is letterlijk ADAPTERMETA_DUURZAME_REF. Dat is een
  // VOLGORDE-feit in het bestand, geen formulering: de omschakeling naar
  // "generatie" staat ná de retrievalaanroep.
  assert.ok(
    chat.indexOf('voerVolledigeRetrievalUit(') < chat.indexOf('fase = "generatie"'),
    "de fase schakelt vóór de retrieval om; dan draagt het spoor de verkeerde fase"
  );
  const zoeken = lees("app/api/zoeken/route.ts");
  assert.match(zoeken, /afbreking === ADAPTERMETA_FOUTCATEGORIE/);
});

// ── 8. Eén gesloten contract over TypeScript, SQL en beheer ────────────────

test("de TS-validator en de SQL-vormcontrole hanteren DEZELFDE gesloten regels", () => {
  // Liepen de twee uiteen, dan accepteerde de ene laag wat de andere weigerde:
  // de beurt faalde dan pas bij het wegschrijven, met een databasefout in
  // plaats van de eigen inhoudsvrije foutcategorie.
  const migratie = lees("supabase/migrations/2026_09_22_434_meta_adapters.sql");

  const uitSql = (veld: string) => {
    const m = new RegExp(`e->>'${veld}' not in \\(([\\s\\S]*?)\\)`).exec(migratie);
    assert.ok(m, `SQL kent geen gesloten verzameling voor ${veld}`);
    return [...m[1].matchAll(/'([a-z_-]+)'/g)].map((x) => x[1]).sort();
  };
  assert.deepEqual(uitSql("naam"), [...ADAPTERMETA_NAMEN].sort());
  assert.deepEqual(uitSql("resultaat"), [...ADAPTERMETA_RESULTATEN].sort());
  assert.deepEqual(
    uitSql("methode"),
    [...ADAPTERMETA_METHODEN].sort(),
    "`methode` moet in beide lagen dezelfde gesloten lijst zijn — niet een lengtegrens"
  );
  // De rijgrens.
  const grens = /jsonb_array_length\(v_adapters\) > (\d+)/.exec(migratie);
  assert.ok(grens);
  assert.equal(Number(grens[1]), ADAPTERMETA_MAX_RIJEN);
  // En de gehele-getallen-eis staat in SQL per teller; TypeScript doet hem met
  // Number.isInteger. Bewijs dat de SQL-regel er nog is voor élke teller.
  const tellers = [...migratie.matchAll(/floor\(\(e->>'([a-z_]+)'\)::numeric\)/g)].map((m) => m[1]);
  assert.equal(tellers.length, 19, "niet elke teller draagt de gehele-getallen-eis meer");
});

test("de gesloten lijsten laten geen vrije tekst meer door", () => {
  // De scherpe vorm: een providerfoutcode van 12 tekens paste moeiteloos in de
  // oude lengtegrens van 40.
  const migratie = lees("supabase/migrations/2026_09_22_434_meta_adapters.sql");
  assert.equal(
    /length\(e->>'methode'\)/.test(migratie),
    false,
    "een lengtegrens is geen gesloten vorm"
  );
  assert.equal((ADAPTERMETA_METHODEN as readonly string[]).includes("AADSTS700016"), false);
});
