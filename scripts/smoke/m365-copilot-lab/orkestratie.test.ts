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
import { rapporteer } from "./rapport";

const HOST = "bestuurdersportaaltest.sharepoint.com";
const SITE = `https://${HOST}/sites/PGBRetrievalLab`;
const ROOT_PAD = "/sites/PGBRetrievalLab/Shared Documents";
const ROOT = `https://${HOST}${ROOT_PAD}`;
const ROOT_GRAPH_PAD = "/drives/drive-1/root:";
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
interface StubOpties {
  inhoudTreffers?: number;
  bestandAanwezig?: boolean;
  /**
   * Bootst de LIVE stand van 21-09 na: het zoekresultaat draagt wel een
   * drive-id maar geen `path`, zodat de runner het item vers moet herlezen.
   */
  zoekresultaatZonderPad?: boolean;
  /** Wat de verse DriveItem-lezing teruggeeft; standaard een geldige bevestiging. */
  verseLezing?: (id: string) => Response;
}

function graphStub(opties: StubOpties = {}) {
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
          parentReference: opties.zoekresultaatZonderPad
            ? { driveId: "drive-1" }
            : { driveId: "drive-1", path: `${ROOT_GRAPH_PAD}/02 Beleid` },
        })),
      });
    }
    if (url.includes("/children")) {
      const aanwezig = opties.bestandAanwezig ?? true;
      return json({
        value: aanwezig
          ? [{ id: "f-1", name: FIXTUREBESTAND, file: {}, webUrl: FIXTURE_URL, parentReference: { driveId: "drive-1", path: `${ROOT_GRAPH_PAD}/02 Beleid` } }]
          : [],
      });
    }
    // De verse DriveItem-lezing: /drives/drive-1/items/{id}?$select=…
    const versMatch = /\/drives\/drive-1\/items\/([^/?]+)\?/.exec(url);
    if (versMatch) {
      if (opties.verseLezing) return opties.verseLezing(versMatch[1]);
      return json({
        id: versMatch[1],
        name: FIXTUREBESTAND,
        webUrl: FIXTURE_URL,
        parentReference: { driveId: "drive-1", path: `${ROOT_GRAPH_PAD}/02 Beleid` },
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
  assert.deepEqual(rapport.poort, { doorgelaten: false, code: "geen_zoekresultaat" });
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

// ---------------------------------------------------------------------------
//  De verse herlezing binnen de volledige volgorde (#419-vervolg)
// ---------------------------------------------------------------------------

test("een zoekresultaat zonder ouderpad wordt vers herlezen en opent dan de poort", async () => {
  // De live stand van 21-09: één treffer, geen `parentReference.path`.
  const { deps, graph } = bouw({ dryRun: true, graph: graphStub({ zoekresultaatZonderPad: true }) });
  const { rapport } = await voerSmokeUit(deps);

  const inhoudscan = rapport.scans.find((scan) => scan.naam === "inhoudscan")!;
  assert.equal(inhoudscan.treffers, 1);
  assert.equal(inhoudscan.binnenRoot, 1, "de verse herlezing bevestigde de treffer niet");
  assert.equal(inhoudscan.verseHerlezingen, 1);
  assert.equal(rapport.poort.doorgelaten, true);
  assert.equal(graph.bezocht.filter((url) => /\/items\/hit-0\?/.test(url)).length, 1, "niet exact één herlezing");
});

test("--dry-run doet ook via de verse-herlezingsweg nul Retrieval-pogingen en vraagt geen akkoord", async () => {
  // De poort gaat hier open dankzij een herlezing; juist dan moet de grendel
  // nog steeds sluiten.
  const { deps, spionnen } = bouw({ dryRun: true, graph: graphStub({ zoekresultaatZonderPad: true }) });
  const { rapport, exitcode } = await voerSmokeUit(deps);
  assert.equal(rapport.poort.doorgelaten, true, "de opzet leverde geen open poort op");
  assert.deepEqual(spionnen.retrievalPogingen, []);
  assert.equal(spionnen.akkoordGevraagd, 0);
  assert.equal(rapport.retrieval, null);
  assert.equal(exitcode, EXIT.klaar);
});

test("een treffer die na herlezing niet te plaatsen is, heet 'niet verifieerbaar' en stopt de run", async () => {
  const { deps, spionnen } = bouw({
    graph: graphStub({
      zoekresultaatZonderPad: true,
      // Graph blijft het ouderpad schuldig.
      verseLezing: (id) =>
        new Response(JSON.stringify({ id, webUrl: FIXTURE_URL, parentReference: { driveId: "drive-1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    }),
  });
  const { rapport, exitcode } = await voerSmokeUit(deps);
  assert.deepEqual(rapport.poort, { doorgelaten: false, code: "zoekresultaat_niet_verifieerbaar" });
  const inhoudscan = rapport.scans.find((scan) => scan.naam === "inhoudscan")!;
  assert.equal(inhoudscan.nietVerifieerbaar, 1);
  assert.deepEqual(inhoudscan.redenen, { geen_parentref_na_herlezing: 1 });
  assert.equal(spionnen.akkoordGevraagd, 0);
  assert.deepEqual(spionnen.retrievalPogingen, []);
  assert.equal(exitcode, EXIT.poort);
});

test("een treffer die aantoonbaar elders ligt, krijgt de buiten-root-code", async () => {
  // De bronroot is hier de héle bibliotheek, dus "buiten de root" kan alleen
  // een ANDERE drive zijn — een submap blijft per definitie binnen.
  const { deps, spionnen } = bouw({
    graph: graphStub({
      zoekresultaatZonderPad: true,
      verseLezing: (id) =>
        new Response(
          JSON.stringify({ id, parentReference: { driveId: "drive-2", path: "/drives/drive-2/root:/Elders" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    }),
  });
  const { rapport } = await voerSmokeUit(deps);
  assert.deepEqual(rapport.poort, { doorgelaten: false, code: "zoekresultaat_buiten_root" });
  assert.deepEqual(
    rapport.scans.find((scan) => scan.naam === "inhoudscan")!.redenen,
    { andere_drive: 1 },
  );
  assert.deepEqual(spionnen.retrievalPogingen, []);
});

test("een 403 op de herlezing stopt de run zonder akkoordvraag en zonder Retrieval-call", async () => {
  const { deps, spionnen } = bouw({
    graph: graphStub({
      zoekresultaatZonderPad: true,
      verseLezing: () => new Response("{}", { status: 403 }),
    }),
  });
  const { rapport, exitcode } = await voerSmokeUit(deps);
  assert.deepEqual(rapport.poort, { doorgelaten: false, code: "zoekresultaat_niet_verifieerbaar" });
  assert.deepEqual(
    rapport.scans.find((scan) => scan.naam === "inhoudscan")!.redenen,
    { herlezing_geweigerd: 1 },
  );
  assert.equal(spionnen.akkoordGevraagd, 0);
  assert.deepEqual(spionnen.retrievalPogingen, []);
  assert.equal(exitcode, EXIT.poort);
});

test("het rapport draagt de uitsplitsing als codes en tellingen, zonder pad of naam", async () => {
  const { deps } = bouw({
    dryRun: true,
    graph: graphStub({
      zoekresultaatZonderPad: true,
      verseLezing: (id) =>
        new Response(
          JSON.stringify({
            id,
            name: FIXTUREBESTAND,
            webUrl: FIXTURE_URL,
            parentReference: { driveId: "drive-2", path: "/drives/drive-2/root:/Elders" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    }),
  });
  const { rapport } = await voerSmokeUit(deps);
  const tekst = rapporteer(rapport);
  assert.match(tekst, /niet verifieerbaar/);
  assert.match(tekst, /`andere_drive` ×1/);
  assert.ok(!tekst.includes("https://"), "een URL lekte in het rapport");
  assert.ok(!tekst.includes(".docx"), "een bestandsnaam lekte in het rapport");
  assert.ok(!tekst.includes("Elders"), "een pad lekte in het rapport");
});

// ---------------------------------------------------------------------------
//  De afgewezen call levert óók bewijs (retry-voorbereiding)
// ---------------------------------------------------------------------------
//  Dit is het gat dat de labstand van 21-09 blootlegde: er was een
//  Retrieval-call gedaan die fail-closed eindigde, en er stond nergens een
//  rapport. Het ene toegestane verzoek was verbruikt zonder spoor.

/** Een Retrieval-fetch die met een vaste HTTP-status antwoordt. */
function afwijzendeRetrieval(status: number, teller: { n: number }) {
  return (async () => {
    teller.n++;
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
}

test("een 403 op de Retrieval-call levert een rapport in plaats van een gesneuvelde run", async () => {
  const teller = { n: 0 };
  const { deps } = bouw({
    vraagAkkoord: async () => true,
    retrievalFetch: afwijzendeRetrieval(403, teller),
  });
  const { rapport, exitcode } = await voerSmokeUit(deps);

  assert.equal(rapport.eindstand, "retrieval_afgewezen");
  assert.equal(rapport.retrieval, null);
  assert.deepEqual(rapport.retrievalFout, {
    code: "copilot_toegang_geweigerd",
    categorie: "toestemming_geweigerd",
    httpStatus: 403,
  });
  // Het verzoek is verbruikt; dat moet het rapport kunnen zeggen.
  assert.equal(rapport.retrievalPogingen, 1);
  assert.equal(teller.n, 1);
  assert.equal(exitcode, EXIT.retrievalAfgewezen);
  assert.equal(rapport.akkoordGegeven, true);
});

test("een 402 wordt als billing gerapporteerd, niet als autorisatieweigering", async () => {
  const teller = { n: 0 };
  const { deps } = bouw({ vraagAkkoord: async () => true, retrievalFetch: afwijzendeRetrieval(402, teller) });
  const { rapport } = await voerSmokeUit(deps);
  assert.equal(rapport.retrievalFout?.code, "copilot_billing");
  assert.equal(rapport.retrievalFout?.categorie, "configuratiefout");
});

test("het rapport van een afwijzing noemt de verbruikte poging en geen fixturecode", async () => {
  const teller = { n: 0 };
  const { deps } = bouw({ vraagAkkoord: async () => true, retrievalFetch: afwijzendeRetrieval(403, teller) });
  const { rapport } = await voerSmokeUit(deps);
  const tekst = rapporteer(rapport);

  assert.match(tekst, /Retrieval API-netwerkpogingen: 1/);
  assert.match(tekst, /`copilot_toegang_geweigerd`/);
  assert.match(tekst, /Eindstand: `retrieval_afgewezen`/);
  // Geen kandidaat beoordeeld, dus ook geen fixture-uitspraak.
  assert.ok(!tekst.includes("verwachte fixture gevonden"), "een afwijzing doet een fixture-uitspraak");
  assert.ok(!tekst.includes("https://"), "een URL lekte in het rapport");
});

test("een afbreking VÓÓR het vertrek stopt de run en levert geen rapport", async () => {
  // Ctrl-C bij de akkoordvraag: er is niets verzonden, dus er is geen quotum
  // verbruikt en niets vast te leggen.
  const afbreker = new AbortController();
  const teller = { n: 0 };
  const { deps } = bouw({
    signal: afbreker.signal,
    vraagAkkoord: async () => {
      afbreker.abort();
      return true;
    },
    retrievalFetch: (async () => {
      teller.n++;
      return json({ retrievalHits: [] });
    }) as unknown as typeof fetch,
  });
  await assert.rejects(() => voerSmokeUit(deps));
  assert.equal(teller.n, 0, "er is tóch een verzoek verzonden");
});

test("een afbreking NÁ het vertrek levert een eigen eindstand met de verbruikte poging", async () => {
  // Dit is het gat: het verzoek is de deur uit, de beurt stopt, en zonder deze
  // tak legde de runner niets vast terwijl het quotum wél op kan zijn.
  const afbreker = new AbortController();
  const { deps } = bouw({
    vraagAkkoord: async () => true,
    signal: afbreker.signal,
    retrievalFetch: (async () => {
      afbreker.abort();
      const fout = new Error("afgebroken");
      fout.name = "AbortError";
      throw fout;
    }) as unknown as typeof fetch,
  });
  const { rapport, exitcode } = await voerSmokeUit(deps);

  assert.equal(rapport.eindstand, "retrieval_afgebroken");
  assert.equal(rapport.retrievalAfbreking, "annulering");
  assert.equal(rapport.retrievalPogingen, 1);
  assert.equal(rapport.retrieval, null);
  // NIET als afwijzing geboekt: de provider heeft niets geweigerd.
  assert.equal(rapport.retrievalFout, undefined);
  assert.equal(exitcode, EXIT.retrievalAfgebroken);
});

test("een verlopen deadline ná het vertrek heet 'timeout', niet 'annulering'", async () => {
  const afbreker = new AbortController();
  const { deps } = bouw({
    vraagAkkoord: async () => true,
    signal: afbreker.signal,
    retrievalFetch: (async () => {
      const fout = new Error("te traag");
      fout.name = "TimeoutError";
      throw fout;
    }) as unknown as typeof fetch,
  });
  const { rapport, exitcode } = await voerSmokeUit(deps);
  assert.equal(rapport.eindstand, "retrieval_afgebroken");
  assert.equal(rapport.retrievalAfbreking, "timeout");
  assert.equal(rapport.retrievalPogingen, 1);
  assert.equal(exitcode, EXIT.retrievalAfgebroken);
});

test("het rapport van een afbreking is inhoudsvrij en noemt het verbruikte verzoek", async () => {
  const afbreker = new AbortController();
  const { deps } = bouw({
    vraagAkkoord: async () => true,
    signal: afbreker.signal,
    retrievalFetch: (async () => {
      afbreker.abort();
      const fout = new Error("afgebroken bij netorgft20476383.sharepoint.com/geheim.docx");
      fout.name = "AbortError";
      throw fout;
    }) as unknown as typeof fetch,
  });
  const tekst = rapporteer((await voerSmokeUit(deps)).rapport);
  assert.match(tekst, /Retrieval API-netwerkpogingen: 1/);
  assert.match(tekst, /afgebroken.*`annulering`/);
  assert.match(tekst, /Eindstand: `retrieval_afgebroken`/);
  // De boodschap van de onderliggende fout mag nergens doorlekken.
  assert.ok(!tekst.includes("geheim"), "een foutboodschap lekte in het rapport");
  assert.ok(!tekst.includes(".docx"), "een bestandsnaam lekte in het rapport");
  // Let op: het rapport noemt de GEREGISTREERDE host met opzet — dat is
  // registry-metadata. Wat er niet in mag, is de host uit de foutboodschap.
  assert.ok(!tekst.includes("netorgft20476383"), "een host uit de foutboodschap lekte in het rapport");
});

test("gegarandeerd nul tweede pogingen — ook bij een herhaalbare status", async () => {
  // 429 en 5xx zijn op zichzelf herhaalbaar; het budget van 1 verbiedt de
  // herhaling, en de grendel in `meet()` maakt het een feit.
  for (const status of [429, 500, 503]) {
    const teller = { n: 0 };
    const { deps } = bouw({ vraagAkkoord: async () => true, retrievalFetch: afwijzendeRetrieval(status, teller) });
    const { rapport } = await voerSmokeUit(deps);
    assert.equal(teller.n, 1, `status ${status}: er is meer dan één verzoek verzonden`);
    assert.equal(rapport.retrievalPogingen, 1, `status ${status}`);
    assert.equal(rapport.eindstand, "retrieval_afgewezen", `status ${status}`);
  }
});

test("429 levert exact één poging en de rate-limitcode, zonder retry", async () => {
  const teller = { n: 0 };
  const { deps } = bouw({ vraagAkkoord: async () => true, retrievalFetch: afwijzendeRetrieval(429, teller) });
  const { rapport, exitcode } = await voerSmokeUit(deps);
  assert.equal(teller.n, 1);
  assert.equal(rapport.retrievalFout?.code, "copilot_rate_limit");
  assert.equal(rapport.retrievalFout?.categorie, "rate_limit");
  assert.equal(rapport.retrievalFout?.httpStatus, 429);
  assert.equal(rapport.retrievalPogingen, 1);
  assert.equal(exitcode, EXIT.retrievalAfgewezen);
});

test("een geslaagde meting noemt nu ook de feitelijke poging", async () => {
  const { deps } = bouw({ vraagAkkoord: async () => true });
  const { rapport, exitcode } = await voerSmokeUit(deps);
  assert.equal(rapport.eindstand, "gemeten");
  assert.equal(rapport.retrievalPogingen, 1);
  assert.equal(rapport.retrievalFout, undefined);
  assert.equal(exitcode, EXIT.klaar);
});

test("--dry-run raakt de tellende fetch niet en levert geen afwijzingsrapport", async () => {
  const teller = { n: 0 };
  const { deps, spionnen } = bouw({ dryRun: true, retrievalFetch: afwijzendeRetrieval(403, teller) });
  const { rapport } = await voerSmokeUit(deps);
  assert.equal(teller.n, 0);
  assert.equal(rapport.retrievalFout, undefined);
  assert.equal(rapport.retrievalPogingen, undefined);
  assert.equal(spionnen.akkoordGevraagd, 0);
});
