// ============================================================================
//  #407 labsmoke — hermetische tests op de VOLGORDE.
// ----------------------------------------------------------------------------
//  De eerdere suites toetsten de onderdelen: de poort rekent goed, de client
//  doet één poging, het rapport lekt niets. Wat ze niet toetsten, is of de
//  runner die onderdelen in de juiste volgorde aan elkaar knoopt — en juist
//  daar zit de belofte die er het meest toe doet: dat `--dry-run` bij een OPEN
//  poort nul Retrieval-pogingen doet en niemand om akkoord vraagt.
//
//  Elke test hieronder bouwt de lastigste stand op: scans die wél treffers
//  geven, dus een poort die openstaat. Dat is de enige stand waarin de dry-run-
//  grendel iets te betekenen heeft.
// ============================================================================
import assert from "node:assert/strict";
import test from "node:test";
import type { Aanmelding } from "./auth";
import { maakLeesClient } from "./graph";
import { EXIT, voerSmokeUit, type SmokeAfhankelijkheden } from "./orkestratie";
import type { Labprofiel } from "./registry";

const HOST = "bestuurdersportaaltest.sharepoint.com";
const SITE = `https://${HOST}/sites/PGBRetrievalLab`;
const ROOT_PAD = "/sites/PGBRetrievalLab/Shared Documents";
const ROOT = `https://${HOST}${ROOT_PAD}`;
const TENANT = "77358864-32ba-454f-9e48-cf3356d115dd";
const ACTOR_OID = "076ce16f-74a2-4cc7-874b-7761e7747708";
const ACTOR_UPN = "pgb-test@Bestuurdersportaaltest.onmicrosoft.com";
const CLIENT_ID = "a23cc4ca-c0b3-4d32-b69e-06e4c894da7d";
const FIXTUREBESTAND = "PGB407-DOC-101-Zandloperbaken-hersteldossier.docx";
const FIXTURE_URL = `https://${HOST}${encodeURI(ROOT_PAD)}/02%20Beleid/${FIXTUREBESTAND}`;

const PROFIEL: Labprofiel = Object.freeze({
  profielId: "pgb_m365_lab_copilot",
  tenantId: TENANT,
  tenantDomein: "Bestuurdersportaaltest.onmicrosoft.com",
  actorUpn: ACTOR_UPN,
  actorObjectId: ACTOR_OID,
  clientId: CLIENT_ID,
  redirectUris: ["http://localhost"],
  delegatedPermissions: ["User.Read", "Files.Read.All", "Sites.Read.All"],
  siteUrl: SITE,
  siteHostnaam: HOST,
  siteRelatiefPad: "/sites/PGBRetrievalLab",
  rootUrl: ROOT,
  indexStatus: "reindex_requested_zero_results",
  indexGecontroleerdOp: "2026-09-20",
});

const AANMELDING: Aanmelding = {
  accessToken: "test-token",
  toegekendeScopes: ["Files.Read.All", "Sites.Read.All"],
  claims: {
    tid: TENANT,
    oid: ACTOR_OID,
    aud: CLIENT_ID,
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    preferred_username: ACTOR_UPN,
  },
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/**
 * Een labtenant waarin ALLES klopt en beide scans een treffer geven: de stand
 * waarin de poort openstaat. `inhoudTreffers` kan op 0 om de poort te sluiten.
 */
function graphStub(opties: { inhoudTreffers?: number; bestandAanwezig?: boolean } = {}) {
  const bezocht: string[] = [];
  const impl = (async (invoer: any) => {
    const url = String(invoer);
    bezocht.push(url);
    if (url.includes("/me?")) return json({ id: ACTOR_OID, userPrincipalName: ACTOR_UPN });
    if (url.includes(`/sites/${HOST}:`)) return json({ id: "site-1", webUrl: SITE });
    if (url.includes("/drive?")) return json({ id: "drive-1", webUrl: `https://${HOST}${encodeURI(ROOT_PAD)}` });
    if (url.includes("/drives/drive-1/root?")) {
      return json({ id: "root-0", webUrl: `https://${HOST}${encodeURI(ROOT_PAD)}`, folder: { childCount: 2 } });
    }
    if (url.includes("/search(")) {
      const aantal = opties.inhoudTreffers ?? 1;
      return json({
        value: Array.from({ length: aantal }, (_, i) => ({
          id: `hit-${i}`,
          name: FIXTUREBESTAND,
          webUrl: FIXTURE_URL,
        })),
      });
    }
    if (url.includes("/children")) {
      const aanwezig = opties.bestandAanwezig ?? true;
      return json({
        value: aanwezig ? [{ id: "f-1", name: FIXTUREBESTAND, file: {}, webUrl: FIXTURE_URL }] : [],
      });
    }
    throw new Error(`onverwachte Graph-call in de stub: ${url}`);
  }) as unknown as typeof fetch;
  return { bezocht, impl };
}

interface Spionnen {
  retrievalPogingen: string[];
  akkoordGevraagd: number;
}

function bouw(
  overschrijf: Partial<SmokeAfhankelijkheden> & { graph?: ReturnType<typeof graphStub> } = {},
): { deps: SmokeAfhankelijkheden; spionnen: Spionnen; graph: ReturnType<typeof graphStub> } {
  const graph = overschrijf.graph ?? graphStub();
  const spionnen: Spionnen = { retrievalPogingen: [], akkoordGevraagd: 0 };
  const deps: SmokeAfhankelijkheden = {
    profiel: PROFIEL,
    aanmelden: async () => AANMELDING,
    maakClient: (accessToken) =>
      maakLeesClient({
        accessToken,
        callBudget: 40,
        signal: new AbortController().signal,
        fetchImpl: graph.impl,
      }),
    vraagAkkoord: async () => {
      spionnen.akkoordGevraagd++;
      return false;
    },
    retrievalFetch: (async (invoer: any) => {
      spionnen.retrievalPogingen.push(String(invoer));
      return json({ retrievalHits: [{ webUrl: FIXTURE_URL, extracts: [{ text: "een fragment" }] }] });
    }) as unknown as typeof fetch,
    signal: new AbortController().signal,
    dryRun: false,
    meld: () => {},
    nu: () => new Date("2026-09-20T12:00:00.000Z"),
    ...overschrijf,
  };
  return { deps, spionnen, graph };
}

// ---------------------------------------------------------------------------
//  De dry-run-grendel — bij een OPEN poort
// ---------------------------------------------------------------------------

test("--dry-run doet bij een OPEN poort nul Retrieval-pogingen en vraagt geen akkoord", async () => {
  const { deps, spionnen } = bouw({ dryRun: true });
  const { rapport, exitcode } = await voerSmokeUit(deps);

  // Eerst vaststellen dat de poort écht openstond; anders bewijst de rest niets.
  assert.equal(rapport.poort.doorgelaten, true, "de opzet leverde geen open poort op");

  assert.deepEqual(spionnen.retrievalPogingen, [], "een dry-run raakte de Retrieval API");
  assert.equal(spionnen.akkoordGevraagd, 0, "een dry-run vroeg om akkoord");
  assert.equal(rapport.retrieval, null);
  assert.equal(rapport.akkoordGevraagd, false);
  assert.equal(rapport.akkoordGegeven, false);
  assert.equal(rapport.eindstand, "gestopt_op_akkoord");
  assert.equal(exitcode, EXIT.klaar);
});

test("zonder --dry-run wordt bij een open poort wél akkoord gevraagd, en 'nee' stopt de run", async () => {
  const { deps, spionnen } = bouw();
  const { rapport, exitcode } = await voerSmokeUit(deps);
  assert.equal(rapport.poort.doorgelaten, true);
  assert.equal(spionnen.akkoordGevraagd, 1);
  assert.deepEqual(spionnen.retrievalPogingen, [], "zonder akkoord vertrok er tóch een call");
  assert.equal(rapport.akkoordGevraagd, true);
  assert.equal(rapport.akkoordGegeven, false);
  assert.equal(rapport.eindstand, "gestopt_op_akkoord");
  assert.equal(exitcode, EXIT.geenAkkoord);
});

test("met akkoord vertrekt er precies één Retrieval-poging naar het vastgepinde endpoint", async () => {
  const { deps, spionnen } = bouw({ vraagAkkoord: async () => true });
  const { rapport, exitcode } = await voerSmokeUit(deps);
  assert.deepEqual(spionnen.retrievalPogingen, ["https://graph.microsoft.com/v1.0/copilot/retrieval"]);
  assert.equal(rapport.retrieval?.netwerkpogingen, 1);
  assert.equal(rapport.retrieval?.uitslag.verwachteFixtureGevonden, true);
  assert.equal(rapport.eindstand, "gemeten");
  assert.equal(exitcode, EXIT.klaar);
});

// ---------------------------------------------------------------------------
//  De twee fail-closed stops
// ---------------------------------------------------------------------------

test("een dichte poort vraagt geen akkoord en doet geen call", async () => {
  const { deps, spionnen } = bouw({ graph: graphStub({ inhoudTreffers: 0 }) });
  const { rapport, exitcode } = await voerSmokeUit(deps);
  assert.deepEqual(rapport.poort, { doorgelaten: false, code: "inhoud_niet_geindexeerd" });
  assert.equal(spionnen.akkoordGevraagd, 0);
  assert.deepEqual(spionnen.retrievalPogingen, []);
  assert.equal(exitcode, EXIT.poort);
});

test("een ontbrekend bestand levert de ANDERE poortcode — wachten versus uploaden", async () => {
  const { deps } = bouw({ graph: graphStub({ bestandAanwezig: false }) });
  const { rapport } = await voerSmokeUit(deps);
  assert.deepEqual(rapport.poort, { doorgelaten: false, code: "bestand_niet_aanwezig" });
});

test("drift stopt de run vóór de scans, en vóór het opzoeken van de bronroot", async () => {
  const graph = graphStub();
  const { deps, spionnen } = bouw({
    graph,
    aanmelden: async () => ({
      ...AANMELDING,
      claims: { ...AANMELDING.claims, tid: "e4ff0e8d-5b92-4695-9f58-2f97200199f9" },
    }),
  });
  const { rapport, exitcode } = await voerSmokeUit(deps);

  assert.equal(rapport.eindstand, "gestopt_op_drift");
  assert.ok(rapport.drift.some((bevinding) => bevinding.soort === "tenant"));
  assert.deepEqual(rapport.scans, []);
  assert.equal(spionnen.akkoordGevraagd, 0);
  assert.deepEqual(spionnen.retrievalPogingen, []);
  assert.equal(exitcode, EXIT.drift);

  // Er zijn precies drie lezingen gedaan: /me, de site en de bibliotheek. Het
  // root-item, de inhoudscan en de bestandsnaamscan zijn er niet meer geweest.
  assert.equal(graph.bezocht.length, 3);
  assert.ok(!graph.bezocht.some((url) => url.includes("/search(") || url.includes("/children")));
});

// ---------------------------------------------------------------------------
//  De volgorde zelf
// ---------------------------------------------------------------------------

test("beide scans beginnen bij het geregistreerde root-item en nooit bij de drive-root", async () => {
  const { deps, graph } = bouw({ dryRun: true });
  await voerSmokeUit(deps);
  const scans = graph.bezocht.filter((url) => url.includes("/search(") || url.includes("/children"));
  assert.equal(scans.length, 2);
  for (const url of scans) {
    assert.ok(url.includes("/items/root-0/"), `scan begon niet bij het root-item: ${url}`);
  }
});

test("de volgorde ligt vast: actor, site, bibliotheek, root-item, dan pas de scans", async () => {
  const { deps, graph } = bouw({ dryRun: true });
  await voerSmokeUit(deps);
  const stappen = graph.bezocht.map((url) => {
    if (url.includes("/me?")) return "actor";
    if (url.includes(`/sites/${HOST}:`)) return "site";
    if (url.includes("/drive?")) return "bibliotheek";
    if (url.includes("/root?")) return "root-item";
    if (url.includes("/search(")) return "inhoudscan";
    return "naamscan";
  });
  assert.deepEqual(stappen, ["actor", "site", "bibliotheek", "root-item", "inhoudscan", "naamscan"]);
});
