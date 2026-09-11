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
  nietOndersteundeFilters,
  vatToelatingSamen,
  categorieVan,
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
  RetrievalQuery,
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

/** Een resultaat met een ONAFHANKELIJKE bronregistratieRef, los van het bewijs. */
function bron(ref: string, tc?: Toegangsbewijs | null, over: Partial<Bronresultaat> = {}): Bronresultaat {
  return {
    ref,
    bronsoort: "sharepoint",
    titel: "T",
    documentIdentiteit: { documentId: `doc-${ref}` },
    versie: { soort: "etag", waarde: "e", gecontroleerdOp: null },
    bronregistratieRef: "bron-A",
    ...(tc === null ? {} : { toegangscontrole: tc ?? bewijs({ resultaatRef: ref }) }),
    locator: {},
    passage: `passage van ${ref}`,
    status: { actueel: true },
    rang: { positie: 1, score: 1 },
    ...over,
  };
}

function caps(over: Partial<AdapterCapabilities> = {}): AdapterCapabilities {
  return {
    bronsoorten: ["sharepoint"],
    strategieen: ["gericht"],
    ondersteundeFilters: [],
    versiebewijs: false,
    permissionProof: true,
    preview: false,
    cancellation: true,
    timeout: true,
    ...over,
  };
}

function adapter(opties: {
  caps?: Partial<AdapterCapabilities>;
  hook?: RetrievalAdapter["verifieerBronregistratie"];
  zoek?: RetrievalAdapter["zoek"];
}): RetrievalAdapter {
  const c = caps(opties.caps);
  return {
    naam: "microsoft-sharepoint",
    capabilities: () => c,
    zoek:
      opties.zoek ??
      (async (): Promise<AdapterUitkomst> => ({
        kandidaten: [],
        methode: "sharepoint_live",
        provider: "microsoft",
        latencyMs: 0,
        opgehaald: 0,
      })),
    ...(opties.hook ? { verifieerBronregistratie: opties.hook } : {}),
  };
}

const STAND = (versie = 7, verbonden = true) =>
  async (_c: RetrievalContext, refs: readonly string[]) =>
    new Map<string, Bronregistratiestand>(refs.map((r) => [r, { verbonden, versie }]));

/** Eén spoor, één batch — de meeste tests toetsen de beoordeling zelf. */
const poort = (ctx: RetrievalContext, a: RetrievalAdapter, kandidaten: Bronresultaat[]) =>
  verifieerToelating(ctx, a, [kandidaten]);

const QUERY = (naam: string, over: Partial<RetrievalQuery> = {}): RetrievalQuery => ({
  naam,
  origineleVraag: "v",
  zoekvraag: "v",
  strategie: "gericht",
  maxResultaten: 5,
  maxKandidaten: 20,
  maxContextTekens: 100_000,
  ...over,
});
const GRENZEN = { maxPerDoc: 5, representatieConstraints: false, regimeWeging: false, relevantieDrempel: false };
const CITAAT = { primaireDocumentIds: new Set<string>(), peildatum: "2026-09-10", hoofddocumentLabel: " [h]", sentinel: "S" };

// ── Het gelukkige pad ───────────────────────────────────────────────────────

test("PR-C — een volledig bewijs komt door alle voorwaarden", async () => {
  const uit = await poort(CTX, adapter({ hook: STAND() }), [bron("sp-1"), bron("sp-2")]);
  assert.equal(uit.toegelatenPerSpoor[0].length, 2);
  assert.deepEqual(uit.geweigerd, []);
});

test("PR-C — een adapter zonder bewijsbelofte levert door zonder bewijs", async () => {
  // Supabase: live RLS ÍS de toegangscontrole. De poort eist daar geen bewijs.
  const uit = await poort(CTX, adapter({ caps: { permissionProof: false } }), [bron("sp-1", null)]);
  assert.equal(uit.toegelatenPerSpoor[0].length, 1);
});

// ── Fail-closed op het bewijs ───────────────────────────────────────────────

test("PR-C — belooft de adapter bewijs, dan weigert een kandidaat zónder bewijs", async () => {
  const uit = await poort(CTX, adapter({ hook: STAND() }), [bron("sp-1", null)]);
  assert.deepEqual(uit.toegelatenPerSpoor[0], []);
  assert.equal(uit.geweigerd[0].grond, "geen_bewijs");
});

test("PR-C — een adapter die GEEN bewijs belooft mag er ook geen meesturen (configuratiefout)", async () => {
  const uit = await poort(CTX, adapter({ caps: { permissionProof: false } }), [bron("sp-1")]);
  assert.equal(uit.geweigerd[0].grond, "bewijs_niet_beloofd");
  assert.equal(categorieVan("bewijs_niet_beloofd"), "configuratiefout");
});

test("PR-C — V2: een bewijs van een ANDERE gebruiker wordt geweigerd", async () => {
  const uit = await poort(CTX, adapter({ hook: STAND() }), [
    bron("sp-1", bewijs({ resultaatRef: "sp-1", gebruikerId: "33333333-3333-4333-8333-333333333333" })),
  ]);
  assert.equal(uit.geweigerd[0].grond, "v2_andere_gebruiker");
});

test("PR-C — V3: een bewijs uit een EERDER verzoek wordt geweigerd", async () => {
  const uit = await poort(CTX, adapter({ hook: STAND() }), [
    bron("sp-1", bewijs({ resultaatRef: "sp-1", correlationId: "corr-vorige" })),
  ]);
  assert.equal(uit.geweigerd[0].grond, "v3_ander_verzoek");
});

test("PR-C — V4: te oud, uit de toekomst, van vóór het verzoek, onleesbaar of leeg", async () => {
  const a = adapter({ hook: STAND() });
  const gevallen: [string, string][] = [
    ["te oud", new Date(Date.now() - BEWIJS_MAX_LEEFTIJD_MS - 5_000).toISOString()],
    ["uit de toekomst", new Date(Date.now() + BEWIJS_KLOKSPELING_MS + 5_000).toISOString()],
    ["vóór het verzoek", new Date(Date.parse(CTX.verzoekStartOp) - 1_000).toISOString()],
    ["onleesbaar", "gisteren"],
    ["leeg", ""],
  ];
  for (const [label, waarde] of gevallen) {
    const uit = await poort(CTX, a, [bron("sp-1", bewijs({ resultaatRef: "sp-1", gecontroleerdOp: waarde }))]);
    assert.equal(uit.geweigerd[0]?.grond, "v4_venster", `${label} hoort geweigerd te worden`);
  }
});

test("PR-C — een onleesbare verzoekstart weigert; hij vervalt niet stil tot 'nu'", async () => {
  const uit = await poort({ ...CTX, verzoekStartOp: "onzin" }, adapter({ hook: STAND() }), [bron("sp-1")]);
  assert.equal(uit.geweigerd[0].grond, "v4_venster");
});

test("PR-C — `basis: \"rls\"` kent geen venster, maar V2 en V3 gelden onverkort", async () => {
  const a = adapter({ hook: STAND() });
  const oud = new Date(Date.now() - 10 * BEWIJS_MAX_LEEFTIJD_MS).toISOString();
  const door = await poort(CTX, a, [bron("sp-1", bewijs({ resultaatRef: "sp-1", basis: "rls", gecontroleerdOp: oud }))]);
  assert.equal(door.toegelatenPerSpoor[0].length, 1, "geen venster op het RLS-pad");
  const weg = await poort(CTX, a, [bron("sp-1", bewijs({ resultaatRef: "sp-1", basis: "rls", correlationId: "corr-vorige" }))]);
  assert.equal(weg.geweigerd[0].grond, "v3_ander_verzoek", "V3 geldt óók op het RLS-pad");
});

// ── De binding: een bewijs is niet overdraagbaar ────────────────────────────

test("PR-C — VERWISSELDE bewijzen tussen twee kandidaten worden beide geweigerd", async () => {
  // Binnen één verzoek zijn actor, correlatie-id en configuratieversie per
  // definitie gelijk; zonder binding past een geldig bewijs voor A op B.
  const uit = await poort(CTX, adapter({ hook: STAND() }), [
    bron("sp-1", bewijs({ resultaatRef: "sp-2" })),
    bron("sp-2", bewijs({ resultaatRef: "sp-1" })),
  ]);
  assert.deepEqual(uit.toegelatenPerSpoor[0], []);
  assert.deepEqual(uit.geweigerd.map((g) => g.grond), ["binding_ander_resultaat", "binding_ander_resultaat"]);
});

test("PR-C — juiste `resultaatRef`, maar VERKEERDE bronreferentie → geweigerd", async () => {
  // Het gat uit de review: `bronregistratieRef` stond alleen ín het bewijs en
  // was dus een bewering over zichzelf. De poort vergelijkt nu met de
  // referentie die de adapter OP HET RESULTAAT zette.
  const uit = await poort(CTX, adapter({ hook: STAND() }), [
    bron("sp-1", bewijs({ resultaatRef: "sp-1", bronregistratieRef: "bron-B" }), { bronregistratieRef: "bron-A" }),
  ]);
  assert.equal(uit.geweigerd[0].grond, "binding_andere_bron");
});

test("PR-C — een resultaat zónder eigen bronreferentie kan niet worden gebonden", async () => {
  const uit = await poort(CTX, adapter({ hook: STAND() }), [
    bron("sp-1", bewijs({ resultaatRef: "sp-1" }), { bronregistratieRef: undefined }),
  ]);
  assert.equal(uit.geweigerd[0].grond, "binding_andere_bron");
});

// ── Versiebewijs ────────────────────────────────────────────────────────────

test("PR-C — belooft de adapter versiebewijs maar ontbreekt het → configuratiefout", async () => {
  const a = adapter({ caps: { versiebewijs: true }, hook: STAND() });
  for (const waarde of ["", undefined as unknown as string]) {
    const uit = await poort(CTX, a, [bron("sp-1", undefined, { versie: { soort: "etag", waarde, gecontroleerdOp: null } })]);
    assert.equal(uit.geweigerd[0]?.grond, "versiebewijs_ontbreekt", `waarde=${JSON.stringify(waarde)}`);
  }
  assert.equal(categorieVan("versiebewijs_ontbreekt"), "configuratiefout");
  // …terwijl een adapter ZONDER die belofte er niet op wordt afgerekend.
  const zonder = adapter({ caps: { versiebewijs: false }, hook: STAND() });
  const door = await poort(CTX, zonder, [bron("sp-1", undefined, { versie: { soort: "onbekend", waarde: "", gecontroleerdOp: null } })]);
  assert.equal(door.toegelatenPerSpoor[0].length, 1);
});

// ── V5: de actuele stand van de bronregistratie ─────────────────────────────

test("PR-C — V5: een ONTBREKENDE map-entry weigert; onbekend is niet toegestaan", async () => {
  const leeg = async () => new Map<string, Bronregistratiestand>();
  const uit = await poort(CTX, adapter({ hook: leeg }), [bron("sp-1")]);
  assert.equal(uit.geweigerd[0].grond, "v5_geen_stand");
});

test("PR-C — V5: een ontkoppelde, opgehoogde of ongeldige versie weigert", async () => {
  assert.equal((await poort(CTX, adapter({ hook: STAND(7, false) }), [bron("sp-1")])).geweigerd[0].grond, "v5_bron_gewijzigd");
  assert.equal((await poort(CTX, adapter({ hook: STAND(8) }), [bron("sp-1")])).geweigerd[0].grond, "v5_bron_gewijzigd");
  assert.equal((await poort(CTX, adapter({ hook: STAND(7.5) }), [bron("sp-1")])).geweigerd[0].grond, "v5_bron_gewijzigd");
});

test("PR-C — V5: een ONTBREKENDE hook weigert (configuratiefout)", async () => {
  const uit = await poort(CTX, adapter({}), [bron("sp-1")]);
  assert.equal(uit.geweigerd[0].grond, "v5_hook_ontbreekt");
  assert.equal(categorieVan("v5_hook_ontbreekt"), "configuratiefout");
});

test("PR-C — V5: een hook die GOOIT weigert, en is te onderscheiden van een ontbrekende", async () => {
  const stuk = async () => {
    throw new Error("graph 503");
  };
  const uit = await poort(CTX, adapter({ hook: stuk }), [bron("sp-1")]);
  assert.equal(uit.geweigerd[0].grond, "v5_hook_fout", "een storing hoort niet op een ontwerpfout te lijken");
  // Een Graph-503 zegt niets over wat deze gebruiker mag. Als autorisatie-
  // weigering geboekt zou het incident onzichtbaar maken én de gebruiker ten
  // onrechte als "niet bevoegd" registreren. Fail-closed blijft staan.
  assert.equal(categorieVan("v5_hook_fout"), "providerfout");
});

test("PR-C — V5 herleest onder de referentie VAN HET RESULTAAT, niet uit het bewijs", async () => {
  let gezien: readonly string[] = [];
  const hook: RetrievalAdapter["verifieerBronregistratie"] = async (_c, refs) => {
    gezien = refs;
    return new Map(refs.map((r) => [r, { verbonden: true, versie: 7 }]));
  };
  await poort(CTX, adapter({ hook }), [bron("sp-1", undefined, { bronregistratieRef: "bron-X" })]);
  assert.deepEqual([...gezien], ["bron-X"], "de adapter wijst de bron aan, niet het bewijs");
});

// ── Eén beoordeling per verzoek, over alle sporen ───────────────────────────

test("PR-C — twee sporen met DEZELFDE bron: precies één V5-call, één oordeel", async () => {
  // Per spoor apart zou dezelfde bron twee keer worden gelezen — en bij een
  // intrekking tussen die lezingen in het ene spoor worden toegelaten en in het
  // andere geweigerd. De batch voorkomt beide.
  let aanroepen = 0;
  let wisselend = true;
  const hook: RetrievalAdapter["verifieerBronregistratie"] = async (_c, refs) => {
    aanroepen++;
    // Zou er een tweede call komen, dan geeft die een ANDERE uitkomst.
    const verbonden = wisselend;
    wisselend = !wisselend;
    return new Map(refs.map((r) => [r, { verbonden, versie: 7 }]));
  };
  const uit = await verifieerToelating(CTX, adapter({ hook }), [[bron("sp-1")], [bron("sp-2")]]);
  assert.equal(aanroepen, 1, "één herlezing voor het hele verzoek");
  assert.equal(uit.toegelatenPerSpoor[0].length, 1);
  assert.equal(uit.toegelatenPerSpoor[1].length, 1, "beide sporen krijgen hetzelfde oordeel");
});

test("PR-C — unieke bronnen worden gededupliceerd over alle sporen heen", async () => {
  let gezien: readonly string[] = [];
  const hook: RetrievalAdapter["verifieerBronregistratie"] = async (_c, refs) => {
    gezien = refs;
    return new Map(refs.map((r) => [r, { verbonden: true, versie: 7 }]));
  };
  await verifieerToelating(CTX, adapter({ hook }), [
    [bron("sp-1"), bron("sp-2")],
    [bron("sp-3", bewijs({ resultaatRef: "sp-3", bronregistratieRef: "bron-B" }), { bronregistratieRef: "bron-B" })],
  ]);
  assert.deepEqual([...gezien].sort(), ["bron-A", "bron-B"]);
});

test("PR-C — alle kandidaten worden tegen HETZELFDE `nu` beoordeeld", async () => {
  const opDeRand = new Date(Date.now() - BEWIJS_MAX_LEEFTIJD_MS + 300).toISOString();
  const kandidaten = Array.from({ length: 40 }, (_, i) =>
    bron(`sp-${i}`, bewijs({ resultaatRef: `sp-${i}`, gecontroleerdOp: opDeRand }))
  );
  const uit = await poort(CTX, adapter({ hook: STAND() }), kandidaten);
  assert.ok(
    uit.toegelatenPerSpoor[0].length === 40 || uit.geweigerd.length === 40,
    `alles of niets, niet ${uit.toegelatenPerSpoor[0].length}/${uit.geweigerd.length}`
  );
});

// ── Vóór zoek(): de filterbelofte ───────────────────────────────────────────

test("PR-C — alleen filters MET een waarde tellen", () => {
  const c = caps({ ondersteundeFilters: ["modus"] });
  assert.deepEqual(nietOndersteundeFilters(c, QUERY("q", { filters: { modus: "actueel" } })), []);
  assert.deepEqual(nietOndersteundeFilters(c, QUERY("q", { filters: { peildatum: undefined } })), []);
  assert.deepEqual(nietOndersteundeFilters(c, QUERY("q", { filters: { peildatum: "2026-09-10" } })), ["peildatum"]);
});

test("PR-C — een niet-ondersteund filter: `zoek()` wordt aantoonbaar NIET aangeroepen", async () => {
  // Een filter dat de adapter niet kent is een fout, nooit een stille no-op:
  // anders zoekt hij breder dan gevraagd en ziet niemand het.
  const { voerVolledigeRetrievalUit } = await import("../../core/lib/retrieval/orkestratie");
  let zoekAanroepen = 0;
  const a = adapter({
    caps: { ondersteundeFilters: ["modus"] },
    hook: STAND(),
    zoek: async () => {
      zoekAanroepen++;
      return { kandidaten: [bron("sp-1")], methode: "sharepoint_live", provider: "microsoft", latencyMs: 0, opgehaald: 1 };
    },
  });
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    { adapter: a, sporen: [{ query: QUERY("primair", { filters: { peildatum: "2026-09-10" } }), grenzen: GRENZEN }] },
    CITAAT
  );
  assert.equal(zoekAanroepen, 0, "het spoor mag niet worden bevraagd");
  assert.equal(uit.perAdapter[0].fout, "configuratiefout");
  assert.deepEqual(uit.geselecteerd, []);
  assert.equal(uit.meta.toelating?.categorieen.configuratiefout, 1, "en het auditspoor meldt het");
  // …ook PER GROND — anders klopt "per categorie én per grond" niet en tellen
  // de gronden niet op tot het totaal.
  assert.equal(uit.meta.toelating?.gronden.filter_niet_ondersteund, 1);
});

// ── De race: intrekking TIJDENS het verzoek ─────────────────────────────────

test("PR-C — een bron die TIJDENS het verzoek wordt ingetrokken verdwijnt vóór de selectie", async () => {
  // Waarom V5 HERLEEST in plaats van te vergelijken met een momentopname: de
  // testdouble haalt eerst op en pas dáárna trekt de beheerder de bron in —
  // precies het venster dat een vergelijking met de startversie niet ziet.
  const { voerVolledigeRetrievalUit } = await import("../../core/lib/retrieval/orkestratie");
  let ingetrokken = false;
  const race = adapter({
    zoek: async () => {
      const k = [bron("sp-1"), bron("sp-2")];
      ingetrokken = true; // de retrieval is klaar; NU trekt de beheerder in
      return { kandidaten: k, methode: "sharepoint_live", provider: "microsoft", latencyMs: 0, opgehaald: k.length };
    },
    hook: async (_c, refs) => new Map(refs.map((r) => [r, { verbonden: !ingetrokken, versie: 7 }])),
  });
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    { adapter: race, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN }] },
    CITAAT
  );
  assert.deepEqual(uit.kandidaten, [], "de ingetrokken bron mag de KANDIDATENpool niet halen");
  assert.deepEqual(uit.geselecteerd, []);
  assert.equal(uit.bronverwijzingen.length, 0);
  assert.doesNotMatch(uit.contextTekst, /passage van sp-/, "geen passage in de modelcontext");
  assert.equal(uit.perAdapter[0].kandidaten, 0, "het auditspoor telt geen geweigerde bron mee");
  assert.equal(uit.perAdapter[0].geweigerd, 2, "…maar meldt wél dát er is geweigerd");
});

// ── Het duurzame auditspoor ─────────────────────────────────────────────────

test("PR-C — weigeringen bereiken de META, inhoudsvrij en genormaliseerd", async () => {
  const { voerVolledigeRetrievalUit } = await import("../../core/lib/retrieval/orkestratie");
  const a = adapter({
    zoek: async () => {
      const k = [
        bron("sp-1"), // toegelaten
        bron("sp-2", null), // geen bewijs → toestemming_geweigerd
        bron("sp-3", bewijs({ resultaatRef: "sp-9" })), // verwisseld → toestemming_geweigerd
      ];
      return { kandidaten: k, methode: "sharepoint_live", provider: "microsoft", latencyMs: 0, opgehaald: 3 };
    },
    hook: STAND(),
  });
  const uit = await voerVolledigeRetrievalUit(CTX, { adapter: a, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN }] }, CITAAT);
  const t = uit.meta.toelating;
  assert.ok(t, "de samenvatting hoort in de meta — die gaat naar het auditspoor");
  assert.equal(t.geweigerd, 2);
  assert.equal(t.categorieen.toestemming_geweigerd, 2);
  assert.equal(t.gronden.geen_bewijs, 1);
  assert.equal(t.gronden.binding_ander_resultaat, 1);
  assert.doesNotMatch(JSON.stringify(t), /sp-\d|bron-A|passage/, "inhoudsvrij: geen referenties, geen tekst");
});

test("PR-C — zonder weigeringen verschijnt `toelating` NIET (Supabase-goldens)", async () => {
  const { voerVolledigeRetrievalUit } = await import("../../core/lib/retrieval/orkestratie");
  const a = adapter({
    zoek: async () => ({ kandidaten: [bron("sp-1")], methode: "sharepoint_live", provider: "microsoft", latencyMs: 0, opgehaald: 1 }),
    hook: STAND(),
  });
  const uit = await voerVolledigeRetrievalUit(CTX, { adapter: a, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN }] }, CITAAT);
  assert.equal("toelating" in uit.meta, false, "het veld hoort te ontbreken, niet 0 te zijn");
  assert.equal("geweigerd" in uit.perAdapter[0], false);
  assert.equal(vatToelatingSamen([]), null);
});

test("PR-C — de samenvatting bereikt de chatroute én het auditspoor", async () => {
  // Statisch, want de route is niet hermetisch te draaien. Twee schakels:
  // (1) de route neemt de meta van de orkestratie over;
  // (2) `toelating` is als SPOOR geclassificeerd — anders valt hij fail-closed
  //     in de inhoud en bereikt hij het governance-spoor niet.
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(new URL("../../app/api/chat/route.ts", import.meta.url), "utf8");
  assert.match(route, /\.\.\.voltooid\.meta/, "de route neemt de meta van de orkestratie over");
  const { META_BASIS } = await import("../../core/lib/audit-meta");
  assert.ok((META_BASIS as readonly string[]).includes("toelating"), "`toelating` hoort bij het spoor");
});

test("PR-C — de gronden tellen op tot het totaal, en elke categorie ook", () => {
  const t = vatToelatingSamen(
    [{ grond: "geen_bewijs" }, { grond: "v5_hook_fout" }, { grond: "versiebewijs_ontbreekt" }],
    2
  );
  assert.ok(t);
  const som = (o: Record<string, number | undefined>) => Object.values(o).reduce((a: number, b) => a + (b ?? 0), 0);
  assert.equal(som(t.gronden), t.geweigerd, "per grond telt op tot het totaal");
  assert.equal(som(t.categorieen), t.geweigerd, "per categorie telt op tot het totaal");
  assert.deepEqual(t.categorieen, { toestemming_geweigerd: 1, providerfout: 1, configuratiefout: 3 });
});

// ── Pariteit: wat de app schrijft, moet de database ook teruggeven ──────────

test("PR-C — elke basis-/bronsleutel uit TypeScript staat óók in `meta_projectie()`", async () => {
  // DE FOUT UIT DE REVIEW: `toelating` stond alleen in de TS-allowlist. De
  // database hanteert een EIGEN allowlist, dus de samenvatting werd opgeslagen
  // en verdween bij het lezen. Dezelfde controle vond ook `gateway` (#311 T3),
  // sinds 766bbe6 in dezelfde toestand. Deze gate leest de NIEUWSTE definitie
  // van `meta_projectie` uit de migraties en eist dat beide lijsten gelijk zijn.
  const { readdirSync, readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");
  const dir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
  const laatste = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => /create or replace function public\.meta_projectie\(/.test(readFileSync(join(dir, f), "utf8")))
    .pop();
  assert.ok(laatste, "er hoort een definitie van meta_projectie te zijn");
  const sql = readFileSync(join(dir, laatste!), "utf8");
  const lijst = (naam: string) => {
    const m = sql.match(new RegExp(`${naam} constant text\\[\\] := array\\[([\\s\\S]*?)\\];`));
    assert.ok(m, `${naam} niet gevonden in ${laatste}`);
    return new Set([...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  };
  const { META_BASIS, META_BRON } = await import("../../core/lib/audit-meta");
  const verschil = (a: Iterable<string>, b: Set<string>) => [...a].filter((x) => !b.has(x)).sort();
  assert.deepEqual(verschil(META_BASIS as readonly string[], lijst("c_basis")), [], `basis ontbreekt in ${laatste}`);
  assert.deepEqual(verschil(META_BRON as readonly string[], lijst("c_bron")), [], `bron ontbreekt in ${laatste}`);
  assert.deepEqual(verschil(lijst("c_basis"), new Set(META_BASIS as readonly string[])), [], "DB-basis kent een sleutel die TS niet kent");
  assert.deepEqual(verschil(lijst("c_bron"), new Set(META_BRON as readonly string[])), [], "DB-bron kent een sleutel die TS niet kent");
});

// ── Providerneutraliteit, statisch afgedwongen ──────────────────────────────

test("PR-C — de poort kent geen providernamen en geen bronsoorten", async () => {
  const { readFileSync } = await import("node:fs");
  const tekst = readFileSync(new URL("../../core/lib/retrieval/toelatingspoort.ts", import.meta.url), "utf8");
  // Alleen de CODE: de kopnoot legt juist uit waaróm deze module
  // providerneutraal is en noemt daarbij providernamen.
  const code = tekst
    .split("\n")
    .filter((r) => !/^\s*(\/\/|\*|\/\*)/.test(r))
    .join("\n");
  // Providernamen en bronsoorten: nergens, ook niet als deel van een woord.
  for (const verboden of ["microsoft", "sharepoint", "supabase", "bronsoort"]) {
    assert.doesNotMatch(code, new RegExp(`\\b${verboden}`, "i"), `de poort mag niet op \`${verboden}\` beslissen`);
  }
  // `provider` als AFZONDERLIJK woord — een eigenschap of vergelijking waarop
  // wordt beslist. De foutcategorie `providerfout` (§4.4) is geen providerkeuze
  // maar een genormaliseerde uitkomst, en valt daar bewust buiten.
  assert.doesNotMatch(code, /\bprovider\b/i, "de poort mag niet op `provider` beslissen");
  assert.match(code, /caps\.permissionProof/, "de belofte van de adapter is het criterium");
});
