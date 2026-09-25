// ============================================================================
//  #426 T4-E — de Copilot-adapter. Hermetisch: geen netwerk, geen database.
// ----------------------------------------------------------------------------
//  De twee eigenschappen die ertoe doen:
//    1. achter dichte poorten doet deze adapter NIETS — nul tokenaanvragen,
//       nul Graph-lezingen, nul Retrieval-calls;
//    2. het toegangsbewijs wordt AFGELEID uit de grondslag van de keten en niet
//       hier samengesteld. Zou het hier ontstaan, dan toetst de centrale poort
//       straks een venster dat nooit is gecontroleerd.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { maakCopilotAdapter } from "../../core/lib/microsoft-retrieval/adapter";
import type { BronSnapshot } from "../../core/lib/microsoft-retrieval/driveitem";
import type { RetrievalContext, RetrievalQuery } from "../../core/lib/retrieval/contract";
import type { CopilotReadinessToestand } from "../../core/lib/microsoft-retrieval/rollout-core";

const FONDS = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

const CTX: RetrievalContext = {
  fondsId: FONDS,
  actor: { soort: "gebruiker", id: ACTOR },
  taaktype: "chat_generatie",
  bronbeleid: { bronsoorten: ["sharepoint"] },
  correlationId: "corr-1",
  verzoekStartOp: new Date().toISOString(),
  // De orkestratie zet dit naast `signal`, uit dezelfde grendel.
  resterendMs: () => 12_000,
};

const QUERY: RetrievalQuery = {
  naam: "primair",
  origineleVraag: "beleid",
  zoekvraag: "beleid",
  strategie: "gericht",
  maxResultaten: 5,
  maxKandidaten: 20,
  maxContextTekens: 50_000,
};

const BRON: BronSnapshot = {
  id: "33333333-3333-4333-8333-333333333333",
  tenantId: "tenant-1",
  siteHostnaam: "check.sharepoint.com",
  driveId: "drive-1",
  rootItemId: "root-1",
  configuratieversie: 7,
  status: "actief",
};

interface Tellers {
  readiness: number;
  token: number;
  graph: number;
  kandidaten: number;
}

function maakDeps(toestand: CopilotReadinessToestand, t: Tellers) {
  return {
    toelating: {
      leesReadiness: async () => {
        t.readiness += 1;
        return {
          uitkomst: { toestand, verbindingVersie: 1 },
          verbinding: { tenantId: "tenant-1", actorObjectId: "obj-1" },
        };
      },
      tokenbron: {
        profiel: {
          tenantId: "tenant-1",
          clientId: "client-1",
          credentialmodel: "confidential_client_secret" as const,
        },
        haalToken: async () => {
          t.token += 1;
          return {
            accessToken: "stub-token",
            bevestigd: {
              tenantId: "tenant-1",
              actorObjectId: "obj-1",
              clientId: "client-1",
              scopes: ["Files.Read.All", "Sites.Read.All"],
            },
          };
        },
      },
    },
    bron: BRON,
    keten: {
      leesItem: async (itemId: string) => {
        t.graph += 1;
        throw new Error(`er is een Graph-lezing gedaan voor ${itemId}`);
      },
      zoekRegister: async () => undefined,
      haalKandidaten: async () => {
        t.kandidaten += 1;
        return [];
      },
      herleesBron: async () => BRON,
    },
  };
}

const tellers = (): Tellers => ({ readiness: 0, token: 0, graph: 0, kandidaten: 0 });

test("BEWUST UIT: nul tokenaanvragen, nul Graph-lezingen, nul kandidatenrondes", async () => {
  const t = tellers();
  const adapter = maakCopilotAdapter(maakDeps("uit", t));
  const uit = await adapter.zoek(CTX, QUERY);

  assert.deepEqual(uit.kandidaten, []);
  assert.equal(uit.provider, "geen", "een dichte poort hoort geen provider te raadplegen");
  assert.equal(uit.fout, undefined, "bewust uit is geen fout — er is niets gevraagd");
  assert.equal(t.readiness, 1, "readiness mag één keer worden gelezen");
  assert.equal(t.token, 0);
  assert.equal(t.graph, 0);
  assert.equal(t.kandidaten, 0);
});

test("elke niet-gereed toestand blijft fail-closed en doet geen enkele call", async () => {
  const toestanden: CopilotReadinessToestand[] = [
    "configuratie_ongeldig",
    "consent_ontbreekt",
    "billing_ontbreekt",
    "tijdelijk_geblokkeerd",
  ];
  for (const toestand of toestanden) {
    const t = tellers();
    const adapter = maakCopilotAdapter(maakDeps(toestand, t));
    const uit = await adapter.zoek(CTX, QUERY);
    assert.deepEqual(uit.kandidaten, [], toestand);
    assert.equal(uit.fout, "configuratiefout", toestand);
    assert.equal(t.token, 0, `${toestand}: er is een token aangevraagd`);
    assert.equal(t.graph, 0, `${toestand}: er is een Graph-lezing gedaan`);
    assert.equal(t.kandidaten, 0, `${toestand}: er is een kandidatenronde gestart`);
  }
});

test("de capabilities zijn EERLIJK: bewijs beloofd én de hook aanwezig", async () => {
  const adapter = maakCopilotAdapter(maakDeps("uit", tellers()));
  const caps = adapter.capabilities();
  assert.equal(caps.permissionProof, true);
  assert.ok(adapter.verifieerBronregistratie, "permissionProof zonder V5-hook weigert de poort gesloten");
  assert.deepEqual(caps.bronsoorten, ["sharepoint"]);
  // Fail-closed: geen gedegradeerde versiesoorten.
  assert.deepEqual(caps.versiebeleid.gedegradeerd, []);
  assert.equal(caps.preview, false, "deze arm levert geen preview en mag dat niet claimen");
});

test("V5 herleest de bronregistratie en meldt een intrekking als NIET verbonden", async () => {
  const t = tellers();
  const deps = maakDeps("gereed", t);
  const adapter = maakCopilotAdapter(deps);
  const verbonden = await adapter.verifieerBronregistratie!(CTX, ["r1", "r2"]);
  assert.equal(verbonden.get("r1")?.verbonden, true);
  assert.equal(verbonden.get("r1")?.versie, BRON.configuratieversie);

  const ingetrokken = maakCopilotAdapter({
    ...deps,
    keten: { ...deps.keten, herleesBron: async () => undefined },
  });
  const stand = await ingetrokken.verifieerBronregistratie!(CTX, ["r1"]);
  assert.equal(stand.get("r1")?.verbonden, false);
});

test("het TOEGANGSBEWIJS wordt afgeleid uit de grondslag van de keten", async () => {
  // Dit is de kern van deze wrapper. Zou hij `gecontroleerdOp` op `new Date()`
  // zetten en `bronconfiguratieVersie` uit de momentopname halen, dan toetst de
  // centrale poort straks een venster dat nooit is gecontroleerd — en zou dat
  // bewijs er wél geldig uitzien.
  const t = tellers();
  const deps = maakDeps("gereed", t);
  const grondslag = {
    bronregistratieRef: BRON.id,
    configuratieversie: 7,
    vastgesteldOp: "2026-09-22T09:15:00.000Z",
  };
  const adapter = maakCopilotAdapter({
    ...deps,
    ketenImpl: async () => ({
      ok: true as const,
      treffers: [{
        ref: "doc-ref-1",
        grondslag,
        naam: "Beleidsnota.docx",
        mappad: "/Documenten",
        bestandstype: "docx" as const,
        passage: "De hersteltermijn bedraagt twaalf maanden.",
        pagina: 4,
        paragraaf: "2.1",
        versie: { soort: "etag" as const, waarde: 'W/"etag-1"' },
        volgorde: 0,
      }],
      telling: {
        hits: 1, hitsBuitenGrens: 0, hitsAfgewezen: 0, hitsGegroepeerd: 1,
        documenten: 1, documentenAfgewezen: 0,
        afwijzingen: {
          root: 0, mapping: 0, binding: 0, rechten_configuratie: 0, versie: 0,
          download: 0, extractie: 0, lokalisatie: 0, grens: 0,
        },
        gedownloadeBytes: 10, geextraheerdeTekens: 40, deadlineVerlopen: false,
      },
    }),
  });

  const uit = await adapter.zoek(CTX, QUERY);
  assert.equal(uit.kandidaten.length, 1);
  const kandidaat = uit.kandidaten[0];
  const bewijs = kandidaat.toegangscontrole;
  assert.ok(bewijs);

  // ELK bewijsveld komt uit de grondslag of uit de context — geen enkel veld
  // wordt hier bedacht.
  assert.equal(bewijs.gecontroleerdOp, grondslag.vastgesteldOp);
  assert.equal(bewijs.bronconfiguratieVersie, grondslag.configuratieversie);
  assert.equal(bewijs.bronregistratieRef, grondslag.bronregistratieRef);
  assert.equal(bewijs.correlationId, CTX.correlationId);
  assert.equal(bewijs.gebruikerId, ACTOR);
  assert.equal(bewijs.basis, "delegated_user");
  // De poort eist dat bewijs en resultaat naar dezelfde kandidaat wijzen.
  assert.equal(bewijs.resultaatRef, kandidaat.ref);
  assert.equal(kandidaat.bronregistratieRef, grondslag.bronregistratieRef);
  // En de versie draagt hetzelfde controlemoment.
  assert.equal(kandidaat.versie.gecontroleerdOp, grondslag.vastgesteldOp);
  // De passage komt uit de eigen extractie; het Microsoft-extract niet mee.
  assert.equal(kandidaat.passage, "De hersteltermijn bedraagt twaalf maanden.");
});

test("een afgekapte keten is zichtbaar als truncatie, niet als volledige uitslag", async () => {
  const deps = maakDeps("gereed", tellers());
  const adapter = maakCopilotAdapter({
    ...deps,
    ketenImpl: async () => ({
      ok: true as const,
      treffers: [],
      telling: {
        hits: 3, hitsBuitenGrens: 2, hitsAfgewezen: 0, hitsGegroepeerd: 1,
        documenten: 1, documentenAfgewezen: 1,
        afwijzingen: {
          root: 0, mapping: 0, binding: 0, rechten_configuratie: 0, versie: 0,
          download: 0, extractie: 0, lokalisatie: 0, grens: 1,
        },
        gedownloadeBytes: 0, geextraheerdeTekens: 0, deadlineVerlopen: true,
      },
    }),
  });
  const uit = await adapter.zoek(CTX, QUERY);
  assert.deepEqual(uit.truncatie, { reden: "tijd" });
});

// ── Het beurtbudget ────────────────────────────────────────────────────────

test("een OPGEBRUIKT beurtbudget roept de keten NUL keer aan", async () => {
  // De valkuil die dit afdekt: budget alleen doorgeven "als het positief is".
  // Dan vertrekt de keten bij nul juist met haar eigen standaard van vijftien
  // seconden — uitgerekend het uitgeputte geval krijgt dan de langste deadline.
  const t = tellers();
  let ketenAanroepen = 0;
  const adapter = maakCopilotAdapter({
    ...maakDeps("gereed", t),
    ketenImpl: async () => {
      ketenAanroepen += 1;
      throw new Error("de keten had niet mogen vertrekken");
    },
  });
  for (const budget of [0, -5]) {
    const uit = await adapter.zoek({ ...CTX, resterendMs: () => budget }, QUERY);
    assert.equal(ketenAanroepen, 0, `budget ${budget}: de keten is toch gestart`);
    assert.equal(uit.fout, "timeout", `budget ${budget}`);
    assert.deepEqual(uit.kandidaten, []);
  }
});

test("het RESTERENDE budget wordt als ketendeadline doorgegeven", async () => {
  let gezien: number | undefined;
  const adapter = maakCopilotAdapter({
    ...maakDeps("gereed", tellers()),
    ketenImpl: async (opdracht) => {
      gezien = opdracht.grenzen?.deadlineMs;
      return {
        ok: true as const,
        treffers: [],
        telling: {
          hits: 0, hitsBuitenGrens: 0, hitsAfgewezen: 0, hitsGegroepeerd: 0,
          documenten: 0, documentenAfgewezen: 0,
          afwijzingen: {
            root: 0, mapping: 0, binding: 0, rechten_configuratie: 0, versie: 0,
            download: 0, extractie: 0, lokalisatie: 0, grens: 0,
          },
          gedownloadeBytes: 0, geextraheerdeTekens: 0, deadlineVerlopen: false,
        },
      };
    },
  });
  await adapter.zoek({ ...CTX, resterendMs: () => 3_500 }, QUERY);
  assert.equal(gezien, 3_500, "de keten kreeg niet het resterende beurtbudget");
});

test("ZONDER budget in de context stopt de adapter fail-closed", async () => {
  let ketenAanroepen = 0;
  const adapter = maakCopilotAdapter({
    ...maakDeps("gereed", tellers()),
    ketenImpl: async () => {
      ketenAanroepen += 1;
      throw new Error("onbereikbaar");
    },
  });
  const { resterendMs: _weg, ...zonderBudget } = CTX;
  const uit = await adapter.zoek(zonderBudget, QUERY);
  assert.equal(ketenAanroepen, 0);
  assert.equal(uit.fout, "configuratiefout");
});
