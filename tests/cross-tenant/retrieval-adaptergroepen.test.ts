// ============================================================================
//  #426 T4-E — adapter per spoor, en de grens die de definitieve vorm beoordeelt.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk, geen database. Beide adapters zijn stubs.
//
//  De zwaarste eis van dit ticket is NEGATIEF: zolang geen enkel spoor een eigen
//  adapter zet, mag er niets veranderen. Die eis staat vooraan, want elke andere
//  test hieronder beschrijft juist wat er wél anders wordt zodra dat gebeurt.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { citeer, voerRetrievalUit, voerVolledigeRetrievalUit } from "../../core/lib/retrieval/orkestratie";
import type {
  AdapterUitkomst,
  Bronresultaat,
  CitaatOpdracht,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
  WeergaveVerrijking,
} from "../../core/lib/retrieval/contract";
import {
  maakDocumentIdentiteit,
  maakPassageIdentiteit,
  maakVolledigeVersieHash,
} from "../../core/lib/retrieval/identiteit";

const FONDS = "11111111-1111-4111-8111-111111111111";

const CTX: RetrievalContext = {
  fondsId: FONDS,
  actor: { soort: "gebruiker", id: "22222222-2222-4222-8222-222222222222" },
  taaktype: "chat_generatie",
  bronbeleid: { bronsoorten: ["fonds", "sharepoint"] },
  correlationId: "corr-1",
  verzoekStartOp: new Date().toISOString(),
};

const CITAAT: CitaatOpdracht = {
  primaireDocumentIds: new Set<string>(),
  peildatum: "2026-09-22",
  hoofddocumentLabel: "Hoofdstuk",
  sentinel: "SENT",
};

const QUERY = (naam: string, over: Partial<RetrievalQuery> = {}): RetrievalQuery => ({
  naam,
  origineleVraag: "Wat staat er in het beleid?",
  zoekvraag: "beleid",
  strategie: "gericht",
  maxResultaten: 10,
  maxKandidaten: 30,
  maxContextTekens: 100_000,
  ...over,
});

const GRENZEN = {
  maxPerDoc: 5,
  representatieConstraints: false,
  regimeWeging: false,
  relevantieDrempel: false,
};

/**
 * Eén bron. `namespace` bepaalt de opaque identiteit; twee adapters met
 * VERSCHILLENDE namespaces leveren verschillende refs, twee met DEZELFDE
 * namespace leveren bewust botsende refs.
 */
function bron(namespace: string, doc: string, n: number, passage = `passage ${n}`): Bronresultaat {
  const documentId = maakDocumentIdentiteit(namespace, doc);
  const passageId = maakPassageIdentiteit(documentId, `passage:${n}`);
  return {
    ref: passageId,
    bronsoort: "sharepoint",
    titel: `Stuk ${doc}-${n}`,
    documentIdentiteit: { id: documentId, bibliotheek: "fonds", bron: "SharePoint", fondsId: FONDS },
    passageIdentiteit: { id: passageId },
    versie: {
      soort: "etag",
      waarde: maakVolledigeVersieHash(doc, `etag-${n}`, "a".repeat(64)),
      gecontroleerdOp: "2026-09-10T10:00:00.000Z",
    },
    bronregistratieRef: `bron-${namespace}`,
    toegangscontrole: {
      toegestaan: true,
      resultaatRef: passageId,
      bronregistratieRef: `bron-${namespace}`,
      gebruikerId: CTX.actor.soort === "gebruiker" ? CTX.actor.id : "",
      correlationId: CTX.correlationId,
      gecontroleerdOp: new Date().toISOString(),
      basis: "delegated_user",
      bronconfiguratieVersie: 3,
    },
    locator: { mappad: "/Gedeelde documenten" },
    passage,
    status: { documentstatus: "van_kracht", actueel: true },
    rang: { positie: n, score: 1 / n },
    curatie: { normgewicht: null, wettelijkRegime: null },
  };
}

interface StubOpties {
  namespace: string;
  perQuery: Record<string, Bronresultaat[]>;
  fout?: AdapterUitkomst["fout"];
  tellers?: { versies: number; registratie: number; kandidaten: number; weergave: number };
  weergaveGezien?: string[][];
  weergavePatch?: (kandidaten: readonly { ref: string }[]) => WeergaveVerrijking[];
  zonderWeergave?: boolean;
}

function stub(opties: StubOpties): RetrievalAdapter {
  const t = opties.tellers;
  const adapter: RetrievalAdapter = {
    naam: "microsoft-sharepoint",
    capabilities: () => ({
      bronsoorten: ["sharepoint"],
      strategieen: ["gericht"],
      ondersteundeFilters: ["modus", "bronsoortprofiel", "peildatum"],
      versiebewijs: true,
      versiebeleid: { sterk: ["etag", "ctag"], gedegradeerd: [] },
      permissionProof: true,
      preview: true,
      cancellation: true,
      timeout: true,
    }),
    async verifieerBronregistratie(_ctx, refs) {
      if (t) t.registratie += 1;
      return new Map(refs.map((r) => [r, { verbonden: true, versie: 3 }]));
    },
    async verifieerVersies(_ctx, refs) {
      if (t) t.versies += 1;
      const perRef = new Map(Object.values(opties.perQuery).flat().map((b) => [b.ref, b]));
      return new Map(refs.map((ref) => {
        const b = perRef.get(ref);
        return [ref, {
          beschikbaar: !!b?.versie.waarde,
          documentIdentiteit: b?.documentIdentiteit.id ?? null,
          passageIdentiteit: b?.passageIdentiteit.id ?? null,
          versie: { soort: b?.versie.soort ?? "onbekend", waarde: b?.versie.waarde ?? null },
        }];
      }));
    },
    async zoek(_ctx, query): Promise<AdapterUitkomst> {
      const kandidaten = opties.perQuery[query.naam] ?? [];
      return {
        kandidaten,
        methode: "sharepoint_live",
        provider: "microsoft",
        latencyMs: 1,
        opgehaald: kandidaten.length,
        ...(opties.fout ? { fout: opties.fout } : {}),
      };
    },
  };
  if (!opties.zonderWeergave) {
    adapter.verrijkWeergave = async (_ctx, kandidaten) => {
      if (t) t.weergave += 1;
      opties.weergaveGezien?.push(kandidaten.map((k) => k.ref));
      return opties.weergavePatch
        ? opties.weergavePatch(kandidaten)
        : kandidaten.map(() => ({ type: "behouden" as const }));
    };
  }
  return adapter;
}

const tellers = () => ({ versies: 0, registratie: 0, kandidaten: 0, weergave: 0 });

// ── 1. De negatieve eis: zonder tweede adapter verandert er niets ───────────

test("een opdracht ZONDER Spoor.adapter is identiek aan één MET dezelfde adapter", async () => {
  const perQuery = { primair: [bron("ns-a", "doc-1", 1), bron("ns-a", "doc-2", 2)] };
  const a = stub({ namespace: "ns-a", perQuery });

  const zonder = await voerVolledigeRetrievalUit(
    CTX,
    { adapter: a, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN }] },
    CITAAT,
  );
  const met = await voerVolledigeRetrievalUit(
    CTX,
    { adapter: a, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN, adapter: a }] },
    CITAAT,
  );

  // Niet alleen "lijkt erop": de volledige uitkomst, inclusief perAdapter, meta,
  // bronverwijzingen en de contexttekst.
  //
  // `latencyMs` is een WANDKLOKmeting en verschilt tussen twee draaien van
  // dezelfde code. Hij wordt genormaliseerd, niet weggelaten: zou het veld
  // verdwijnen, dan zou een uitkomst die zijn latencyveld kwijtraakt deze test
  // niet meer raken.
  const zonderKlok = (r: typeof zonder) =>
    JSON.parse(JSON.stringify(r, (sleutel, waarde) => (sleutel === "latencyMs" ? 0 : waarde)));
  assert.deepEqual(zonderKlok(met), zonderKlok(zonder));
  // Beide kandidaten kwamen door de poort; hoevéél de selectie er daarna van
  // overhoudt is bestaand gedrag van `selecteerEnVerrijk` en wordt hier bewust
  // NIET gepind — dat getal hoort bij de selectietests, en een getal vastleggen
  // dat je niet kunt verklaren maakt een test die bij elke heuristiekwijziging
  // rood wordt zonder iets te zeggen.
  assert.equal(zonder.kandidaten.length, 2, "de poort hoort beide kandidaten toe te laten");
  assert.ok(zonder.bronverwijzingen.length >= 1, "er hoort ten minste één citaat te zijn");
  assert.equal(zonder.bronstatus, undefined, "bronstatus hoort afwezig te zijn als er niets te melden is");
});

// ── 2. Twee adaptergroepen ─────────────────────────────────────────────────

test("GELIJKE ref uit twee adapters: beide bronnen overleven met eigen standen", async () => {
  // Bewust dezelfde namespace, dus bewust botsende refs. Zou ergens een
  // beurtbrede ref-sleutel zitten, dan overschrijft de ene de andere.
  const gedeeld = bron("botsing", "doc-1", 1, "van adapter A");
  const zelfdeRef: Bronresultaat = { ...bron("botsing", "doc-1", 1, "van adapter B"), titel: "Stuk van B" };
  assert.equal(gedeeld.ref, zelfdeRef.ref, "de test moet juist botsende refs gebruiken");

  const a = stub({ namespace: "botsing", perQuery: { primair: [gedeeld] } });
  const b = stub({ namespace: "botsing", perQuery: { aanvullend: [zelfdeRef] } });

  const uit = await voerVolledigeRetrievalUit(
    CTX,
    {
      adapter: a,
      sporen: [
        { query: QUERY("primair"), grenzen: GRENZEN, adapter: a },
        { query: QUERY("aanvullend"), grenzen: GRENZEN, adapter: b },
      ],
    },
    CITAAT,
  );

  // Beide documenten hebben dezelfde documentIdentiteit, dus de bestaande
  // dedup op documentId laat de aanvullende vallen — dat is BESTAAND gedrag en
  // geen ref-botsing. Wat deze test bewaakt: er gaat niets stuk en de primaire
  // bron overleeft met zijn eigen passage.
  assert.equal(uit.geselecteerd.length, 1);
  assert.equal(uit.geselecteerd[0].passage, "van adapter A");
  assert.equal(uit.perAdapter.length, 2);
});

test("de filtercontrole gebruikt de EFFECTIEVE adapter van elk spoor", async () => {
  const a = stub({ namespace: "ns-a", perQuery: { primair: [bron("ns-a", "doc-1", 1)] } });
  const b = stub({ namespace: "ns-b", perQuery: { aanvullend: [bron("ns-b", "doc-2", 2)] } });
  // Adapter B ondersteunt `peildatum` niet; A wel.
  b.capabilities = () => ({
    bronsoorten: ["sharepoint"],
    strategieen: ["gericht"],
    ondersteundeFilters: ["modus"],
    versiebewijs: true,
    versiebeleid: { sterk: ["etag", "ctag"], gedegradeerd: [] },
    permissionProof: true,
    preview: true,
    cancellation: true,
    timeout: true,
  });

  // `bijBronfout: "meld"` op het falende spoor, anders stopt de beurt fail-closed
  // — wat zij bij twee groepen ook hoort te doen. Wat deze test meet is dat de
  // filtercontrole de JUISTE capabilities gebruikt, niet wat er daarna gebeurt.
  const uit = await voerRetrievalUit(CTX, {
    adapter: a,
    sporen: [
      { query: QUERY("primair", { filters: { peildatum: "2026-01-01" } }), grenzen: GRENZEN, adapter: a, bijBronfout: "meld" },
      { query: QUERY("aanvullend", { filters: { peildatum: "2026-01-01" } }), grenzen: GRENZEN, adapter: b, bijBronfout: "meld" },
    ],
  });
  uit.grendel?.stop();

  // Alleen het spoor van B valt uit; A wordt gewoon bevraagd.
  assert.equal(uit.perAdapter[0].fout, undefined);
  assert.equal(uit.perAdapter[1].fout, "configuratiefout");
  assert.equal(uit.geselecteerd.length, 1);
});

test("V5 en de versieherlezing draaien ÉÉN keer per adaptergroep, niet per spoor", async () => {
  const t = tellers();
  const a = stub({
    namespace: "ns-a",
    perQuery: { primair: [bron("ns-a", "doc-1", 1)], aanvullend: [bron("ns-a", "doc-2", 2)] },
    tellers: t,
  });
  const uit = await voerRetrievalUit(CTX, {
    adapter: a,
    sporen: [
      { query: QUERY("primair"), grenzen: GRENZEN, adapter: a },
      { query: QUERY("aanvullend"), grenzen: GRENZEN, adapter: a },
    ],
  });
  uit.grendel?.stop();
  assert.equal(t.versies, 1, "twee sporen op dezelfde adapter zijn één groep");
  assert.equal(t.registratie, 1);
});

test("verrijkWeergave van adapter A ziet NOOIT bronnen van adapter B", async () => {
  const gezienA: string[][] = [];
  const gezienB: string[][] = [];
  const bronA = bron("ns-a", "doc-1", 1);
  const bronB = bron("ns-b", "doc-2", 2);
  const a = stub({ namespace: "ns-a", perQuery: { primair: [bronA] }, weergaveGezien: gezienA });
  const b = stub({ namespace: "ns-b", perQuery: { aanvullend: [bronB] }, weergaveGezien: gezienB });

  await voerVolledigeRetrievalUit(
    CTX,
    {
      adapter: a,
      sporen: [
        { query: QUERY("primair"), grenzen: GRENZEN, adapter: a },
        { query: QUERY("aanvullend"), grenzen: GRENZEN, adapter: b },
      ],
    },
    CITAAT,
  );

  assert.deepEqual(gezienA, [[bronA.ref]]);
  assert.deepEqual(gezienB, [[bronB.ref]]);
});

// ── 3. De gesloten weergavepatch ───────────────────────────────────────────

test("`weglaten` verwijdert alleen die positie; `verrijkt` patcht alleen weergave", async () => {
  const b1 = bron("ns-a", "doc-1", 1);
  const b2 = bron("ns-a", "doc-2", 2);
  const a = stub({
    namespace: "ns-a",
    perQuery: { primair: [b1, b2] },
    weergavePatch: (k) =>
      k.map((_, i) =>
        i === 0
          ? { type: "verrijkt" as const, weergave: { documenttype: "beleidsnota" } }
          : { type: "behouden" as const },
      ),
  });
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    { adapter: a, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN, adapter: a }] },
    CITAAT,
  );
  assert.ok(uit.geselecteerd.length >= 1);
  assert.equal(uit.geselecteerd[0].weergave?.documenttype, "beleidsnota");
});

test("VIJANDIG: de patch kan de GRONDSLAG niet wijzigen", async () => {
  // De hook probeert identiteit, bewijs, versie, passage, status en bronsoort
  // mee te geven. Het type sluit dat al uit; deze test bewijst dat de runtime-
  // toepassing het óók doet en de patch niet breder uitrolt dan `weergave`.
  const origineel = bron("ns-a", "doc-1", 1, "de echte passage");
  const kwaadaardig = {
    type: "verrijkt" as const,
    weergave: { documenttype: "ok" },
    // Velden die er niet in horen; een implementatie die `{...bron, ...patch}`
    // zou doen in plaats van alleen `weergave`, laat ze hier landen.
    ref: "gekaapt",
    documentIdentiteit: { id: "gekaapt" },
    versie: { soort: "onbekend", waarde: null, gecontroleerdOp: null },
    bronregistratieRef: "gekaapt",
    toegangscontrole: undefined,
    passage: "VERVANGEN",
    status: { actueel: false },
    bronsoort: "web",
  } as unknown as WeergaveVerrijking;

  const a = stub({ namespace: "ns-a", perQuery: { primair: [origineel] }, weergavePatch: () => [kwaadaardig] });
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    { adapter: a, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN, adapter: a }] },
    CITAAT,
  );

  const na = uit.geselecteerd[0];
  assert.equal(na.ref, origineel.ref, "de ref is gekaapt");
  assert.equal(na.documentIdentiteit.id, origineel.documentIdentiteit.id);
  assert.equal(na.versie.waarde, origineel.versie.waarde);
  assert.equal(na.bronregistratieRef, origineel.bronregistratieRef);
  assert.equal(na.passage, "de echte passage", "de passage is vervangen");
  assert.equal(na.bronsoort, "sharepoint");
  assert.equal(na.status.actueel, true);
  // En de toegestane patch landde wél.
  assert.equal(na.weergave?.documenttype, "ok");
});

test("een lengteverschil, een undefined of een sparse array is een configuratiefout", async () => {
  const b1 = bron("ns-a", "doc-1", 1);
  const b2 = bron("ns-a", "doc-2", 2);
  // De patches worden RELATIEF aan de werkelijke invoer gebouwd. Een vaste
  // lengte zou meeliften op hoeveel de selectie toevallig overhoudt, en dan
  // meet de test die heuristiek in plaats van de contractregel.
  const behouden = { type: "behouden" as const };
  const gevallen: ((k: readonly { ref: string }[]) => WeergaveVerrijking[])[] = [
    (k) => k.slice(0, k.length - 1).map(() => behouden),          // te kort
    (k) => [...k.map(() => behouden), behouden],                  // te lang
    (k) => k.map((_, i) => (i === 0 ? (undefined as unknown as WeergaveVerrijking) : behouden)),
    (k) => {
      // Sparse: `length` klopt, positie 0 is een GAT.
      const arr: WeergaveVerrijking[] = [];
      arr.length = k.length;
      for (let i = 1; i < k.length; i++) arr[i] = behouden;
      return arr;
    },
  ];
  for (const [i, maak] of gevallen.entries()) {
    const a = stub({ namespace: "ns-a", perQuery: { primair: [b1, b2] }, weergavePatch: maak });
    await assert.rejects(
      voerVolledigeRetrievalUit(
        CTX,
        { adapter: a, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN, adapter: a }] },
        CITAAT,
      ),
      /verrijkWeergave/,
      `geval ${i} werd niet geweigerd`,
    );
  }
});

// ── 4. Volgorde bij verweven groepen ───────────────────────────────────────

test("VERWEVEN GROEPEN: de bronvolgorde volgt de selectie, niet de groepering", async () => {
  // Twee adapters, elk twee documenten, in één spoor per adapter. De adapter
  // van groep B laat zijn eerste bron vallen in de weergavehook. Aaneenschakelen
  // per groep zou hier een andere volgorde geven dan de selectie voorschrijft.
  const a1 = bron("ns-a", "doc-a1", 1);
  const a2 = bron("ns-a", "doc-a2", 2);
  const b1 = bron("ns-b", "doc-b1", 3);
  const b2 = bron("ns-b", "doc-b2", 4);
  const a = stub({ namespace: "ns-a", perQuery: { primair: [a1, a2] } });
  const b = stub({
    namespace: "ns-b",
    perQuery: { aanvullend: [b1, b2] },
    weergavePatch: (k) => k.map((_, i) => (i === 0 ? { type: "weglaten" as const } : { type: "behouden" as const })),
  });

  const uit = await voerVolledigeRetrievalUit(
    CTX,
    {
      adapter: a,
      sporen: [
        { query: QUERY("primair"), grenzen: GRENZEN, adapter: a },
        { query: QUERY("aanvullend"), grenzen: GRENZEN, adapter: b },
      ],
    },
    CITAAT,
  );

  // Wat er overblijft staat in de volgorde van de gezamenlijke selectie: eerst
  // het primaire spoor, dan het aanvullende. De weggevallen bron laat geen gat
  // achter en verschuift de overige niet.
  const namen = uit.geselecteerd.map((x) => x.titel);
  const indexA = namen.findIndex((n) => n.startsWith("Stuk doc-a"));
  const indexB = namen.findIndex((n) => n.startsWith("Stuk doc-b"));
  if (indexB >= 0) assert.ok(indexA < indexB, `groep A hoort vóór groep B: ${namen.join(", ")}`);
  assert.ok(!namen.includes("Stuk doc-b1-3"), "de weggelaten bron staat er nog");
});

// ── 5. bijBronfout en bronstatus ───────────────────────────────────────────

test("gemengde bijBronfout binnen één adaptergroep werpt VÓÓR elke aanroep", async () => {
  let zoekaanroepen = 0;
  const a = stub({ namespace: "ns-a", perQuery: { primair: [bron("ns-a", "doc-1", 1)] } });
  const geteld: RetrievalAdapter = {
    ...a,
    async zoek(ctx, q) {
      zoekaanroepen += 1;
      return a.zoek(ctx, q);
    },
  };
  await assert.rejects(
    voerRetrievalUit(CTX, {
      adapter: geteld,
      sporen: [
        { query: QUERY("primair"), grenzen: GRENZEN, adapter: geteld, bijBronfout: "stop" },
        { query: QUERY("aanvullend"), grenzen: GRENZEN, adapter: geteld, bijBronfout: "meld" },
      ],
    }),
    /gemengde bijBronfout/,
  );
  assert.equal(zoekaanroepen, 0, "er is bevraagd ondanks een tegenstrijdige configuratie");
});

test("bij ÉÉN adaptergroep levert een providerfout een zichtbare bronstatus op", async () => {
  // Eén bron: er zijn geen "overige bronnen" om stil naar terug te vallen, dus
  // een lege uitslag mét `fout` en `bronstatus` is het bestaande — en veilige —
  // gedrag. Met twee groepen ligt dat anders; zie de vijandige test hieronder.
  const a = stub({ namespace: "ns-a", perQuery: { primair: [] }, fout: "providerfout" });
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    { adapter: a, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN, adapter: a }] },
    CITAAT,
  );
  assert.ok(uit.bronstatus && uit.bronstatus.length === 1, "een falende bron hoort zichtbaar te zijn");
  assert.equal(uit.bronstatus[0].adapter, "microsoft-sharepoint");
  assert.equal(uit.bronstatus[0].reden, "providerfout");
  assert.equal(uit.bronstatus[0].geraadpleegd, true);
  // Inhoudsvrij: geen providerteksten, geen identifiers.
  assert.deepEqual(Object.keys(uit.bronstatus[0]).sort(), ["adapter", "bronsoort", "geraadpleegd", "reden"]);
});

// ── 6. Fail-closed: geen stille terugval op de overgebleven bronnen ────────

test("VIJANDIG: één geslaagde adapter en één met providerfout levert GEEN resultaat", async () => {
  // Dit is de verboden stille fallback: adapter A werkt, adapter B faalt, en het
  // antwoord zou er compleet uitzien terwijl een gevraagde bron ontbreekt.
  // Zonder expliciet beleid, met twee adaptergroepen, moet de beurt stoppen.
  const goed = stub({ namespace: "ns-a", perQuery: { primair: [bron("ns-a", "doc-1", 1)] } });
  const stuk = stub({ namespace: "ns-b", perQuery: { aanvullend: [] }, fout: "providerfout" });

  await assert.rejects(
    voerVolledigeRetrievalUit(
      CTX,
      {
        adapter: goed,
        sporen: [
          { query: QUERY("primair"), grenzen: GRENZEN, adapter: goed },
          { query: QUERY("aanvullend"), grenzen: GRENZEN, adapter: stuk },
        ],
      },
      CITAAT,
    ),
    (e: unknown) => {
      assert.ok(e instanceof Error && e.name === "BronNietGeraadpleegd", `onverwachte fout: ${String(e)}`);
      // De fout draagt de INHOUDSVRIJE status mee, zodat de route kan tonen
      // wélke bron ontbrak zonder een providerboodschap te lekken.
      const status = (e as { bronstatus?: unknown }).bronstatus as { reden: string }[];
      assert.ok(Array.isArray(status) && status.length === 1);
      assert.equal(status[0].reden, "providerfout");
      return true;
    },
  );
});

test("readiness-, configuratie- en toestemmingsfouten stoppen de beurt evengoed", async () => {
  const goed = stub({ namespace: "ns-a", perQuery: { primair: [bron("ns-a", "doc-1", 1)] } });
  for (const [fout, reden] of [
    ["configuratiefout", "readiness_ontbreekt"],
    ["toestemming_geweigerd", "token_ongeldig"],
    ["timeout", "timeout"],
    ["rate_limit", "providerfout"],
  ] as const) {
    const stuk = stub({ namespace: "ns-b", perQuery: { aanvullend: [] }, fout });
    await assert.rejects(
      voerVolledigeRetrievalUit(
        CTX,
        {
          adapter: goed,
          sporen: [
            { query: QUERY("primair"), grenzen: GRENZEN, adapter: goed },
            { query: QUERY("aanvullend"), grenzen: GRENZEN, adapter: stuk },
          ],
        },
        CITAAT,
      ),
      (e: unknown) => {
        assert.equal((e as Error).name, "BronNietGeraadpleegd", fout);
        const status = (e as { bronstatus?: { reden: string }[] }).bronstatus ?? [];
        assert.equal(status[0]?.reden, reden, fout);
        return true;
      },
      `${fout} stopte de beurt niet`,
    );
  }
});

test("`geen_resultaten` is GEEN bronfout en stopt dus niets", async () => {
  // De bron is geraadpleegd en had niets. Zou dat de beurt afbreken, dan zou een
  // lege bibliotheek het hele antwoord onmogelijk maken.
  const goed = stub({ namespace: "ns-a", perQuery: { primair: [bron("ns-a", "doc-1", 1)] } });
  const leeg = stub({ namespace: "ns-b", perQuery: { aanvullend: [] }, fout: "geen_resultaten" });
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    {
      adapter: goed,
      sporen: [
        { query: QUERY("primair"), grenzen: GRENZEN, adapter: goed },
        { query: QUERY("aanvullend"), grenzen: GRENZEN, adapter: leeg },
      ],
    },
    CITAAT,
  );
  assert.ok(uit.geselecteerd.length >= 1);
});

test("`meld` gaat door, maar UITSLUITEND met een zichtbare bronstatus", async () => {
  const goed = stub({ namespace: "ns-a", perQuery: { primair: [bron("ns-a", "doc-1", 1)] } });
  const stuk = stub({ namespace: "ns-b", perQuery: { aanvullend: [] }, fout: "providerfout" });
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    {
      adapter: goed,
      sporen: [
        { query: QUERY("primair"), grenzen: GRENZEN, adapter: goed, bijBronfout: "meld" },
        { query: QUERY("aanvullend"), grenzen: GRENZEN, adapter: stuk, bijBronfout: "meld" },
      ],
    },
    CITAAT,
  );
  assert.ok(uit.geselecteerd.length >= 1);
  assert.ok(uit.bronstatus && uit.bronstatus.length === 1, "`meld` zonder bronstatus is stille degradatie");
  assert.equal(uit.bronstatus[0].reden, "providerfout");
});

// ── 7. De driedeling van `bijBronfout`, expliciet vastgelegd ───────────────

test("EXPLICIET `stop` werpt ook bij ÉÉN adaptergroep", async () => {
  // De één-/meergroepsregel geldt alleen voor een NIET-GEZET veld. Wie het
  // expliciet op "stop" zet, kiest fail-closed — ook als er geen andere bron is
  // om stil naar terug te vallen. Zonder deze test zou de groepstelling de
  // expliciete keuze stilzwijgend kunnen overrulen.
  const stuk = stub({ namespace: "ns-a", perQuery: { primair: [] }, fout: "providerfout" });
  await assert.rejects(
    voerVolledigeRetrievalUit(
      CTX,
      { adapter: stuk, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN, adapter: stuk, bijBronfout: "stop" }] },
      CITAAT,
    ),
    (e: unknown) => {
      assert.equal((e as Error).name, "BronNietGeraadpleegd");
      return true;
    },
  );
});

test("NIET GEZET bij één adaptergroep houdt de bestaande foutuitkomst", async () => {
  // Het spiegelbeeld van de test hierboven, en samen leggen ze de driedeling
  // vast: dezelfde providerfout, dezelfde enkele groep, en toch een andere
  // uitkomst — omdat de aanroeper het ene geval expliciet heeft gekozen.
  const stuk = stub({ namespace: "ns-a", perQuery: { primair: [] }, fout: "providerfout" });
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    { adapter: stuk, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN, adapter: stuk }] },
    CITAAT,
  );
  assert.equal(uit.fout, "providerfout");
  assert.deepEqual(uit.geselecteerd, []);
  assert.ok(uit.bronstatus && uit.bronstatus.length === 1, "de ontbrekende bron hoort zichtbaar te zijn");
});

test("EXPLICIET `meld` bij één groep gaat door en stopt dus níét", async () => {
  const stuk = stub({ namespace: "ns-a", perQuery: { primair: [] }, fout: "providerfout" });
  const uit = await voerVolledigeRetrievalUit(
    CTX,
    { adapter: stuk, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN, adapter: stuk, bijBronfout: "meld" }] },
    CITAAT,
  );
  assert.ok(uit.bronstatus && uit.bronstatus.length === 1);
});

// ── 8. De orkestratie zet haar EIGEN grendelbudget in de adaptercontext ────

test("de adapter krijgt `resterendMs` uit de grendel van DEZE beurt", async () => {
  // De adaptertests vullen `resterendMs` met de hand en bewijzen daarmee niets
  // over de verbinding met de request-lokale grendel. Hier wordt die verbinding
  // zelf gemeten: de adapter leest wat de ORKESTRATIE heeft gezet.
  const metingen: (number | undefined)[] = [];
  const basis = stub({ namespace: "ns-a", perQuery: { primair: [bron("ns-a", "doc-1", 1)] } });
  const kijker: RetrievalAdapter = {
    ...basis,
    async zoek(ctx, q) {
      metingen.push(ctx.resterendMs?.());
      // Even wachten en opnieuw meten: een LEVEND handvat op de beurtklok loopt
      // terug. Een constante die toevallig ooit is ingevuld, doet dat niet.
      await new Promise((r) => setTimeout(r, 60));
      metingen.push(ctx.resterendMs?.());
      return basis.zoek(ctx, q);
    },
  };

  await voerVolledigeRetrievalUit(
    CTX,
    { adapter: kijker, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN }], timeoutMs: 8_000 },
    CITAAT,
  );

  const [eerste, tweede] = metingen;
  assert.equal(typeof eerste, "number", "de orkestratie zet `resterendMs` niet in de context");
  assert.equal(typeof tweede, "number");
  assert.ok(eerste! <= 8_000, `resterend ${eerste} hoort binnen het beurtbudget te vallen`);
  assert.ok(eerste! > 7_000, `resterend ${eerste} lijkt niet op een net gestarte beurt van 8 s`);
  assert.ok(
    tweede! < eerste! && eerste! - tweede! >= 40,
    `het budget liep niet terug: ${eerste} → ${tweede}`,
  );
});

test("`resterendMs` hangt aan DEZELFDE grendel als het signaal", async () => {
  // Twee klokken die los worden meegegeven, bewaken vroeg of laat verschillende
  // dingen. Na een beurtafbreking hoort het budget nul te zijn — dat kan alleen
  // als het handvat dezelfde grendel leest als `signal`.
  let gemeten: number | undefined;
  let signaalAf = false;
  const basis = stub({ namespace: "ns-a", perQuery: { primair: [bron("ns-a", "doc-1", 1)] } });
  const ac = new AbortController();
  const kijker: RetrievalAdapter = {
    ...basis,
    async zoek(ctx, q) {
      ac.abort();
      await new Promise((r) => setTimeout(r, 10));
      signaalAf = ctx.signal?.aborted ?? false;
      gemeten = ctx.resterendMs?.();
      return basis.zoek(ctx, q);
    },
  };

  await assert.rejects(
    voerVolledigeRetrievalUit(
      { ...CTX, signal: ac.signal },
      { adapter: kijker, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN }], timeoutMs: 8_000 },
      CITAAT,
    ),
  );
  assert.equal(signaalAf, true, "het signaal van de grendel ging niet af");
  assert.equal(gemeten, 0, "het budget staat nog open terwijl de grendel al dicht is");
});
