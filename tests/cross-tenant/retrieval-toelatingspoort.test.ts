// ============================================================================
//  #322 F4-T2-1/PR-C — De TOELATINGSPOORT (V1–V5, ontwerp §4.2.1).
// ----------------------------------------------------------------------------
//  Wat hier wordt bewezen is niet dat de poort "werkt", maar dat hij FAIL-CLOSED
//  is: elke ontbrekende, verlopen, verwisselde of onverifieerbare voorwaarde
//  weigert. Een poort die bij twijfel toelaat, is geen poort.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  verifieerToelating,
  BEWIJS_MAX_LEEFTIJD_MS,
  BEWIJS_KLOKSPELING_MS,
} from "../../core/lib/retrieval/toelatingspoort";
import type {
  AdapterCapabilities,
  AdapterUitkomst,
  Bronregistratiestand,
  Bronresultaat,
  RetrievalAdapter,
  RetrievalContext,
  Toegangsbewijs,
} from "../../core/lib/retrieval/contract";

const GEBRUIKER = "22222222-2222-4222-8222-222222222222";
const CTX: RetrievalContext = {
  fondsId: "11111111-1111-4111-8111-111111111111",
  actor: { soort: "gebruiker", id: GEBRUIKER },
  taaktype: "chat_generatie",
  bronbeleid: { bronsoorten: ["sharepoint"] },
  correlationId: "corr-poort",
  verzoekStartOp: new Date(Date.now() - 1_000).toISOString(),
};

function bewijs(over: Partial<Toegangsbewijs> = {}): Toegangsbewijs {
  return {
    toegestaan: true,
    resultaatRef: "sp-1",
    bronregistratieRef: "bron-A",
    gebruikerId: GEBRUIKER,
    correlationId: CTX.correlationId,
    gecontroleerdOp: new Date().toISOString(),
    basis: "delegated_user",
    bronconfiguratieVersie: 7,
    ...over,
  };
}

function bron(ref: string, tc?: Toegangsbewijs | null): Bronresultaat {
  return {
    ref,
    bronsoort: "sharepoint",
    titel: "T",
    documentIdentiteit: { documentId: `doc-${ref}` },
    versie: { soort: "etag", waarde: "e", gecontroleerdOp: null },
    ...(tc === null ? {} : { toegangscontrole: tc ?? bewijs({ resultaatRef: ref }) }),
    locator: {},
    passage: `passage van ${ref}`,
    status: { actueel: true },
    rang: { positie: 1, score: 1 },
  };
}

function adapter(opties: {
  permissionProof: boolean;
  hook?: RetrievalAdapter["verifieerBronregistratie"];
}): RetrievalAdapter {
  const caps: AdapterCapabilities = {
    bronsoorten: ["sharepoint"],
    strategieen: ["gericht"],
    ondersteundeFilters: [],
    versiebewijs: true,
    permissionProof: opties.permissionProof,
    preview: false,
    cancellation: true,
    timeout: true,
  };
  return {
    naam: "microsoft-sharepoint",
    capabilities: () => caps,
    async zoek(): Promise<AdapterUitkomst> {
      return { kandidaten: [], methode: "sharepoint_live", provider: "microsoft", latencyMs: 0, opgehaald: 0 };
    },
    ...(opties.hook ? { verifieerBronregistratie: opties.hook } : {}),
  };
}

const STAND = (versie = 7, verbonden = true) =>
  async (_c: RetrievalContext, refs: readonly string[]) =>
    new Map<string, Bronregistratiestand>(refs.map((r) => [r, { verbonden, versie }]));

// ── Het gelukkige pad ───────────────────────────────────────────────────────

test("PR-C — een volledig bewijs komt door alle vijf de voorwaarden", async () => {
  const a = adapter({ permissionProof: true, hook: STAND() });
  const uit = await verifieerToelating(CTX, a, [bron("sp-1"), bron("sp-2")]);
  assert.equal(uit.toegelaten.length, 2);
  assert.deepEqual(uit.geweigerd, []);
});

test("PR-C — een adapter zonder bewijsbelofte levert door zonder bewijs", async () => {
  // Supabase: live RLS ÍS de toegangscontrole. De poort eist daar geen bewijs.
  const a = adapter({ permissionProof: false });
  const uit = await verifieerToelating(CTX, a, [bron("sp-1", null)]);
  assert.equal(uit.toegelaten.length, 1);
});

// ── Fail-closed ─────────────────────────────────────────────────────────────

test("PR-C — belooft de adapter bewijs, dan weigert een kandidaat zónder bewijs", async () => {
  const a = adapter({ permissionProof: true, hook: STAND() });
  const uit = await verifieerToelating(CTX, a, [bron("sp-1", null)]);
  assert.deepEqual(uit.toegelaten, []);
  assert.equal(uit.geweigerd[0].grond, "geen_bewijs");
});

test("PR-C — een adapter die GEEN bewijs belooft mag er ook geen meesturen", async () => {
  // Zonder deze controle kan een adapter stilzwijgend iets claimen dat nergens
  // wordt getoetst — schijnzekerheid die het contract juist moet uitsluiten.
  const a = adapter({ permissionProof: false });
  const uit = await verifieerToelating(CTX, a, [bron("sp-1")]);
  assert.deepEqual(uit.toegelaten, []);
  assert.equal(uit.geweigerd[0].grond, "bewijs_niet_beloofd");
});

test("PR-C — V2: een bewijs van een ANDERE gebruiker wordt geweigerd", async () => {
  const a = adapter({ permissionProof: true, hook: STAND() });
  const uit = await verifieerToelating(CTX, a, [
    bron("sp-1", bewijs({ resultaatRef: "sp-1", gebruikerId: "33333333-3333-4333-8333-333333333333" })),
  ]);
  assert.equal(uit.geweigerd[0].grond, "v2_andere_gebruiker");
});

test("PR-C — V3: een bewijs uit een EERDER verzoek wordt geweigerd", async () => {
  const a = adapter({ permissionProof: true, hook: STAND() });
  const uit = await verifieerToelating(CTX, a, [
    bron("sp-1", bewijs({ resultaatRef: "sp-1", correlationId: "corr-vorige" })),
  ]);
  assert.equal(uit.geweigerd[0].grond, "v3_ander_verzoek");
});

test("PR-C — V4: te oud, uit de toekomst, van vóór het verzoek, of onleesbaar", async () => {
  const a = adapter({ permissionProof: true, hook: STAND() });
  const gevallen: [string, string][] = [
    ["te oud", new Date(Date.now() - BEWIJS_MAX_LEEFTIJD_MS - 5_000).toISOString()],
    ["uit de toekomst", new Date(Date.now() + BEWIJS_KLOKSPELING_MS + 5_000).toISOString()],
    ["vóór het verzoek", new Date(Date.parse(CTX.verzoekStartOp) - 1_000).toISOString()],
    ["onleesbaar", "gisteren"],
    ["leeg", ""],
  ];
  for (const [label, waarde] of gevallen) {
    const uit = await verifieerToelating(CTX, a, [bron("sp-1", bewijs({ resultaatRef: "sp-1", gecontroleerdOp: waarde }))]);
    assert.equal(uit.geweigerd[0]?.grond, "v4_venster", `${label} hoort geweigerd te worden`);
  }
});

test("PR-C — een onleesbare verzoekstart weigert; hij vervalt niet stil tot 'nu'", async () => {
  const a = adapter({ permissionProof: true, hook: STAND() });
  const uit = await verifieerToelating({ ...CTX, verzoekStartOp: "onzin" }, a, [bron("sp-1")]);
  assert.equal(uit.geweigerd[0].grond, "v4_venster");
});

test("PR-C — `basis: \"rls\"` kent geen venster, maar V2 en V3 gelden onverkort", async () => {
  const a = adapter({ permissionProof: true, hook: STAND() });
  const oud = new Date(Date.now() - 10 * BEWIJS_MAX_LEEFTIJD_MS).toISOString();
  const door = await verifieerToelating(CTX, a, [
    bron("sp-1", bewijs({ resultaatRef: "sp-1", basis: "rls", gecontroleerdOp: oud })),
  ]);
  assert.equal(door.toegelaten.length, 1, "geen venster op het RLS-pad");
  const weg = await verifieerToelating(CTX, a, [
    bron("sp-1", bewijs({ resultaatRef: "sp-1", basis: "rls", correlationId: "corr-vorige" })),
  ]);
  assert.equal(weg.geweigerd[0].grond, "v3_ander_verzoek", "V3 geldt óók op het RLS-pad");
});

// ── De binding: een bewijs is niet overdraagbaar ────────────────────────────

test("PR-C — VERWISSELDE bewijzen tussen twee kandidaten worden beide geweigerd", async () => {
  // Zonder binding aan de kandidaat is dit precies het gat: binnen één verzoek
  // zijn actor, correlatie-id en configuratieversie per definitie gelijk, dus
  // een geldig bewijs voor A past dan naadloos op B.
  const a = adapter({ permissionProof: true, hook: STAND() });
  const bewijsA = bewijs({ resultaatRef: "sp-1" });
  const bewijsB = bewijs({ resultaatRef: "sp-2" });
  const uit = await verifieerToelating(CTX, a, [bron("sp-1", bewijsB), bron("sp-2", bewijsA)]);
  assert.deepEqual(uit.toegelaten, [], "beide kandidaten dragen het bewijs van de ander");
  assert.deepEqual(
    uit.geweigerd.map((g) => g.grond),
    ["binding_ander_resultaat", "binding_ander_resultaat"]
  );
});

// ── V5: de actuele stand van de bronregistratie ─────────────────────────────

test("PR-C — V5: een ONTBREKENDE map-entry weigert; onbekend is niet toegestaan", async () => {
  const leeg = async () => new Map<string, Bronregistratiestand>();
  const a = adapter({ permissionProof: true, hook: leeg });
  const uit = await verifieerToelating(CTX, a, [bron("sp-1")]);
  assert.equal(uit.geweigerd[0].grond, "v5_geen_stand");
});

test("PR-C — V5: een ontkoppelde of opgehoogde bron weigert", async () => {
  const ontkoppeld = adapter({ permissionProof: true, hook: STAND(7, false) });
  assert.equal((await verifieerToelating(CTX, ontkoppeld, [bron("sp-1")])).geweigerd[0].grond, "v5_bron_gewijzigd");
  const opgehoogd = adapter({ permissionProof: true, hook: STAND(8) });
  assert.equal((await verifieerToelating(CTX, opgehoogd, [bron("sp-1")])).geweigerd[0].grond, "v5_bron_gewijzigd");
});

test("PR-C — V5: een ONTBREKENDE hook weigert, ook al is al het andere in orde", async () => {
  const a = adapter({ permissionProof: true }); // belooft bewijs, kan niet herlezen
  const uit = await verifieerToelating(CTX, a, [bron("sp-1")]);
  assert.equal(uit.geweigerd[0].grond, "v5_hook_ontbreekt");
});

test("PR-C — V5: een hook die GOOIT weigert, en is te onderscheiden van een ontbrekende", async () => {
  const stuk = async () => {
    throw new Error("graph 503");
  };
  const a = adapter({ permissionProof: true, hook: stuk });
  const uit = await verifieerToelating(CTX, a, [bron("sp-1")]);
  assert.equal(uit.geweigerd[0].grond, "v5_hook_fout", "een storing hoort niet op een ontwerpfout te lijken");
});

test("PR-C — V5 herleest ÉÉN keer per unieke bronregistratie", async () => {
  let aanroepen = 0;
  let gezien: readonly string[] = [];
  const teller: RetrievalAdapter["verifieerBronregistratie"] = async (_c, refs) => {
    aanroepen++;
    gezien = refs;
    return new Map(refs.map((r) => [r, { verbonden: true, versie: 7 }]));
  };
  const a = adapter({ permissionProof: true, hook: teller });
  const kandidaten = [
    bron("sp-1", bewijs({ resultaatRef: "sp-1", bronregistratieRef: "bron-A" })),
    bron("sp-2", bewijs({ resultaatRef: "sp-2", bronregistratieRef: "bron-A" })),
    bron("sp-3", bewijs({ resultaatRef: "sp-3", bronregistratieRef: "bron-B" })),
  ];
  const uit = await verifieerToelating(CTX, a, kandidaten);
  assert.equal(uit.toegelaten.length, 3);
  assert.equal(aanroepen, 1, "één aanroep voor het hele spoor");
  assert.deepEqual([...gezien].sort(), ["bron-A", "bron-B"], "unieke referenties, geen duplicaten");
});

// ── Determinisme ────────────────────────────────────────────────────────────

test("PR-C — alle kandidaten worden tegen HETZELFDE `nu` beoordeeld", async () => {
  // Zou elke kandidaat zijn eigen "nu" krijgen, dan kan een trage lus de een nog
  // net binnen het venster laten vallen en de ander niet — en hangt de uitkomst
  // af van de volgorde waarin toevallig is geïtereerd.
  const a = adapter({ permissionProof: true, hook: STAND() });
  const opDeRand = new Date(Date.now() - BEWIJS_MAX_LEEFTIJD_MS + 300).toISOString();
  const kandidaten = Array.from({ length: 40 }, (_, i) =>
    bron(`sp-${i}`, bewijs({ resultaatRef: `sp-${i}`, gecontroleerdOp: opDeRand }))
  );
  const uit = await verifieerToelating(CTX, a, kandidaten);
  assert.ok(
    uit.toegelaten.length === 40 || uit.geweigerd.length === 40,
    `alles of niets, niet ${uit.toegelaten.length}/${uit.geweigerd.length}`
  );
});

// ── Providerneutraliteit, statisch afgedwongen ──────────────────────────────

test("PR-C — de poort kent geen providernamen en geen bronsoorten", async () => {
  const { readFileSync } = await import("node:fs");
  const bronTekst = readFileSync(new URL("../../core/lib/retrieval/toelatingspoort.ts", import.meta.url), "utf8");
  // Alleen de CODE, niet het commentaar: de kopnoot legt juist uit waaróm deze
  // module providerneutraal is en noemt daarbij "microsoft".
  const code = bronTekst
    .split("\n")
    .filter((r) => !/^\s*(\/\/|\*|\/\*)/.test(r))
    .join("\n");
  for (const verboden of ["microsoft", "sharepoint", "supabase", "bronsoort", "provider"]) {
    assert.doesNotMatch(
      code,
      new RegExp(verboden, "i"),
      `de poort mag niet op \`${verboden}\` beslissen — dat maakt het contract weer providerspecifiek`
    );
  }
  // Wat hij WEL moet doen: uitsluitend op de capability beslissen.
  assert.match(code, /capabilities\(\)\.permissionProof/, "de belofte van de adapter is het enige criterium");
});

// ── De race: intrekking TIJDENS het verzoek ─────────────────────────────────

test("PR-C — een bron die TIJDENS het verzoek wordt ingetrokken verdwijnt vóór de selectie", async () => {
  // Dit is de reden dat V5 HERLEEST in plaats van te vergelijken met een
  // momentopname. De testdouble haalt eerst op, en pas dáárna trekt de beheerder
  // de bron in — precies het venster dat een vergelijking met de startversie
  // niet ziet, omdat beide waarden dan uit hetzelfde moment komen.
  const { voerVolledigeRetrievalUit } = await import("../../core/lib/retrieval/orkestratie");

  let ingetrokken = false;
  const race: RetrievalAdapter = {
    ...adapter({ permissionProof: true }),
    async zoek(): Promise<AdapterUitkomst> {
      const k = [bron("sp-1"), bron("sp-2")];
      // De retrieval is klaar. NU trekt de beheerder de bron in.
      ingetrokken = true;
      return { kandidaten: k, methode: "sharepoint_live", provider: "microsoft", latencyMs: 0, opgehaald: k.length };
    },
    async verifieerBronregistratie(_c, refs) {
      return new Map(refs.map((r) => [r, { verbonden: !ingetrokken, versie: 7 }]));
    },
  };

  const uitkomst = await voerVolledigeRetrievalUit(
    CTX,
    {
      adapter: race,
      sporen: [
        {
          query: {
            naam: "primair",
            origineleVraag: "v",
            zoekvraag: "v",
            strategie: "gericht",
            maxResultaten: 5,
            maxKandidaten: 20,
            maxContextTekens: 100_000,
          },
          grenzen: { maxPerDoc: 5, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false },
        },
      ],
    },
    { primaireDocumentIds: new Set<string>(), peildatum: "2026-09-10", hoofddocumentLabel: " [h]", sentinel: "S" }
  );

  assert.deepEqual(uitkomst.kandidaten, [], "de ingetrokken bron mag de KANDIDATENpool niet halen");
  assert.deepEqual(uitkomst.geselecteerd, [], "en dus ook de selectie niet");
  assert.equal(uitkomst.bronverwijzingen.length, 0, "geen bronvermelding");
  assert.doesNotMatch(uitkomst.contextTekst, /passage van sp-/, "geen passage in de modelcontext");
  assert.equal(uitkomst.perAdapter[0].kandidaten, 0, "het auditspoor telt geen geweigerde bron mee");
  assert.equal(uitkomst.perAdapter[0].geweigerd, 2, "…maar meldt wél dát er is geweigerd");
});

test("PR-C — zonder weigeringen verschijnt het veld `geweigerd` NIET", async () => {
  // Een veld dat altijd op 0 staat zou elke bestaande snapshot veranderen zonder
  // iets te melden — en dat raakt de 394 goldens van het Supabase-pad.
  const { voerVolledigeRetrievalUit } = await import("../../core/lib/retrieval/orkestratie");
  const schoon: RetrievalAdapter = {
    ...adapter({ permissionProof: true, hook: STAND() }),
    async zoek(): Promise<AdapterUitkomst> {
      const k = [bron("sp-1")];
      return { kandidaten: k, methode: "sharepoint_live", provider: "microsoft", latencyMs: 0, opgehaald: 1 };
    },
  };
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    {
      adapter: schoon,
      sporen: [
        {
          query: {
            naam: "primair",
            origineleVraag: "v",
            zoekvraag: "v",
            strategie: "gericht",
            maxResultaten: 5,
            maxKandidaten: 20,
            maxContextTekens: 100_000,
          },
          grenzen: { maxPerDoc: 5, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false },
        },
      ],
    },
    { primaireDocumentIds: new Set<string>(), peildatum: "2026-09-10", hoofddocumentLabel: " [h]", sentinel: "S" }
  );
  assert.equal(uit.perAdapter[0].kandidaten, 1);
  assert.equal("geweigerd" in uit.perAdapter[0], false, "het veld hoort te ontbreken, niet 0 te zijn");
  assert.equal("toelating" in uit, false, "en het tussenresultaat draagt geen lege toelatingslijst");
});
