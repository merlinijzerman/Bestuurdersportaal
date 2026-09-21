// ============================================================================
//  #423 T4-D — readinesspoort, scopenormalisatie en de vaste toelatingsvolgorde.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk, geen database, geen Microsoft-permission, geen
//  live Retrieval-call. Elke tokenbron in dit bestand is een tellende stub.
// ============================================================================
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  COPILOT_VEREISTE_SCOPES,
  beoordeelReadiness,
  beoordeelTokenbevestiging,
  heeftBeideScopes,
  isBewustUit,
  normaliseerScope,
  ontbrekendeScopes,
  readinessNogGeldig,
  stoptBeurt,
  type CopilotReadinessBewijs,
  type CopilotTokenbronProfiel,
} from "../../core/lib/microsoft-retrieval/rollout-core";
import {
  beoordeelToelating,
  type CopilotTokenbewijs,
  type CopilotTokenbron,
  type CopilotToelatingDeps,
} from "../../core/lib/microsoft-retrieval/copilot-tokenbron";

const PROFIEL: CopilotTokenbronProfiel = {
  tenantId: "tenant-a",
  clientId: "client-preview",
  credentialmodel: "confidential_client_secret",
};

const BEIDE = ["Files.Read.All", "Sites.Read.All"];

function bewijs(overrides: Partial<CopilotReadinessBewijs> = {}): CopilotReadinessBewijs {
  return {
    globaleRolloutAan: true,
    fondsflagAan: true,
    billingGeldig: true,
    tijdelijkGeblokkeerd: false,
    verbinding: {
      status: "gekoppeld",
      tenantId: "tenant-a",
      actorObjectId: "oid-1",
      clientId: "client-preview",
      scopes: BEIDE,
      verbindingVersie: 7,
    },
    fondsId: "fonds-1",
    actorId: "actor-1",
    verwachteFondsId: "fonds-1",
    verwachteActorId: "actor-1",
    ...overrides,
  };
}

// ===========================================================================
//  Scopenormalisatie — de URI mag uitsluitend van graph.microsoft.com komen
// ===========================================================================

test("kale scopes en Graph-URI's worden herkend, ongeacht casing", () => {
  assert.equal(normaliseerScope("Files.Read.All"), "files.read.all");
  assert.equal(normaliseerScope("  files.READ.all  "), "files.read.all");
  assert.equal(normaliseerScope("https://graph.microsoft.com/Files.Read.All"), "files.read.all");
  assert.equal(normaliseerScope("https://GRAPH.microsoft.com/Sites.Read.All"), "sites.read.all");
});

test("een scope-URI van een andere host telt niet, hoe erg hij er ook op lijkt", () => {
  for (const kwaad of [
    "https://graph.microsoft.com.evil.example/Files.Read.All",
    "https://evil.example/graph.microsoft.com/Files.Read.All",
    "https://sub.graph.microsoft.com/Files.Read.All",
    "http://graph.microsoft.com/Files.Read.All",
    "https://graph.microsoft.com:8443/Files.Read.All",
    "https://user:pw@graph.microsoft.com/Files.Read.All",
    "https://graph.microsoft.com/Files.Read.All?x=1",
    "https://graph.microsoft.com/Files.Read.All#frag",
    "https://graph.microsoft.com/v1.0/Files.Read.All",
    "https://graph.microsoft.com/",
    "",
    "   ",
    "Files Read All",
  ]) {
    assert.equal(normaliseerScope(kwaad), null, kwaad);
  }
});

test("een bredere permissie wordt niet als de vereiste scope geaccepteerd", () => {
  // De klassieke includes()-fout: "Files.Read.All" zit als deelreeks in
  // "Files.Read.All.Something", maar dat is een andere permissie.
  assert.equal(heeftBeideScopes(["Files.Read.All.Something", "Sites.Read.All"]), false);
  assert.equal(heeftBeideScopes(["Files.Read.All", "Sites.Read.All.Extra"]), false);
  assert.deepEqual(ontbrekendeScopes(["Files.Read.All.Something", "Sites.Read.All"]), ["Files.Read.All"]);
});

test("beide scopes zijn vereist; één is niet genoeg", () => {
  assert.equal(heeftBeideScopes(BEIDE), true);
  assert.equal(heeftBeideScopes(["https://graph.microsoft.com/Files.Read.All", "Sites.Read.All"]), true);
  assert.equal(heeftBeideScopes(["Files.Read.All"]), false);
  assert.equal(heeftBeideScopes(["Sites.Read.All"]), false);
  assert.equal(heeftBeideScopes([]), false);
  assert.equal(COPILOT_VEREISTE_SCOPES.length, 2);
});

// ===========================================================================
//  Readiness — volledige conjunctie, vaste volgorde
// ===========================================================================

test("kill switch of fondsflag dicht is BEWUST UIT: geen spoor, geen fout", () => {
  for (const dicht of [{ globaleRolloutAan: false }, { fondsflagAan: false }]) {
    const uitkomst = beoordeelReadiness(bewijs(dicht), PROFIEL);
    assert.equal(uitkomst.toestand, "uit");
    assert.equal(uitkomst.verbindingVersie, null, "een dichte schakelaar levert geen stempel");
    assert.equal(isBewustUit(uitkomst.toestand), true);
    assert.equal(stoptBeurt(uitkomst.toestand), false, "bewust uit is geen beurtafbrekende fout");
  }
});

test("de volledige keten levert gereed_onder_voorbehoud, nooit meteen gereed", () => {
  const uitkomst = beoordeelReadiness(bewijs(), PROFIEL);
  assert.equal(uitkomst.toestand, "gereed_onder_voorbehoud");
  assert.equal(uitkomst.verbindingVersie, 7);
});

test("elk ontbrekend readinessonderdeel stopt fail-closed met de juiste reden", () => {
  const gevallen: Array<[Partial<CopilotReadinessBewijs>, string]> = [
    [{ verbinding: null }, "consent_ontbreekt"],
    [{ verbinding: { ...bewijs().verbinding!, clientId: null } }, "configuratie_ongeldig"],
    [{ verbinding: { ...bewijs().verbinding!, clientId: "client-productie" } }, "configuratie_ongeldig"],
    [{ verbinding: { ...bewijs().verbinding!, tenantId: "tenant-b" } }, "configuratie_ongeldig"],
    [{ verbinding: { ...bewijs().verbinding!, status: "ontkoppeld" } }, "consent_ontbreekt"],
    [{ verbinding: { ...bewijs().verbinding!, scopes: ["Files.Read.All"] } }, "configuratie_ongeldig"],
    [{ billingGeldig: false }, "billing_ontbreekt"],
    [{ tijdelijkGeblokkeerd: true }, "tijdelijk_geblokkeerd"],
    [{ fondsId: "fonds-2" }, "configuratie_ongeldig"],
    [{ actorId: "actor-2" }, "configuratie_ongeldig"],
  ];
  for (const [override, verwacht] of gevallen) {
    const uitkomst = beoordeelReadiness(bewijs(override), PROFIEL);
    assert.equal(uitkomst.toestand, verwacht, JSON.stringify(override));
    assert.equal(stoptBeurt(uitkomst.toestand), true, JSON.stringify(override));
  }
});

test("gereed kan niet uit twee verschillende momentopnames ontstaan", () => {
  const eerste = beoordeelReadiness(bewijs(), PROFIEL);
  const tweede = beoordeelReadiness(bewijs({ verbinding: { ...bewijs().verbinding!, verbindingVersie: 8 } }), PROFIEL);
  assert.equal(readinessNogGeldig(eerste, tweede), false);
  assert.equal(readinessNogGeldig(eerste, eerste), true);
});

test("een readiness die niet gereed was, wordt nooit alsnog geldig verklaard", () => {
  const uit = beoordeelReadiness(bewijs({ globaleRolloutAan: false }), PROFIEL);
  const goed = beoordeelReadiness(bewijs(), PROFIEL);
  assert.equal(readinessNogGeldig(uit, goed), false);
  assert.equal(readinessNogGeldig(goed, uit), false);
});

// ===========================================================================
//  Tokenbevestiging — het resultaat, niet de opgeslagen verbinding
// ===========================================================================

test("het tokenresultaat moet beide scopes, tenant, actor en app bevestigen", () => {
  const verbinding = { tenantId: "tenant-a", actorObjectId: "oid-1" };
  const goed = { tenantId: "tenant-a", actorObjectId: "oid-1", clientId: "client-preview", scopes: BEIDE };
  assert.deepEqual(beoordeelTokenbevestiging(goed, PROFIEL, verbinding), { ok: true });

  const gevallen: Array<[Partial<typeof goed>, string]> = [
    [{ scopes: ["Files.Read.All"] }, "scopes"],
    [{ tenantId: "tenant-b" }, "tenant"],
    [{ actorObjectId: "oid-2" }, "actor"],
    [{ clientId: "client-productie" }, "app"],
  ];
  for (const [override, reden] of gevallen) {
    const oordeel = beoordeelTokenbevestiging({ ...goed, ...override }, PROFIEL, verbinding);
    assert.deepEqual(oordeel, { ok: false, reden }, JSON.stringify(override));
  }
});

test("een token dat de verbinding tegenspreekt wordt geweigerd, ook als het profiel klopt", () => {
  // De verbinding beweert oid-1; Microsoft gaf een token voor oid-9 uit.
  const oordeel = beoordeelTokenbevestiging(
    { tenantId: "tenant-a", actorObjectId: "oid-9", clientId: "client-preview", scopes: BEIDE },
    PROFIEL,
    { tenantId: "tenant-a", actorObjectId: "oid-1" },
  );
  assert.deepEqual(oordeel, { ok: false, reden: "actor" });
});

// ===========================================================================
//  De vaste volgorde: readiness → tokenbewijs → herlezing → pas dan Retrieval
// ===========================================================================

function tellendeBron(overrides: Partial<CopilotTokenbewijs["bevestigd"]> = {}) {
  let aanroepen = 0;
  const bron: CopilotTokenbron = {
    profiel: PROFIEL,
    async haalToken() {
      aanroepen += 1;
      return {
        accessToken: "stub-token",
        bevestigd: { tenantId: "tenant-a", actorObjectId: "oid-1", clientId: "client-preview", scopes: BEIDE, ...overrides },
      };
    },
  };
  return { bron, aantal: () => aanroepen };
}

function deps(
  reeks: ReturnType<typeof beoordeelReadiness>[],
  bron: CopilotTokenbron,
  verbinding: { tenantId: string; actorObjectId: string } | null = { tenantId: "tenant-a", actorObjectId: "oid-1" },
): CopilotToelatingDeps & { lezingen: () => number } {
  let index = 0;
  return {
    tokenbron: bron,
    async leesReadiness() {
      const uitkomst = reeks[Math.min(index, reeks.length - 1)];
      index += 1;
      return { uitkomst, verbinding };
    },
    lezingen: () => index,
  };
}

test("de volgorde is readiness, tokenbewijs, herlezing en pas daarna toelating", async () => {
  const goed = beoordeelReadiness(bewijs(), PROFIEL);
  const { bron, aantal } = tellendeBron();
  const d = deps([goed, goed], bron);
  const uitkomst = await beoordeelToelating(d, { fondsId: "fonds-1", gebruikerId: "actor-1" });

  assert.equal(uitkomst.toegelaten, true);
  assert.equal(aantal(), 1, "precies één tokenaanvraag");
  assert.equal(d.lezingen(), 2, "readiness wordt vóór én ná het token gelezen");
  if (uitkomst.toegelaten) assert.equal(uitkomst.readiness.toestand, "gereed");
});

test("bij bewust uit of een readinessgat wordt er geen token opgehaald", async () => {
  for (const [override, reden] of [
    [{ globaleRolloutAan: false }, "uit"],
    [{ fondsflagAan: false }, "uit"],
    [{ billingGeldig: false }, "billing_ontbreekt"],
    [{ verbinding: null }, "consent_ontbreekt"],
    [{ tijdelijkGeblokkeerd: true }, "tijdelijk_geblokkeerd"],
  ] as Array<[Partial<CopilotReadinessBewijs>, string]>) {
    const uitkomst0 = beoordeelReadiness(bewijs(override), PROFIEL);
    const { bron, aantal } = tellendeBron();
    const d = deps([uitkomst0], bron);
    const uitkomst = await beoordeelToelating(d, { fondsId: "fonds-1", gebruikerId: "actor-1" });
    assert.equal(uitkomst.toegelaten, false, JSON.stringify(override));
    if (!uitkomst.toegelaten) assert.equal(uitkomst.reden, reden, JSON.stringify(override));
    assert.equal(aantal(), 0, `tokenaanvraag gedaan bij ${reden}`);
    assert.equal(d.lezingen(), 1, "er is geen tweede lezing nodig als de eerste al stopt");
  }
});

test("een intrekking tussen tokenbewijs en toelating stopt de beurt alsnog", async () => {
  const goed = beoordeelReadiness(bewijs(), PROFIEL);
  const gewijzigd = beoordeelReadiness(
    bewijs({ verbinding: { ...bewijs().verbinding!, verbindingVersie: 8 } }),
    PROFIEL,
  );
  const { bron, aantal } = tellendeBron();
  const uitkomst = await beoordeelToelating(deps([goed, gewijzigd], bron), { fondsId: "fonds-1", gebruikerId: "actor-1" });

  assert.equal(uitkomst.toegelaten, false);
  if (!uitkomst.toegelaten) assert.equal(uitkomst.reden, "readiness_gewijzigd");
  assert.equal(aantal(), 1, "het token was al opgehaald; juist daarom is de herlezing nodig");
});

test("een tokenrefresh tijdens het verzoek breekt de beurt niet af", async () => {
  // Een refresh hoogt token_cache.versie op maar verbinding_versie niet, dus de
  // stempel blijft gelijk en de beurt loopt door.
  const goed = beoordeelReadiness(bewijs(), PROFIEL);
  const naRefresh = beoordeelReadiness(bewijs(), PROFIEL);
  const { bron } = tellendeBron();
  const uitkomst = await beoordeelToelating(deps([goed, naRefresh], bron), { fondsId: "fonds-1", gebruikerId: "actor-1" });
  assert.equal(uitkomst.toegelaten, true);
});

test("een tokenbewijs dat niet klopt laat de beurt niet door", async () => {
  const goed = beoordeelReadiness(bewijs(), PROFIEL);
  for (const override of [{ scopes: ["Files.Read.All"] }, { tenantId: "tenant-b" }, { clientId: "client-productie" }]) {
    const { bron } = tellendeBron(override);
    const uitkomst = await beoordeelToelating(deps([goed, goed], bron), { fondsId: "fonds-1", gebruikerId: "actor-1" });
    assert.equal(uitkomst.toegelaten, false, JSON.stringify(override));
    if (!uitkomst.toegelaten) assert.equal(uitkomst.reden, "tokenbewijs_ongeldig");
  }
});

test("een onbereikbare tokenbron lekt de onderliggende fout niet", async () => {
  const goed = beoordeelReadiness(bewijs(), PROFIEL);
  const bron: CopilotTokenbron = {
    profiel: PROFIEL,
    async haalToken() { throw new Error("AADSTS700016: geheim en pad in de melding"); },
  };
  const uitkomst = await beoordeelToelating(deps([goed, goed], bron), { fondsId: "fonds-1", gebruikerId: "actor-1" });
  assert.equal(uitkomst.toegelaten, false);
  if (!uitkomst.toegelaten) {
    assert.equal(uitkomst.reden, "tokenbron_onbereikbaar");
    assert.ok(!JSON.stringify(uitkomst).includes("AADSTS"), "de providerfout lekt naar buiten");
  }
});

// ===========================================================================
//  Statische grenzen
// ===========================================================================

test("de kern leidt tenant en client-id niet zelf af uit microsoftConfig", () => {
  // Twee afleidingen van hetzelfde feit kunnen uiteenlopen; dan is onduidelijk
  // welke won. De tokenbron is de enige bron van dit profiel.
  const root = resolve(import.meta.dirname, "../..");
  for (const bestand of [
    "core/lib/microsoft-retrieval/rollout-core.ts",
    "core/lib/microsoft-retrieval/copilot-tokenbron.ts",
  ]) {
    const inhoud = readFileSync(resolve(root, bestand), "utf8");
    // Op import en aanroep, niet op elke vermelding: een toelichting die uitlegt
    // waarom de config hier NIET wordt gelezen, is juist waardevol.
    const zonderCommentaar = inhoud.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    assert.ok(
      !/from\s+["'][^"']*microsoft-config["']/.test(zonderCommentaar),
      `${bestand} importeert microsoft-config`,
    );
    assert.ok(
      !/\bmicrosoftConfig\s*\(/.test(zonderCommentaar),
      `${bestand} leidt de config zelf af`,
    );
  }
});

test("de kern doet zelf geen enkele Retrieval- of Graph-call", () => {
  const root = resolve(import.meta.dirname, "../..");
  for (const bestand of [
    "core/lib/microsoft-retrieval/rollout-core.ts",
    "core/lib/microsoft-retrieval/copilot-tokenbron.ts",
  ]) {
    const inhoud = readFileSync(resolve(root, bestand), "utf8");
    assert.ok(!/\bfetch\s*\(/.test(inhoud), `${bestand} doet een netwerkcall`);
    assert.ok(!inhoud.includes("copilot/retrieval"), `${bestand} kent het Retrieval-endpoint`);
  }
});

test("de tokenpaden van de connector zijn niet verbreed", () => {
  // T4-D bouwt een eigen bron; sharepointAccessToken blijft van SharePoint. De
  // koppelflow is wél aangeraakt — zie de client-id-test hieronder — maar geen
  // enkele tokenaanvraag is met een Copilot-scope verbreed.
  const connector = readFileSync(
    resolve(import.meta.dirname, "../..", "core/lib/microsoft-connector.ts"),
    "utf8",
  );
  assert.match(connector, /export async function sharepointAccessToken/);
  assert.match(connector, /return gedelegeerdToken\(ctx, "Sites\.Selected"\)/);
  assert.ok(!connector.includes("Sites.Read.All"), "de connector is verbreed met een Copilot-scope");
});

// ---------------------------------------------------------------------------
//  Kapotte percent-codering in een scope-URI
// ---------------------------------------------------------------------------

test("een kapot percent-gecodeerde scope-URI levert null, geen worp", () => {
  // `new URL()` accepteert deze vormen zonder klagen; pas decodeURIComponent
  // struikelt erover. Zou die URIError ontsnappen, dan crasht de poort op een
  // waarde die een aanvaller volledig in de hand heeft — en een crash is geen
  // fail-closed weigering, want de aanroeper weet niet meer waar hij staat.
  for (const kapot of [
    "https://graph.microsoft.com/%",
    "https://graph.microsoft.com/%E0%A4%A",
    "https://graph.microsoft.com/%ZZ",
    "https://graph.microsoft.com/Files.Read.All%",
    "https://graph.microsoft.com/%C3%28",
  ]) {
    assert.doesNotThrow(() => normaliseerScope(kapot), `${kapot} wierp een fout`);
    assert.equal(normaliseerScope(kapot), null, `${kapot} werd geaccepteerd`);
  }
});

test("een kapotte scope tussen geldige scopes maakt de set niet stuk", () => {
  // De aanvaller kan een extra scope meesturen. Die mag de beoordeling van de
  // andere twee niet afbreken; hij hoort simpelweg niet mee te tellen.
  const scopes = ["Files.Read.All", "https://graph.microsoft.com/%E0%A4%A", "Sites.Read.All"];
  assert.doesNotThrow(() => heeftBeideScopes(scopes));
  assert.equal(heeftBeideScopes(scopes), true);
  assert.deepEqual(ontbrekendeScopes(["https://graph.microsoft.com/%"]), [...COPILOT_VEREISTE_SCOPES]);
});

// ---------------------------------------------------------------------------
//  De koppelflow vult client_id werkelijk
// ---------------------------------------------------------------------------

test("de kluis roept de dertien-parametersignatuur aan en geeft client_id mee", () => {
  // Zonder deze regel raakt client_id nooit gevuld, blijft readiness eeuwig
  // `configuratie_ongeldig`, en breekt de contractmigratie de koppelflow zodra
  // zij de twaalf-parametervorm dropt.
  const root = resolve(import.meta.dirname, "../..");
  const vault = readFileSync(resolve(root, "core/lib/microsoft-vault.ts"), "utf8");
  assert.match(vault, /bewaar_koppeling\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12,\$13\)/);
  assert.match(vault, /args\.client_id/);
  assert.ok(
    !/bewaar_koppeling\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12\)/.test(vault),
    "de kluis roept nog de oude twaalf-parametersignatuur aan",
  );

  const connector = readFileSync(resolve(root, "core/lib/microsoft-connector.ts"), "utf8");
  assert.match(connector, /client_id:\s*cfg\.clientId/);
});

// ---------------------------------------------------------------------------
//  De databasepoort levert de volledige conjunctie uit één momentopname
// ---------------------------------------------------------------------------

test("de leesfunctie belooft altijd één rij, mét fondsflag en blokkade", () => {
  // Het GEDRAG wordt in supabase/checks/2026_09_21_423_t4d_copilot_rollout.sql
  // op een echte database bewezen (FOUT 18 t/m 27). Deze test bewaakt alleen dat
  // de vorm niet stilletjes terugvalt naar de inner join, want dan levert een
  // fonds zonder verbinding nul rijen en is 'geen consent' niet te onderscheiden
  // van 'niet gelezen'.
  const migratie = readFileSync(
    resolve(import.meta.dirname, "../..", "supabase/migrations/2026_09_21_423a_t4d_copilot_rollout_expand.sql"),
    "utf8",
  );
  const fn = migratie.slice(
    migratie.indexOf("create function microsoft_private.copilot_lees_readiness"),
    migratie.indexOf("create or replace function microsoft_private.copilot_registreer_blokkade"),
  );
  assert.ok(fn.length > 0, "de leesfunctie is niet gevonden");
  for (const veld of ["globale_rollout_aan", "fondsflag_aan", "billing_geldig", "tijdelijk_geblokkeerd"]) {
    assert.ok(fn.includes(veld), `de leesfunctie levert ${veld} niet`);
  }
  assert.match(fn, /left join verbindingen v/);
  assert.ok(!/\bfrom verbindingen v\b/.test(fn), "de leesfunctie staat weer op een inner join");
});

const ROLLBACKMAP = resolve(import.meta.dirname, "../..", "supabase/rollbacks");
const ROLLBACKBASIS = "2026_09_21_423_t4d_copilot_fase";
/** De fasen in uitvoervolgorde. De cijfers maken die volgorde alfabetisch. */
const ROLLBACKFASEN = [
  "1_killswitch",
  "2_signatuur",
  "3_poorten",
  "4_kolommen",
] as const;

function rollbackBestand(fase: string): string {
  return readFileSync(resolve(ROLLBACKMAP, `${ROLLBACKBASIS}${fase}_ROLLBACK.sql`), "utf8");
}

/** Alleen de uitvoerbare regels; commentaar mag alles uitleggen. */
function zonderCommentaar(sql: string): string {
  return sql.split("\n").filter((regel) => !regel.trimStart().startsWith("--")).join("\n");
}

test("de rollback is per fase apart uitvoerbaar en weigert zonder voorwaarde", () => {
  // Eén plakbaar bestand met alle fasen achter elkaar is geen gefaseerde
  // rollback: tussen het herstellen van de DB-signatuur, het terugzetten van de
  // oude code en het droppen van de kolommen hoort een deploy te zitten. Het
  // GEDRAG (weigeren, doorlaten, terugbouwen) is op een wegwerp-DB bewezen;
  // deze test bewaakt dat de fasen niet stilletjes weer samensmelten.
  for (const [index, fase] of ROLLBACKFASEN.entries()) {
    const sql = zonderCommentaar(rollbackBestand(fase));
    const nummer = index + 1;
    assert.match(sql, new RegExp(`FASE ${nummer} geweigerd|FASE ${nummer} kan niet`), `fase ${fase} mist haar preflight`);
    assert.match(sql, new RegExp(`raise notice 'FASE ${nummer} geslaagd`), `fase ${fase} mist haar eindcontrole`);
    // Eén transactie: een mislukte eindcontrole laat niets half achter.
    assert.match(sql, /^begin;/m, `fase ${fase} draait niet in een transactie`);
    assert.match(sql, /^commit;/m, `fase ${fase} sluit haar transactie niet`);
  }

  // De oude vormen mogen niet terugkomen: één gecombineerd bestand, of de
  // letternamen waarvan de volgorde B → C → deploy onveilig was.
  for (const verouderd of [
    "2026_09_21_423_t4d_copilot_rollout_ROLLBACK.sql",
    "2026_09_21_423_t4d_copilot_faseB_poorten_ROLLBACK.sql",
    "2026_09_21_423_t4d_copilot_faseC_signatuur_ROLLBACK.sql",
  ]) {
    assert.ok(!existsSync(resolve(ROLLBACKMAP, verouderd)), `${verouderd} is terug`);
  }
});

test("de poorten verdwijnen pas ná de deploy van de oude code", () => {
  // `copilot_lees_readiness` is juist de functie waarmee de nieuwe code
  // vaststelt dat de kill switch uit staat. Haar eerder droppen laat elke
  // retrievalbeurt falen op een ontbrekend leespad in plaats van netjes inert
  // te zijn — een storing veroorzaakt door de rollback zelf.
  const poorten = zonderCommentaar(rollbackBestand("3_poorten"));
  assert.match(poorten, /drop function if exists microsoft_private\.copilot_lees_readiness/);
  assert.match(poorten, /t4d\.oude_code_gedeployd/, "fase 3 vraagt geen deploybevestiging");

  // Geen enkele eerdere fase mag het leespad al weghalen.
  for (const fase of ["1_killswitch", "2_signatuur"] as const) {
    const sql = zonderCommentaar(rollbackBestand(fase));
    assert.ok(
      !/drop (function|table)[^;]*copilot_(lees_readiness|rollout)/i.test(sql),
      `fase ${fase} haalt het leespad weg vóór de deploy`,
    );
  }
});

test("fase 2 herstelt de oude signatuur als uitgevoerde SQL en sluit de generator af", () => {
  // Een uitgecommentarieerd skelet zou betekenen dat na een volledige rollback
  // geen `bewaar_koppeling` meer bestaat — precies wanneer je hem nodig hebt.
  const twee = zonderCommentaar(rollbackBestand("2_signatuur"));
  assert.match(twee, /create or replace function microsoft_private\.copilot_rollback_herstel_bewaar_koppeling/);
  assert.match(twee, /create or replace function microsoft_private\.bewaar_koppeling/);
  assert.match(twee, /grant execute on function microsoft_private\.bewaar_koppeling\(uuid,uuid,text,text,text,text,text,text\[\],integer,text,text,text\) to microsoft_vault/);
  assert.match(twee, /select microsoft_private\.copilot_rollback_herstel_bewaar_koppeling\(\)/);

  // Bevinding H-18: een nieuwe functie krijgt standaard EXECUTE voor PUBLIC, en
  // op Supabase expliciet voor anon en authenticated. Dat geldt ook voor een
  // hulpfunctie in een rollback.
  assert.match(
    twee,
    /revoke all on function microsoft_private\.copilot_rollback_herstel_bewaar_koppeling\(\) from public, anon, authenticated, service_role/,
    "de generator houdt de standaard EXECUTE voor PUBLIC",
  );
  assert.match(twee, /kan de rollbackgenerator uitvoeren/, "geen eindcontrole op de rechten van de generator");

  // Fase 4 dropt de kolommen; de generator moet dáárna opnieuw draaien, anders
  // verwijst de herstelde body naar kolommen die niet meer bestaan.
  const vier = zonderCommentaar(rollbackBestand("4_kolommen"));
  const volgorde = [
    vier.indexOf("drop column if exists client_id"),
    vier.indexOf("select microsoft_private.copilot_rollback_herstel_bewaar_koppeling()"),
    vier.indexOf("drop function microsoft_private.copilot_rollback_herstel_bewaar_koppeling()"),
  ];
  assert.ok(volgorde.every((i) => i >= 0), "fase 4 mist het droppen of het hergenereren");
  assert.deepEqual([...volgorde].sort((a, b) => a - b), volgorde, "fase 4 hergenereert niet ná het droppen");
});

test("de rollbackbestanden zijn plakbaar in de Supabase SQL Editor", () => {
  // De operationele Preview-werkwijze gebruikt de SQL Editor, die geen
  // psql-metacommando's kent. Parameters gaan daarom via set_config met een
  // in te vullen placeholder, niet via \set en :'variabele'.
  for (const fase of ROLLBACKFASEN) {
    const sql = rollbackBestand(fase);
    const metacommando = sql.split("\n").find((regel) => /^\s*\\[a-z]/.test(regel));
    assert.equal(metacommando, undefined, `fase ${fase} bevat het psql-metacommando: ${metacommando}`);
    assert.ok(!/:'[a-z_]+'/.test(sql), `fase ${fase} gebruikt een psql-variabele`);
  }
});

test("elke rollbackfase controleert het auditslot echt, niet op tekst", () => {
  // CLAUDE.md stelt append-only audit als niet-onderhandelbaar. Een rollback is
  // geen vrijbrief om stilletjes te wissen wie de rem wanneer en waarom bediende.
  //
  // Deze test zoekt bewust NIET naar de naam `copilot_operator_log`: die komt ook
  // voor in een uitzonderingsclausule en in een succesmelding, en dan lijkt een
  // fase gecontroleerd terwijl zij niets toetst. Dat was precies de bevinding op
  // PR #425. Er moet een echte pg_class- én pg_trigger-controle staan,
  // schemagekwalificeerd, met `not tgisinternal` zodat een systeemtrigger (een
  // foreign key bijvoorbeeld) niet voor het append-only slot doorgaat.
  for (const fase of ROLLBACKFASEN) {
    const sql = zonderCommentaar(rollbackBestand(fase));

    assert.ok(
      !/drop table[^;]*copilot_operator_log/i.test(sql),
      `fase ${fase} dropt het auditspoor`,
    );

    const tabelcontrole = new RegExp(
      "from pg_class c join pg_namespace n on n\\.oid = c\\.relnamespace\\s+" +
      "where n\\.nspname = 'microsoft_private' and c\\.relname = 'copilot_operator_log'",
    );
    assert.match(sql, tabelcontrole, `fase ${fase} toetst het bestaan van de auditTABEL niet`);

    assert.match(
      sql,
      /from pg_trigger t[\s\S]{0,400}?c\.relname = 'copilot_operator_log'[\s\S]{0,200}?not t\.tgisinternal/,
      `fase ${fase} toetst de append-only TRIGGER niet`,
    );

    assert.match(
      sql,
      /raise exception 'FASE \d mislukt: de append-only trigger op copilot_operator_log ontbreekt/,
      `fase ${fase} faalt niet op een ontbrekend auditslot`,
    );
  }
});

test("de deploycontrole meet vanaf het waargenomen deploymoment", () => {
  // Een vast venster van een uur houdt een correcte rollback nog een uur tegen
  // om koppelingen die van vóór de deploy stammen — terecht geschreven door code
  // die toen nog draaide. Alleen writes ná dat moment zeggen iets.
  for (const fase of ["3_poorten", "4_kolommen"] as const) {
    const sql = zonderCommentaar(rollbackBestand(fase));
    assert.match(sql, /t4d\.deploy_moment/, `fase ${fase} vraagt geen deploymoment`);
    assert.match(sql, /gekoppeld_op > \$1/, `fase ${fase} meet niet vanaf het deploymoment`);
    assert.ok(
      !/interval '1 hour'/.test(sql),
      `fase ${fase} gebruikt nog het vaste uurvenster`,
    );
    // Een moment in de toekomst meet een leeg venster en stelt dus niets vast.
    assert.match(sql, /ligt in de toekomst/, `fase ${fase} accepteert een deploymoment in de toekomst`);
    // De handmatige bevestiging blijft daarnaast staan.
    assert.match(sql, /t4d\.oude_code_gedeployd/, `fase ${fase} vraagt geen deploybevestiging`);
  }
});

test("het runbook blokkeert activering tot #428 is ingericht", () => {
  // De eerste structurele demoactivering verhuist naar app365; het PGB-profiel
  // mag geen vervanger zijn. De CODE blijft fondsneutraal — deze blokkade is
  // operationeel en hoort in het runbook, niet in een `if` in de poort.
  const runbook = readFileSync(
    resolve(import.meta.dirname, "../..", "security/COPILOT-T4D-RUNBOOK.md"),
    "utf8",
  );
  const activatie = runbook.slice(runbook.indexOf("## 2. Activatie"), runbook.indexOf("## 3."));
  assert.ok(activatie.length > 0, "de activatieparagraaf is niet gevonden");
  assert.match(activatie, /GEBLOKKEERD/, "activering is niet als geblokkeerd gemarkeerd");
  assert.match(activatie, /#428/, "het runbook noemt #428 niet");
  assert.match(activatie, /app365_m365_demo_copilot/, "het toekomstige profiel wordt niet benoemd");
  assert.match(activatie, /PGB-profiel mag hiervoor niet als vervanger/, "het PGB-profiel wordt niet uitgesloten");

  // En de code blijft er buiten: geen fondsnaam in de poort.
  for (const bestand of [
    "core/lib/microsoft-retrieval/rollout-core.ts",
    "core/lib/microsoft-retrieval/copilot-tokenbron.ts",
  ]) {
    const inhoud = readFileSync(resolve(import.meta.dirname, "../..", bestand), "utf8");
    assert.ok(!/\bPGB\b|app365/.test(inhoud), `${bestand} noemt een specifiek fonds of profiel`);
  }
});
