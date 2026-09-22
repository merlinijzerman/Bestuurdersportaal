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

  const uit = await voerRetrievalUit(CTX, {
    adapter: a,
    sporen: [
      { query: QUERY("primair", { filters: { peildatum: "2026-01-01" } }), grenzen: GRENZEN, adapter: a },
      { query: QUERY("aanvullend", { filters: { peildatum: "2026-01-01" } }), grenzen: GRENZEN, adapter: b },
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

test("een providerfout levert een zichtbare bronstatus op", async () => {
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
