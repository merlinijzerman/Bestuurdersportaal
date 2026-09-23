// ============================================================================
//  #407 labsmoke — hermetische tests op de beslislogica.
// ----------------------------------------------------------------------------
//  Geen enkele test hier raakt het netwerk. `meet()` krijgt een `fetchImpl`
//  mee, dus de zes negatieve gevallen uit de opdracht — verkeerde tenant,
//  verkeerde actor, resultaat buiten de bronroot, redirect, te grote respons en
//  een tweede netwerkpoging — worden hier als FEIT vastgelegd en niet als
//  vertrouwen in de configuratie.
// ============================================================================
import assert from "node:assert/strict";
import test from "node:test";
import type { CopilotFout } from "../../../core/lib/microsoft-retrieval/fouten";
import type { Aanmelding } from "./auth";
import type { GraphActor, GraphBron } from "./graph";
import type { Labprofiel } from "./registry";
import { rapporteer, type Smokerapport } from "./rapport";
import {
  RETRIEVAL_REQUESTBUDGET,
  SCENARIO,
  EXACTE_CANARY_SCENARIO,
  INHOUDSCAN_TERM,
  StopFail,
  VERWACHTE_FIXTURE,
  beoordeelPoort,
  categoriseer,
  eenmaligeFetch,
  fixturecodeUitUrl,
  meet,
  toetsDrift,
} from "./smoke";

const HOST = "bestuurdersportaaltest.sharepoint.com";
const SITE = `https://${HOST}/sites/PGBRetrievalLab`;
const ROOT = `${SITE}/Shared Documents`;
const TENANT = "77358864-32ba-454f-9e48-cf3356d115dd";
const ACTOR_OID = "076ce16f-74a2-4cc7-874b-7761e7747708";
const ACTOR_UPN = "pgb-test@Bestuurdersportaaltest.onmicrosoft.com";
const CLIENT_ID = "a23cc4ca-c0b3-4d32-b69e-06e4c894da7d";

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

function aanmelding(overschrijf: Partial<Aanmelding["claims"]> = {}): Aanmelding {
  return {
    accessToken: "test-token-nooit-echt",
    toegekendeScopes: ["Files.Read.All", "Sites.Read.All"],
    claims: {
      tid: TENANT,
      oid: ACTOR_OID,
      aud: CLIENT_ID,
      iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      preferred_username: ACTOR_UPN,
      ...overschrijf,
    },
  };
}

const ACTOR: GraphActor = { id: ACTOR_OID, userPrincipalName: ACTOR_UPN };
const BRON: GraphBron = {
  siteId: "site-id",
  siteWebUrl: SITE,
  driveId: "drive-id",
  driveWebUrl: `https://${HOST}/sites/PGBRetrievalLab/Shared%20Documents`,
};

function fixtureUrl(code: string, staart = "Zandloperbaken-hersteldossier.docx"): string {
  return `https://${HOST}/sites/PGBRetrievalLab/Shared%20Documents/bibliotheek/02%20Beleid%20en%20reglementen/${code}-${staart}`;
}

function jsonRespons(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function meetMet(fetchImpl: typeof fetch, modus?: "sem01" | "exacte_canary") {
  return meet(PROFIEL, { accessToken: "test-token", signal: new AbortController().signal, fetchImpl, modus });
}

// ---------------------------------------------------------------------------
//  Negatief 1 en 2 — verkeerde tenant, verkeerde actor
// ---------------------------------------------------------------------------

test("geen drift op de geregistreerde tenant, actor, app en root", () => {
  assert.deepEqual(toetsDrift(PROFIEL, aanmelding(), ACTOR, BRON), []);
});

test("negatief — een id-token uit een andere tenant is tenantdrift", () => {
  const drift = toetsDrift(PROFIEL, aanmelding({ tid: "e4ff0e8d-5b92-4695-9f58-2f97200199f9" }), ACTOR, BRON);
  assert.ok(drift.some((bevinding) => bevinding.soort === "tenant" && bevinding.code === "idtoken_tenant_wijkt_af"));
});

test("negatief — een andere aangemelde gebruiker is actordrift, gezien vanuit twee bronnen", () => {
  const andereOid = "11111111-2222-3333-4444-555555555555";
  const drift = toetsDrift(
    PROFIEL,
    aanmelding({ oid: andereOid, preferred_username: "iemand-anders@Bestuurdersportaaltest.onmicrosoft.com" }),
    { id: andereOid, userPrincipalName: "iemand-anders@Bestuurdersportaaltest.onmicrosoft.com" },
    BRON,
  );
  const codes = drift.filter((bevinding) => bevinding.soort === "actor").map((bevinding) => bevinding.code);
  assert.deepEqual(codes.sort(), ["graph_objectid_wijkt_af", "graph_upn_wijkt_af", "idtoken_objectid_wijkt_af"]);
});

test("negatief — id-token en /me die elkaar tegenspreken zijn óók actordrift", () => {
  const drift = toetsDrift(PROFIEL, aanmelding({ preferred_username: "ander@Bestuurdersportaaltest.onmicrosoft.com" }), ACTOR, BRON);
  assert.ok(drift.some((bevinding) => bevinding.code === "idtoken_en_graph_spreken_elkaar_tegen"));
});

test("negatief — een andere appregistratie in het id-token stopt de run", () => {
  const drift = toetsDrift(PROFIEL, aanmelding({ aud: "983ce61b-7a73-482b-bc19-c09d92e909b4" }), ACTOR, BRON);
  assert.ok(drift.some((bevinding) => bevinding.soort === "appregistratie"));
});

test("negatief — een live site of bibliotheek die niet bij de registratie past, is rootdrift", () => {
  const andereSite = toetsDrift(PROFIEL, aanmelding(), ACTOR, { ...BRON, siteWebUrl: `https://${HOST}/sites/AndereSite` });
  assert.ok(andereSite.some((bevinding) => bevinding.code === "site_wijkt_af_van_registratie"));

  const andereBibliotheek = toetsDrift(PROFIEL, aanmelding(), ACTOR, {
    ...BRON,
    driveWebUrl: `https://${HOST}/sites/PGBRetrievalLab/Andere%20Bibliotheek`,
  });
  assert.ok(andereBibliotheek.some((bevinding) => bevinding.code === "root_ligt_buiten_bibliotheek"));
});

// ---------------------------------------------------------------------------
//  De stopregel
// ---------------------------------------------------------------------------

/** Korte opbouw van een inhoudsuitslag voor de poorttests. */
function inhoud(o: Partial<Parameters<typeof beoordeelPoort>[0]> = {}) {
  return { treffers: 0, binnenRoot: 0, buitenRoot: 0, nietVerifieerbaar: 0, ...o };
}

test("de poort blijft dicht zolang één van beide scans niets geverifieerds geeft", () => {
  assert.deepEqual(beoordeelPoort(inhoud(), { treffers: 0 }), { doorgelaten: false, code: "beide_nul" });
  assert.deepEqual(beoordeelPoort(inhoud({ treffers: 1, binnenRoot: 1 }), { treffers: 0 }), {
    doorgelaten: false,
    code: "bestand_niet_aanwezig",
  });
  assert.deepEqual(beoordeelPoort(inhoud({ treffers: 1, binnenRoot: 1 }), { treffers: 1 }), { doorgelaten: true });
});

test("de drie inhoudsnulgevallen krijgen elk hun eigen poortcode", () => {
  // Dit is de correctie zelf. Ze vragen om drie verschillende vervolgstappen:
  // wachten, uitzoeken, of de bron opruimen.
  assert.deepEqual(beoordeelPoort(inhoud({ treffers: 0 }), { treffers: 1 }), {
    doorgelaten: false,
    code: "geen_zoekresultaat",
  });
  assert.deepEqual(beoordeelPoort(inhoud({ treffers: 1, nietVerifieerbaar: 1 }), { treffers: 1 }), {
    doorgelaten: false,
    code: "zoekresultaat_niet_verifieerbaar",
  });
  assert.deepEqual(beoordeelPoort(inhoud({ treffers: 1, buitenRoot: 1 }), { treffers: 1 }), {
    doorgelaten: false,
    code: "zoekresultaat_buiten_root",
  });
});

test("de live stand van 21-09 — één treffer, nul geaccepteerd — heet niet langer 'niet geïndexeerd'", () => {
  // De inhoudscan gaf één zoekresultaat zonder bruikbare parentReference; de
  // oude code rapporteerde dat als een koude index en stuurde daarmee naar de
  // verkeerde vervolgstap.
  const oordeel = beoordeelPoort(inhoud({ treffers: 1, nietVerifieerbaar: 1 }), { treffers: 1 });
  assert.deepEqual(oordeel, { doorgelaten: false, code: "zoekresultaat_niet_verifieerbaar" });
});

test("niet-verifieerbaar weegt zwaarder dan buiten-root als beide voorkomen", () => {
  // Weten dát iets buiten de root ligt is een uitkomst; niet weten waar iets
  // staat, is een gat in de meting — en dat moet het rapport laten zien.
  assert.deepEqual(
    beoordeelPoort(inhoud({ treffers: 2, buitenRoot: 1, nietVerifieerbaar: 1 }), { treffers: 1 }),
    { doorgelaten: false, code: "zoekresultaat_niet_verifieerbaar" },
  );
});

test("treffers die nergens op optellen, vallen fail-closed naar 'niet verifieerbaar'", () => {
  // Een scan die treffers meldt maar ze niet indeelt, is zelf verdacht.
  assert.deepEqual(beoordeelPoort(inhoud({ treffers: 3 }), { treffers: 1 }), {
    doorgelaten: false,
    code: "zoekresultaat_niet_verifieerbaar",
  });
});

test("een inhoudstreffer die niet geverifieerd is, opent de poort niet", () => {
  assert.equal(beoordeelPoort(inhoud({ treffers: 5, buitenRoot: 5 }), { treffers: 5 }).doorgelaten, false);
});

// ---------------------------------------------------------------------------
//  Negatief 3 — resultaat buiten de bronroot
// ---------------------------------------------------------------------------

test("negatief — een kandidaat buiten de geregistreerde root wordt afgewezen en nergens meegeteld", () => {
  const uitslag = categoriseer(
    [
      { webUrl: fixtureUrl(VERWACHTE_FIXTURE), extracts: ["fragment"] },
      // Zelfde bestandsnaam, andere bibliotheek: moet afvallen op de root.
      {
        webUrl: `https://${HOST}/sites/AndereSite/Shared%20Documents/${VERWACHTE_FIXTURE}-Zandloperbaken-hersteldossier.docx`,
        extracts: ["fragment"],
      },
      // Andere tenant-host.
      { webUrl: `https://netorgft20476383.sharepoint.com/sites/x/${VERWACHTE_FIXTURE}-a.docx`, extracts: [] },
      { webUrl: "", extracts: [] },
    ],
    ROOT,
    HOST,
  );
  assert.equal(uitslag.categorieen.verwachte_fixture, 1);
  assert.equal(uitslag.categorieen.buiten_bronroot, 2);
  assert.equal(uitslag.categorieen.zonder_locator, 1);
  assert.deepEqual(uitslag.fixturecodes, [VERWACHTE_FIXTURE]);
  assert.equal(uitslag.verwachteFixtureGevonden, true);
  // Alleen de treffer BINNEN de root telde een extract mee.
  assert.equal(uitslag.hitsMetExtracts, 1);
});

test("een andere fixture binnen de root is geen verwachte treffer", () => {
  const uitslag = categoriseer([{ webUrl: fixtureUrl("PGB354-DOC-001", "iets.docx"), extracts: [] }], ROOT, HOST);
  assert.equal(uitslag.categorieen.binnen_root_andere_fixture, 1);
  assert.equal(uitslag.verwachteFixtureGevonden, false);
});

test("fixturecode-afleiding raadt niet en geeft nooit een bestandsnaam terug", () => {
  assert.equal(fixturecodeUitUrl(fixtureUrl(VERWACHTE_FIXTURE)), VERWACHTE_FIXTURE);
  assert.equal(fixturecodeUitUrl(`https://${HOST}/sites/x/Shared%20Documents/notulen.docx`), null);
  assert.equal(fixturecodeUitUrl("niet-eens-een-url"), null);
});

// ---------------------------------------------------------------------------
//  Negatief 4, 5 en 6 — redirect, te grote respons, tweede netwerkpoging
// ---------------------------------------------------------------------------

test("negatief — een redirect wordt niet gevolgd maar als configuratiefout gestopt", async () => {
  let pogingen = 0;
  const gevolgdeUrls: string[] = [];
  await assert.rejects(
    meetMet((async (invoer: any, init: any) => {
      pogingen++;
      gevolgdeUrls.push(String(invoer));
      assert.equal(init.redirect, "manual", "de call mag omleidingen niet automatisch volgen");
      return new Response(null, { status: 302, headers: { location: "https://elders.example.com/" } });
    }) as unknown as typeof fetch),
    (fout: CopilotFout) => fout.code === "copilot_configuratie" && fout.httpStatus === 302,
  );
  assert.equal(pogingen, 1, "een redirect mag geen tweede poging opleveren");
  assert.deepEqual(gevolgdeUrls, ["https://graph.microsoft.com/v1.0/copilot/retrieval"]);
});

test("negatief — een te grote respons wordt afgekapt in plaats van ingelezen", async () => {
  // 3 MB aan drie-byte-tekens: ruim boven de bytegrens, maar in UTF-16-lengte
  // gemeten zou dit er nog onder liggen. Precies de val waar een grens op
  // `tekst.length` in trapt.
  const blok = new TextEncoder().encode("€".repeat(64 * 1024));
  let verzonden = 0;
  const stroom = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (verzonden >= 48) {
        controller.close();
        return;
      }
      verzonden++;
      controller.enqueue(blok);
    },
  });
  await assert.rejects(
    meetMet((async () => new Response(stroom, { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch),
    (fout: CopilotFout) => fout.code === "copilot_responsvorm",
  );
  assert.ok(verzonden < 48, "het lezen had moeten stoppen vóór de laatste chunk");
});

test("negatief — een tweede netwerkpoging bereikt het netwerk niet", async () => {
  const basis = (async () => jsonRespons({ retrievalHits: [] })) as unknown as typeof fetch;
  const eenmalig = eenmaligeFetch(basis);
  await eenmalig("https://graph.microsoft.com/v1.0/copilot/retrieval");
  await assert.rejects(
    () => eenmalig("https://graph.microsoft.com/v1.0/copilot/retrieval") as Promise<Response>,
    (fout: StopFail) => fout.code === "tweede_netwerkpoging",
  );
});

test("negatief — een herhaalbare 429 levert géén tweede poging op, want het budget is 1", async () => {
  assert.equal(RETRIEVAL_REQUESTBUDGET, 1);
  let pogingen = 0;
  await assert.rejects(
    meetMet((async () => {
      pogingen++;
      return new Response("{}", { status: 429 });
    }) as unknown as typeof fetch),
    (fout: CopilotFout) => fout.code === "copilot_rate_limit",
  );
  assert.equal(pogingen, 1, "429 is herhaalbaar, maar het budget van 1 verbiedt de herhaling");
});

// ---------------------------------------------------------------------------
//  De gelukte meting
// ---------------------------------------------------------------------------

test("een geslaagde meting doet precies één poging en scopet de filter server-side", async () => {
  let verstuurd: any = null;
  let pogingen = 0;
  const uitslag = await meetMet((async (_invoer: any, init: any) => {
    pogingen++;
    verstuurd = JSON.parse(String(init.body));
    return jsonRespons({
      retrievalHits: [
        { webUrl: fixtureUrl(VERWACHTE_FIXTURE), extracts: [{ text: "een fragment dat nergens bewaard wordt" }] },
      ],
    });
  }) as unknown as typeof fetch);

  assert.equal(pogingen, 1);
  assert.equal(uitslag.netwerkpogingen, 1);
  assert.equal(uitslag.scenario, SCENARIO.code);
  assert.equal(uitslag.verwachteFixture, VERWACHTE_FIXTURE);
  assert.equal(uitslag.verwachteFixtureStatus, "actueel");
  assert.equal(uitslag.uitslag.verwachteFixtureGevonden, true);
  assert.ok(uitslag.latencyMs >= 0);

  assert.equal(verstuurd.dataSource, "sharePoint");
  assert.equal(verstuurd.filterExpression, `path:"https://${HOST}/sites/PGBRetrievalLab/Shared%20Documents"`);
  assert.equal(verstuurd.queryString, SCENARIO.copilotVraag);
  // De vraag zit in een eigen veld en kan de scope niet raken.
  assert.ok(!verstuurd.filterExpression.includes(SCENARIO.copilotVraag));
});

test("exacte canary verstuurt één vaste inhoudsvraag met dezelfde serverfilter", async () => {
  let verstuurd: any = null;
  let pogingen = 0;
  const uitslag = await meetMet((async (_invoer: any, init: any) => {
    pogingen++;
    verstuurd = JSON.parse(String(init.body));
    return jsonRespons({ retrievalHits: [
      { webUrl: fixtureUrl(VERWACHTE_FIXTURE), extracts: [{ text: "wordt niet bewaard" }] },
    ] });
  }) as unknown as typeof fetch, "exacte_canary");

  assert.equal(pogingen, 1);
  assert.equal(uitslag.netwerkpogingen, 1);
  assert.equal(uitslag.scenario, EXACTE_CANARY_SCENARIO);
  assert.equal(uitslag.uitslag.verwachteFixtureGevonden, true);
  assert.equal(verstuurd.queryString, INHOUDSCAN_TERM);
  assert.equal(verstuurd.filterExpression, `path:"https://${HOST}/sites/PGBRetrievalLab/Shared%20Documents"`);
  assert.ok(!verstuurd.filterExpression.includes(INHOUDSCAN_TERM));
});

test("exacte canary herhaalt niet na 429", async () => {
  let pogingen = 0;
  await assert.rejects(
    meetMet((async () => {
      pogingen++;
      return new Response("{}", { status: 429 });
    }) as unknown as typeof fetch, "exacte_canary"),
    (fout: CopilotFout) => fout.code === "copilot_rate_limit",
  );
  assert.equal(pogingen, 1);
});

test("een lege uitslag is een kwaliteitsuitkomst en geen fout", async () => {
  const uitslag = await meetMet((async () => jsonRespons({ retrievalHits: [] })) as unknown as typeof fetch);
  assert.equal(uitslag.kandidaten, 0);
  assert.equal(uitslag.uitslag.verwachteFixtureGevonden, false);
  assert.deepEqual(uitslag.uitslag.fixturecodes, []);
});

// ---------------------------------------------------------------------------
//  De uitvoer lekt niets
// ---------------------------------------------------------------------------

test("het rapport bevat geen URL, bestandsnaam, extract of token", async () => {
  const geheimExtract = "Bij vastgestelde onderdekking beschikt dit fonds over negen kalenderdagen";
  const retrieval = await meetMet((async () =>
    jsonRespons({
      retrievalHits: [
        { webUrl: fixtureUrl(VERWACHTE_FIXTURE), extracts: [{ text: geheimExtract }] },
        { webUrl: `https://${HOST}/sites/AndereSite/Shared%20Documents/geheim-verslag.docx`, extracts: [{ text: geheimExtract }] },
      ],
    })) as unknown as typeof fetch);

  const rapport: Smokerapport = {
    uitgevoerdOp: "2026-09-20T12:00:00.000Z",
    profielId: PROFIEL.profielId,
    tenantDomein: PROFIEL.tenantDomein,
    actorUpn: PROFIEL.actorUpn,
    siteHostnaam: PROFIEL.siteHostnaam,
    scenario: SCENARIO.code,
    verwachteFixture: VERWACHTE_FIXTURE,
    geregistreerdeIndexstand: PROFIEL.indexStatus,
    drift: [],
    scans: [
      { naam: "inhoudscan", sleutel: "Zandloperbaken 12", treffers: 1, binnenRoot: 1 },
      { naam: "bestandsnaamscan", sleutel: VERWACHTE_FIXTURE, treffers: 1, binnenRoot: 1, afgekapt: false },
    ],
    poort: { doorgelaten: true },
    akkoordGevraagd: true,
    akkoordGegeven: true,
    graphCalls: 5,
    retrieval,
    eindstand: "gemeten",
  };

  const tekst = rapporteer(rapport);
  assert.ok(!tekst.includes(geheimExtract), "een extract lekte in het rapport");
  assert.ok(!tekst.includes("https://"), "een URL lekte in het rapport");
  assert.ok(!tekst.includes(".docx"), "een bestandsnaam lekte in het rapport");
  assert.ok(!tekst.includes("geheim-verslag"), "een bestandsnaam lekte in het rapport");
  assert.ok(!tekst.includes("test-token"), "een token lekte in het rapport");
  // En het rapport bevat wél waar het voor bedoeld is.
  assert.ok(tekst.includes(VERWACHTE_FIXTURE));
  assert.ok(tekst.includes("buiten bronroot"));
  assert.match(tekst, /Eindstand: `gemeten`/);
});

test("een dichte poort rapporteert nul netwerkpogingen en noemt de reden", () => {
  const tekst = rapporteer({
    uitgevoerdOp: "2026-09-20T12:00:00.000Z",
    profielId: PROFIEL.profielId,
    tenantDomein: PROFIEL.tenantDomein,
    actorUpn: PROFIEL.actorUpn,
    siteHostnaam: PROFIEL.siteHostnaam,
    scenario: SCENARIO.code,
    verwachteFixture: VERWACHTE_FIXTURE,
    geregistreerdeIndexstand: PROFIEL.indexStatus,
    drift: [],
    scans: [
      { naam: "inhoudscan", sleutel: "Zandloperbaken 12", treffers: 0, binnenRoot: 0 },
      { naam: "bestandsnaamscan", sleutel: VERWACHTE_FIXTURE, treffers: 1, binnenRoot: 1, afgekapt: false },
    ],
    poort: { doorgelaten: false, code: "zoekresultaat_niet_verifieerbaar" },
    akkoordGevraagd: false,
    akkoordGegeven: false,
    graphCalls: 5,
    retrieval: null,
    eindstand: "gestopt_op_poort",
  });
  assert.match(tekst, /Poort dicht/);
  assert.match(tekst, /Retrieval API-netwerkpogingen: 0/);
  assert.match(tekst, /Eindstand: `gestopt_op_poort`/);
});
