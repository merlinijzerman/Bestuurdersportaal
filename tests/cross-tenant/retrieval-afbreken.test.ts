// ============================================================================
//  #322 F4-T2-1/PR-B — Annulering en deadline: de NADEN.
// ----------------------------------------------------------------------------
//  Vier reviewrondes op PR-A leerden dat de fout hier zelden in de nieuwe laag
//  zit maar in de naad ertussen. Voor cancellation is dat risicoprofiel
//  scherp: het signaal moet ELKE I/O bereiken, en na een afbreking mag GEEN
//  enkele fail-safe alsnog vuren. Deze suite toetst beide, hermetisch.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  maakAfbreekgrendel,
  isAfbreking,
  redenVan,
  slaapMetSignaal,
  bewaakNaIO,
  timeoutUitConfig,
  RetrievalAfgebroken,
  GrendelGesloten,
  TIMEOUT_DEFAULT_MS,
  TIMEOUT_MIN_MS,
  TIMEOUT_MAX_MS,
} from "../../core/lib/retrieval/afbreken";
import { voerRetrievalUit, citeer, foutcategorieVoor } from "../../core/lib/retrieval/orkestratie";
import type {
  Bronresultaat,
  AdapterUitkomst,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
} from "../../core/lib/retrieval/contract";
import { maakDocumentIdentiteit, maakPassageIdentiteit, maakVolledigeVersieHash } from "../../core/lib/retrieval/identiteit";

const CTX: RetrievalContext = {
  fondsId: "11111111-1111-4111-8111-111111111111",
  actor: { soort: "gebruiker", id: "22222222-2222-4222-8222-222222222222" },
  taaktype: "chat_generatie",
  // De suite gebruikt zowel fonds- als synthetische SharePointbronnen. Sinds
  // #369 wordt dit beleid werkelijk afgedwongen, dus beide horen expliciet in
  // de hermetische testcontext.
  bronbeleid: { bronsoorten: ["fonds", "sharepoint"] },
  correlationId: "corr-b",
  verzoekStartOp: new Date().toISOString(),
};

const QUERY = (over: Partial<RetrievalQuery> = {}): RetrievalQuery => ({
  naam: "primair",
  origineleVraag: "v",
  zoekvraag: "v",
  strategie: "gericht",
  maxResultaten: 5,
  maxKandidaten: 20,
  maxContextTekens: 100_000,
  ...over,
});

/** Minimale chunkloze bron voor de gedragstests. */
const bronPerRef = new Map<string, Bronresultaat>();

function bron(ref: string, doc: string, passage: string): Bronresultaat {
  const documentIdentiteit = maakDocumentIdentiteit("afbreektest", doc);
  const passageIdentiteit = maakPassageIdentiteit(documentIdentiteit, ref);
  const resultaat: Bronresultaat = {
    ref: passageIdentiteit, bronsoort: "sharepoint", titel: "T",
    documentIdentiteit: { id: documentIdentiteit, bibliotheek: "fonds", bron: "SharePoint" },
    passageIdentiteit: { id: passageIdentiteit },
    versie: { soort: "etag", waarde: maakVolledigeVersieHash(doc, "etag-1", "a".repeat(64)), gecontroleerdOp: "2026-09-10T10:00:00.000Z" },
    locator: {}, passage, status: { actueel: true }, rang: { positie: 1, score: 1 },
  };
  bronPerRef.set(resultaat.ref, resultaat);
  return resultaat;
}

const verifieerVersies: RetrievalAdapter["verifieerVersies"] = async (_ctx, refs) => new Map(refs.map((ref) => {
  const kandidaat = bronPerRef.get(ref);
  return [ref, {
    beschikbaar: !!kandidaat,
    documentIdentiteit: kandidaat?.documentIdentiteit.id ?? null,
    passageIdentiteit: kandidaat?.passageIdentiteit.id ?? null,
    versie: { soort: kandidaat?.versie.soort ?? "onbekend", waarde: kandidaat?.versie.waarde ?? null },
  }];
}));

const GRENZEN = {
  maxPerDoc: 5,
  representatieConstraints: false,
  regimeWeging: false,
  relevantieDrempel: false,
};

/** Adapter die het signaal doorgeeft aan een langlopende "I/O". */
function traagAdapter(msPerCall: number, gezien: { signal?: AbortSignal }): RetrievalAdapter {
  return {
    naam: "microsoft-sharepoint",
    capabilities: () => ({
      bronsoorten: ["sharepoint"], strategieen: ["gericht"], ondersteundeFilters: [],
      // Deze suite toetst ANNULERING, geen rechten: deze adapters beloven geen
      // bewijs, dus de toelatingspoort eist er ook geen.
      versiebewijs: true, versiebeleid: { sterk: ["etag"], gedegradeerd: [] }, permissionProof: false, preview: false, cancellation: true, timeout: true,
    }),
    async zoek(ctx): Promise<AdapterUitkomst> {
      gezien.signal = ctx.signal;
      // Simuleert I/O die het signaal honoreert — precies wat een echte
      // RPC/fetch doet zodra `.abortSignal()` respectievelijk `signal` is gezet.
      await slaapMetSignaal(msPerCall, ctx.signal);
      return { kandidaten: [], methode: "geen", provider: "microsoft", latencyMs: msPerCall, opgehaald: 0 };
    },
    async verrijkWeergave(_ctx, g) {
      return g;
    },
  };
}

// ── De grendel zelf ─────────────────────────────────────────────────────────

test("PR-B — clientafbraak levert `annulering`, een verlopen deadline `timeout`", () => {
  const ac = new AbortController();
  const g1 = maakAfbreekgrendel(ac.signal, 60_000);
  ac.abort();
  assert.equal(g1.reden(), "annulering");
  assert.throws(() => g1.bewaak(), (e: unknown) => isAfbreking(e) && redenVan(e) === "annulering");
  g1.stop();
});

test("PR-B — een al afgebroken clientsignaal breekt meteen af, niet pas bij de eerste I/O", () => {
  const ac = new AbortController();
  ac.abort();
  const g = maakAfbreekgrendel(ac.signal, 60_000);
  assert.equal(g.reden(), "annulering", "de verbinding was al weg vóór de keten begon");
  g.stop();
});

test("PR-B — de eerste oorzaak wint; een latere gebeurtenis herschrijft haar niet", async () => {
  const ac = new AbortController();
  const g = maakAfbreekgrendel(ac.signal, 20);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(g.reden(), "timeout");
  ac.abort();
  assert.equal(g.reden(), "timeout", "een annulering ná de deadline mag de reden niet omschrijven");
  g.stop();
});

test("PR-B — de deadlineconfiguratie faalt veilig", () => {
  assert.equal(timeoutUitConfig(30_000), 30_000);
  assert.equal(timeoutUitConfig(TIMEOUT_MIN_MS), TIMEOUT_MIN_MS);
  assert.equal(timeoutUitConfig(TIMEOUT_MAX_MS), TIMEOUT_MAX_MS);
  for (const onzin of [undefined, null, "", "abc", 0, -1, 1_000, 120_000, Number.NaN, Infinity]) {
    assert.equal(timeoutUitConfig(onzin), TIMEOUT_DEFAULT_MS, `${String(onzin)} moet de veilige default geven`);
  }
});

test("PR-B — de retry-backoff wacht niet door na een afbreking", async () => {
  const ac = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ac.abort(new RetrievalAfgebroken("annulering")), 20);
  await assert.rejects(() => slaapMetSignaal(5_000, ac.signal), (e: unknown) => isAfbreking(e));
  assert.ok(Date.now() - t0 < 500, "de backoff moet meebreken, niet de volle 5 s uitzitten");
});

// ── Het signaal bereikt de keten ────────────────────────────────────────────

test("PR-B — de adapter krijgt het SAMENGESTELDE signaal, niet het kale clientsignaal", async () => {
  const gezien: { signal?: AbortSignal } = {};
  const ac = new AbortController();
  await voerRetrievalUit(
    { ...CTX, signal: ac.signal },
    { adapter: traagAdapter(1, gezien), sporen: [{ query: QUERY(), grenzen: GRENZEN }] }
  );
  assert.ok(gezien.signal, "de adapter moet een signaal krijgen");
  assert.notEqual(gezien.signal, ac.signal, "het moet het samengestelde signaal zijn — anders geldt de deadline niet");
});

test("PR-B — een verlopen deadline stopt de keten met foutcategorie `timeout`", async () => {
  const gezien: { signal?: AbortSignal } = {};
  await assert.rejects(
    () =>
      voerRetrievalUit(CTX, {
        adapter: traagAdapter(5_000, gezien),
        sporen: [{ query: QUERY(), grenzen: GRENZEN }],
        timeoutMs: TIMEOUT_MIN_MS,
      }),
    (e: unknown) => isAfbreking(e) && foutcategorieVoor(e) === "timeout"
  );
});

test("PR-B — een clientafbraak stopt de keten met foutcategorie `annulering`", async () => {
  const gezien: { signal?: AbortSignal } = {};
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(
    () =>
      voerRetrievalUit(
        { ...CTX, signal: ac.signal },
        { adapter: traagAdapter(5_000, gezien), sporen: [{ query: QUERY(), grenzen: GRENZEN }], timeoutMs: 60_000 }
      ),
    (e: unknown) => isAfbreking(e) && foutcategorieVoor(e) === "annulering"
  );
});

test("PR-B — na een afbreking draait er geen enkele vervolgstap meer", async () => {
  // De naad: `Promise.all` kan al klaar zijn terwijl de grendel intussen is
  // afgegaan. De keten moet dan alsnog stoppen vóór selectie en verrijking.
  const stappen: string[] = [];
  const ac = new AbortController();
  const adapter: RetrievalAdapter = {
    naam: "microsoft-sharepoint",
    capabilities: () => ({
      bronsoorten: ["sharepoint"], strategieen: ["gericht"], ondersteundeFilters: [],
      // Deze suite toetst ANNULERING, geen rechten: deze adapters beloven geen
      // bewijs, dus de toelatingspoort eist er ook geen.
      versiebewijs: true, versiebeleid: { sterk: ["etag"], gedegradeerd: [] }, permissionProof: false, preview: false, cancellation: true, timeout: true,
    }),
    async zoek(): Promise<AdapterUitkomst> {
      stappen.push("zoek");
      // De I/O is klaar; de verbinding valt precies daarna weg.
      ac.abort();
      return { kandidaten: [], methode: "geen", provider: "microsoft", latencyMs: 0, opgehaald: 0 };
    },
    async verrijkSelectie(_c, g) {
      stappen.push("verrijkSelectie");
      return { resultaten: g };
    },
    async verrijkWeergave(_c, g) {
      stappen.push("verrijkWeergave");
      return g;
    },
  };
  await assert.rejects(
    () =>
      voerRetrievalUit(
        { ...CTX, signal: ac.signal },
        { adapter, sporen: [{ query: QUERY(), grenzen: GRENZEN }] }
      ),
    (e: unknown) => isAfbreking(e)
  );
  assert.deepEqual(stappen, ["zoek"], "na de afbreking mag geen selectie- of verrijkingsstap meer draaien");
});

// ── Fail-safes mogen een afbreking niet opeten ──────────────────────────────

test("PR-B — de fail-safes in de keten gooien een afbreking door", async () => {
  // Statische controle op de drie plekken waar de keten bewust terugvalt: de
  // reranker naar de RRF-volgorde, een mislukte query-embedding naar FTS, en
  // een falende hybride RPC naar FTS. Vangen die ook een annulering of
  // deadline, dan doet de keten ná het afbreken alsnog volledig werk.
  const { readFileSync } = await import("node:fs");
  for (const pad of ["../../core/lib/rag.ts", "../../core/lib/rerank.ts"]) {
    const bron = readFileSync(new URL(pad, import.meta.url), "utf8");
    const catches = [...bron.matchAll(/\} catch \((\w+)\) \{([\s\S]{0,400}?)\n  {2,6}\}/g)];
    for (const [, naam, lijf] of catches) {
      const valtTerug = /terugval|fallback|metFallback|RRF-volgorde/i.test(lijf);
      if (!valtTerug) continue;
      assert.match(
        lijf,
        new RegExp(`isAfbreking\\(${naam}\\)`),
        `een terugval in ${pad} vangt ${naam} zonder eerst op afbreking te toetsen`
      );
    }
  }
});

test("PR-B — de rerank breekt zijn eigen modelcall af als hij de race verliest", async () => {
  const { readFileSync } = await import("node:fs");
  const bron = readFileSync(new URL("../../core/lib/rerank.ts", import.meta.url), "utf8");
  // Zonder eigen controller bleef de modelcall na een verloren race gewoon
  // doorlopen — en betaalden we hem alsnog.
  assert.match(bron, /const callCtrl = new AbortController\(\)/);
  assert.match(bron, /signal: callCtrl\.signal/, "de gateway moet het signaal krijgen");
  assert.match(bron, /finally \{[\s\S]*?callCtrl\.abort\(\)/, "een verloren race moet de call afbreken");
});

test("PR-B — elke I/O in de retrievalketen draagt het signaal", async () => {
  const { readFileSync } = await import("node:fs");
  const rag = readFileSync(new URL("../../core/lib/rag.ts", import.meta.url), "utf8");
  // De zoek-RPC's en de fallbackqueries lopen alle door `metSignaal(...)`.
  const rpcs = [...rag.matchAll(/supabase\.rpc\("zoek_chunks[a-z_]*"/g)].length;
  const gekoppeld = [...rag.matchAll(/metSignaal\(/g)].length;
  assert.ok(rpcs >= 3, `verwacht ten minste 3 zoek-RPC's, gevonden ${rpcs}`);
  assert.ok(gekoppeld >= rpcs, `elke zoek-RPC hoort door metSignaal te lopen (${gekoppeld} < ${rpcs})`);

  const embed = readFileSync(new URL("../../core/lib/embeddings.ts", import.meta.url), "utf8");
  assert.match(embed, /fetch\(embedUrl\(\), \{[\s\S]{0,200}?signal,/, "de embedding-fetch moet het signaal dragen");
  assert.match(embed, /slaapMetSignaal\(/, "de retry-backoff moet meebreken");
});

// ── Reviewronde 2: de grendel dekt de HELE keten ────────────────────────────

test("PR-B — een timeout tijdens verrijkSelectie stopt de keten", async () => {
  // De naad: parent-context draait ná de selectie en doet nog database-werk.
  const stappen: string[] = [];
  const adapter: RetrievalAdapter = {
    naam: "microsoft-sharepoint",
    capabilities: () => ({
      bronsoorten: ["sharepoint"], strategieen: ["gericht"], ondersteundeFilters: [],
      // Deze suite toetst ANNULERING, geen rechten: deze adapters beloven geen
      // bewijs, dus de toelatingspoort eist er ook geen.
      versiebewijs: true, versiebeleid: { sterk: ["etag"], gedegradeerd: [] }, permissionProof: false, preview: false, cancellation: true, timeout: true,
    }),
    async zoek(): Promise<AdapterUitkomst> {
      stappen.push("zoek");
      return {
        kandidaten: [bron("sp-1", "doc-a", "passage")],
        methode: "sharepoint_live", provider: "microsoft", latencyMs: 0, opgehaald: 1,
      };
    },
    verifieerVersies,
    async verrijkSelectie(ctx, g) {
      stappen.push("verrijkSelectie");
      await slaapMetSignaal(5_000, ctx.signal); // trage sibling-fetch
      stappen.push("verrijkSelectie-klaar");
      return { resultaten: g };
    },
    async verrijkWeergave(_c, g) {
      stappen.push("verrijkWeergave");
      return g;
    },
  };
  await assert.rejects(
    () => voerRetrievalUit(CTX, { adapter, sporen: [{ query: QUERY(), grenzen: GRENZEN }], timeoutMs: TIMEOUT_MIN_MS }),
    (e: unknown) => isAfbreking(e) && foutcategorieVoor(e) === "timeout"
  );
  assert.deepEqual(stappen, ["zoek", "verrijkSelectie"], "de trage verrijking mag niet afronden");
});

test("PR-B — de deadline loopt DOOR tot en met citeer(); verrijkWeergave valt er niet buiten", async () => {
  // Blokker uit de review: de grendel stopte na fase 1, waardoor de
  // weergaveverrijking (notulen- en documentmetadata, parent-passage) en de
  // contextopbouw buiten de 20 s vielen — en de adapter dus ten onrechte
  // `timeout: true` claimde.
  const stappen: string[] = [];
  const adapter: RetrievalAdapter = {
    naam: "microsoft-sharepoint",
    capabilities: () => ({
      bronsoorten: ["sharepoint"], strategieen: ["gericht"], ondersteundeFilters: [],
      // Deze suite toetst ANNULERING, geen rechten: deze adapters beloven geen
      // bewijs, dus de toelatingspoort eist er ook geen.
      versiebewijs: true, versiebeleid: { sterk: ["etag"], gedegradeerd: [] }, permissionProof: false, preview: false, cancellation: true, timeout: true,
    }),
    async zoek(): Promise<AdapterUitkomst> {
      stappen.push("zoek");
      return {
        kandidaten: [bron("sp-1", "doc-a", "passage")],
        methode: "sharepoint_live", provider: "microsoft", latencyMs: 0, opgehaald: 1,
      };
    },
    verifieerVersies,
    async verrijkWeergave(ctx, g) {
      stappen.push("verrijkWeergave");
      assert.ok(ctx.signal, "de weergaveverrijking hoort het beurtsignaal te krijgen");
      await slaapMetSignaal(5_000, ctx.signal);
      stappen.push("verrijkWeergave-klaar");
      return g;
    },
  };
  const tussen = await voerRetrievalUit(CTX, {
    adapter,
    sporen: [{ query: QUERY(), grenzen: GRENZEN }],
    timeoutMs: TIMEOUT_MIN_MS,
  });
  await assert.rejects(
    () =>
      citeer(CTX, adapter, tussen, {
        primaireDocumentIds: new Set<string>(),
        peildatum: "2026-09-10",
        hoofddocumentLabel: " [hoofddocument]",
        sentinel: "S",
      }),
    (e: unknown) => isAfbreking(e) && foutcategorieVoor(e) === "timeout"
  );
  assert.deepEqual(stappen, ["zoek", "verrijkWeergave"], "de trage weergaveverrijking mag niet afronden");
});

// ── De twee bibliotheekgrenzen ─────────────────────────────────────────────

test("PR-B — een PostgREST-abortRESULTAAT wordt als afbreking herkend, niet als providerfout", async () => {
  // `postgrest-js` GOOIT een abort niet door: hij vangt hem en levert een
  // gewoon `{ error }`-resultaat. Zonder deze herkenning zou een afgebroken
  // hybride RPC als providerfout doorgaan en de FTS-terugval starten.
  const postgrestAbort = {
    message: "AbortError: This operation was aborted",
    details: "",
    hint: "Request was aborted (timeout or manual cancellation)",
    code: "",
  };
  assert.ok(isAfbreking(postgrestAbort), "de vorm die postgrest-js oplevert moet herkend worden");

  // En belangrijker: het SIGNAAL is gezaghebbend, ook als de vorm afwijkt.
  const ac = new AbortController();
  ac.abort(new RetrievalAfgebroken("timeout"));
  assert.throws(
    () => bewaakNaIO(ac.signal, { message: "iets heel anders", code: "500" }),
    (e: unknown) => isAfbreking(e) && redenVan(e) === "timeout"
  );
});

test("PR-B — een gateway-abort (`geannuleerd`) laat de rerank niet terugvallen", () => {
  // De AI-gateway normaliseert een abort naar een eigen fout met categorie
  // `geannuleerd`. Werd die niet herkend, dan viel de reranker terug op de
  // RRF-volgorde en liep de keten na de annulering gewoon door.
  const gatewayAbort = { name: "GatewayFout", categorie: "geannuleerd", reden: "verzoek_afgebroken" };
  assert.ok(isAfbreking(gatewayAbort));
});

test("PR-B — elke PostgREST-call in de keten wordt gevolgd door een signaalcontrole", async () => {
  const { readFileSync } = await import("node:fs");
  for (const pad of ["../../core/lib/rag.ts", "../../core/lib/parent-context.ts"]) {
    const bron = readFileSync(new URL(pad, import.meta.url), "utf8");
    const calls = [...bron.matchAll(/await metSignaal\(/g)].length;
    const controles = [...bron.matchAll(/bewaakNaIO\(/g)].length;
    assert.ok(
      controles >= calls,
      `${pad}: ${calls} gesignaleerde calls maar ${controles} controles — postgrest-js gooit een abort niet door`
    );
  }
});

test("PR-B — de route vertaalt een afbreking naar een eigen pad, niet naar een serverfout", async () => {
  const { readFileSync } = await import("node:fs");
  const bron = readFileSync(new URL("../../app/api/chat/route.ts", import.meta.url), "utf8");
  assert.match(bron, /const afbreekreden = foutcategorieVoor\(streamFout\)/, "de route moet de categorie afleiden");
  // Een annulering betekent dat er niemand meer luistert: geen foutmelding.
  assert.match(bron, /if \(afbreekreden === "timeout"\)/, "alleen een timeout hoort de gebruiker te bereiken");
  // …en de categorie moet DUURZAAM landen, niet alleen in een console-regel.
  // Sinds #356 via de STRIKTE variant: die telt een RPC-fout én `data === false`
  // als mislukking, waar `rondAf` beide inslikt.
  assert.match(
    bron,
    /await rondAfStrikt\(\s*supabase,\s*aiActieId,\s*"mislukt",\s*`\$\{fase\}:\$\{afbreekreden\}`/,
    "de afbrekingsreden hoort via de strikte afronding op de ai_actie te landen"
  );
  assert.match(bron, /let fase: "retrieval" \| "generatie" = "retrieval";/, "de fase is expliciet, niet afgeleid");
  assert.match(bron, /\[chat\]\[ALARM\] ai_actie niet afgerond/, "een niet-gesloten levenscyclus hoort een operationeel signaal te geven");
});

// ── Reviewronde 2: de LEVENSLOOP van de grendel ─────────────────────────────

test("PR-B — een gesloten grendel bewaakt niets meer, en zegt dat ook", async () => {
  // De gevaarlijkste toestand die deze module kan hebben: gesloten, maar van
  // buiten niet te onderscheiden van lopend. `reden()` blijft null en
  // `signal.aborted` blijft false, dus wie op de oude `bewaak()` vertrouwde
  // kreeg stilzwijgend GEEN bewaking. Nu faalt dat luid.
  const ac = new AbortController();
  const g = maakAfbreekgrendel(ac.signal, 30);
  assert.equal(g.gesloten(), false);
  g.stop();
  assert.equal(g.gesloten(), true);
  await slaapMetSignaal(80).catch(() => {});
  assert.equal(g.reden(), null, "een gesloten grendel breekt niet alsnog af");
  assert.equal(g.signal.aborted, false);
  assert.throws(() => g.bewaak(), GrendelGesloten, "werk buiten de levensduur hoort luid te falen");
  assert.equal(isAfbreking(new GrendelGesloten()), false, "een programmeerfout is geen annulering");
  g.stop(); // idempotent
});

test("PR-B — `citeer()` laat de grendel niet achter in het eindresultaat", async () => {
  const adapter: RetrievalAdapter = {
    naam: "microsoft-sharepoint",
    capabilities: () => ({
      bronsoorten: ["sharepoint"], strategieen: ["gericht"], ondersteundeFilters: [],
      // Deze suite toetst ANNULERING, geen rechten: deze adapters beloven geen
      // bewijs, dus de toelatingspoort eist er ook geen.
      versiebewijs: true, versiebeleid: { sterk: ["etag"], gedegradeerd: [] }, permissionProof: false, preview: false, cancellation: true, timeout: true,
    }),
    async zoek(): Promise<AdapterUitkomst> {
      return {
        kandidaten: [bron("sp-1", "doc-a", "een passage over uitbesteding")],
        methode: "sharepoint_live", provider: "microsoft", latencyMs: 0, opgehaald: 1,
      };
    },
    verifieerVersies,
  };
  const tussen = await voerRetrievalUit(CTX, { adapter, sporen: [{ query: QUERY(), grenzen: GRENZEN }] });
  assert.ok(tussen.grendel, "fase 1 draagt de grendel wél");

  const voltooid = await citeer(CTX, adapter, tussen, {
    primaireDocumentIds: new Set<string>(), peildatum: "2026-09-10",
    hoofddocumentLabel: " [hoofddocument]", sentinel: "S",
  });
  assert.equal(
    "grendel" in voltooid, false,
    "het eindresultaat is pure data — een gesloten handvat hoort er niet in, ook niet gelogd"
  );
  assert.equal(tussen.grendel?.gesloten(), true, "en hij is wel degelijk gesloten");
});

test("PR-B — tweemaal citeren draait de tweede keer niet ZONDER deadline", async () => {
  // De naad: `stop()` in het `finally` maakte de grendel dood, maar
  // `tussen.grendel` bleef ernaar wijzen. Een tweede `citeer()` zou daardoor
  // een onbegrensde ronde doen — stil, want een dode grendel gooide niets.
  const adapter: RetrievalAdapter = {
    naam: "microsoft-sharepoint",
    capabilities: () => ({
      bronsoorten: ["sharepoint"], strategieen: ["gericht"], ondersteundeFilters: [],
      // Deze suite toetst ANNULERING, geen rechten: deze adapters beloven geen
      // bewijs, dus de toelatingspoort eist er ook geen.
      versiebewijs: true, versiebeleid: { sterk: ["etag"], gedegradeerd: [] }, permissionProof: false, preview: false, cancellation: true, timeout: true,
    }),
    async zoek(): Promise<AdapterUitkomst> {
      return {
        kandidaten: [bron("sp-1", "doc-a", "een passage over uitbesteding")],
        methode: "sharepoint_live", provider: "microsoft", latencyMs: 0, opgehaald: 1,
      };
    },
    verifieerVersies,
  };
  const tussen = await voerRetrievalUit(CTX, { adapter, sporen: [{ query: QUERY(), grenzen: GRENZEN }] });
  const opdracht = {
    primaireDocumentIds: new Set<string>(), peildatum: "2026-09-10",
    hoofddocumentLabel: " [hoofddocument]", sentinel: "S",
  };
  await citeer(CTX, adapter, tussen, opdracht);
  await assert.rejects(() => citeer(CTX, adapter, tussen, opdracht), GrendelGesloten);
});

test("PR-B — een grendel die `stop()` nooit haalt, laat geen luisteraar achter", async () => {
  // Fase 1 kan slagen zonder dat fase 2 volgt (een consument die alleen
  // kandidaten nodig heeft). Zonder zelfopruiming bleef er dan een
  // abort-luisteraar op het clientsignaal staan én liep de timer door.
  const ac = new AbortController();
  const g = maakAfbreekgrendel(ac.signal, 30); // en nooit `stop()`
  await slaapMetSignaal(80).catch(() => {});
  assert.equal(g.reden(), "timeout", "de deadline vuurt");
  // Ná het vuren is de luisteraar weg: een latere clientafbraak verandert niets
  // meer, en er is dus niets meer aan het clientsignaal gekoppeld.
  ac.abort();
  assert.equal(g.reden(), "timeout");
});

test("PR-B — de rerank haakt pas aan ná de poortweigering, niet ervóór", async () => {
  // Statisch, want de weigering ligt vóór de `try` en dus vóór het `finally`
  // dat opruimt. Stond het aanhaken erboven, dan bleef er op dat pad een
  // luisteraar op het beurtsignaal achter — dezelfde levensloopfout als bij de
  // grendel, in het klein.
  const { readFileSync } = await import("node:fs");
  const bron = readFileSync(new URL("../../core/lib/rerank.ts", import.meta.url), "utf8");
  const weigering = bron.indexOf('metFallback(kandidaten, "geen_poortcontext"');
  const aanhaken = bron.indexOf('addEventListener("abort", opBuitenAbort');
  assert.ok(weigering > 0 && aanhaken > 0, "beide plekken moeten bestaan");
  assert.ok(
    aanhaken > weigering,
    "eerst weigeren, dan pas resources aanhaken — anders lekt de weigeringsuitgang"
  );
});
