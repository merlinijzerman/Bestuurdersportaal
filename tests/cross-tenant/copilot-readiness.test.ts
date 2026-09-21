// ============================================================================
//  #423 T4-D — readinesspoort, scopenormalisatie en de vaste toelatingsvolgorde.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk, geen database, geen Microsoft-permission, geen
//  live Retrieval-call. Elke tokenbron in dit bestand is een tellende stub.
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("de bestaande connectorfuncties zijn niet gewijzigd", () => {
  // T4-D bouwt een eigen bron; sharepointAccessToken blijft van SharePoint.
  const connector = readFileSync(
    resolve(import.meta.dirname, "../..", "core/lib/microsoft-connector.ts"),
    "utf8",
  );
  assert.match(connector, /export async function sharepointAccessToken/);
  assert.match(connector, /return gedelegeerdToken\(ctx, "Sites\.Selected"\)/);
  assert.ok(!connector.includes("Sites.Read.All"), "de connector is verbreed met een Copilot-scope");
});
