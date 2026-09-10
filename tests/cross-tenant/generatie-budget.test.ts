// ============================================================================
//  #356 (G-13) — Het tijdsbudget van de generatie, en wat er ná een afbreking
//  nog MOET gebeuren.
// ----------------------------------------------------------------------------
//  De les uit PR-B, hier opnieuw toegepast: de fout zit zelden in de nieuwe laag
//  maar in de naad. Voor dit budget zijn de naden: (1) de klem tegen de
//  functieduur, (2) de vertaling van een afbreking naar een AUDITcategorie, en
//  (3) de registratie die stil kan mislukken.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DURATION_MS,
  AFRONDMARGE_MS,
  GENERATIE_TIMEOUT_MIN_MS,
  GENERATIE_TIMEOUT_MAX_MS,
  GENERATIE_TIMEOUT_DEFAULT_MS,
  generatieTimeoutUitConfig,
  effectiefGeneratiebudget,
} from "../../core/lib/generatie-budget";
import { classificeerProviderFout, isGatewayFout } from "../../core/lib/ai-gateway/fout";
import { RetrievalAfgebroken, isAfbreking, redenVan } from "../../core/lib/retrieval/afbreken";
import { foutcategorieVoor } from "../../core/lib/retrieval/orkestratie";

// ── De configuratie ─────────────────────────────────────────────────────────

test("#356 — het generatiebudget faalt veilig op onzin", () => {
  assert.equal(generatieTimeoutUitConfig(90_000), 90_000);
  assert.equal(generatieTimeoutUitConfig(GENERATIE_TIMEOUT_MIN_MS), GENERATIE_TIMEOUT_MIN_MS);
  assert.equal(generatieTimeoutUitConfig(GENERATIE_TIMEOUT_MAX_MS), GENERATIE_TIMEOUT_MAX_MS);
  for (const onzin of [undefined, null, "", "abc", 0, -1, 29_999, 285_001, 300_000, Number.NaN, Infinity]) {
    assert.equal(
      generatieTimeoutUitConfig(onzin),
      GENERATIE_TIMEOUT_DEFAULT_MS,
      `${String(onzin)} moet de veilige default geven — nooit "geen grens"`
    );
  }
});

test("#356 — de bandbreedte past binnen de functieduur ná de marge", () => {
  assert.equal(MAX_DURATION_MS - AFRONDMARGE_MS, GENERATIE_TIMEOUT_MAX_MS, "285 = 300 − 15");
  assert.ok(GENERATIE_TIMEOUT_DEFAULT_MS < GENERATIE_TIMEOUT_MAX_MS, "de default is niet tevens het maximum");
});

// ── De klem (besluit §5b) ───────────────────────────────────────────────────

test("#356 — het budget wordt geklemd op wat er van de functieduur nog over is", () => {
  // Rustige beurt: het geconfigureerde budget wint.
  const rustig = effectiefGeneratiebudget(120_000, 5_000);
  assert.equal(rustig.budgetMs, 120_000);
  assert.ok(rustig.genoeg);

  // Trage retrieval heeft al tijd opgegeten: de klem wint.
  const traag = effectiefGeneratiebudget(120_000, 200_000);
  assert.equal(traag.budgetMs, MAX_DURATION_MS - AFRONDMARGE_MS - 200_000, "285 − 200 = 85 s");
  assert.ok(traag.genoeg);
});

test("#356 — de combinatie die de klem NODIG maakt: beide budgetten op hun maximum", () => {
  // Retrieval mag tot 60 s, generatie tot 285 s. Samen 345 s > 285 s. Zonder
  // klem zou het platform de functie doden vóórdat onze deadline vuurt — en dan
  // verdampt precies de marge die audit en afronding nodig hebben.
  const na60sRetrieval = effectiefGeneratiebudget(GENERATIE_TIMEOUT_MAX_MS, 60_000);
  assert.equal(na60sRetrieval.budgetMs, 225_000, "285 − 60 = 225 s");
  assert.ok(
    na60sRetrieval.budgetMs + 60_000 + AFRONDMARGE_MS <= MAX_DURATION_MS,
    "retrieval + generatie + marge blijft binnen de functieduur"
  );
});

test("#356 — te weinig tijd over betekent NIET beginnen", () => {
  const bijna = effectiefGeneratiebudget(120_000, MAX_DURATION_MS - AFRONDMARGE_MS - 29_999);
  assert.equal(bijna.genoeg, false, "onder de ondergrens van 30 s starten we geen providercall meer");
  const precies = effectiefGeneratiebudget(120_000, MAX_DURATION_MS - AFRONDMARGE_MS - GENERATIE_TIMEOUT_MIN_MS);
  assert.equal(precies.genoeg, true, "precies op de ondergrens mag nog");
});

test("#356 — een gesprongen klok maakt het budget niet negatief", () => {
  // `reedsVerstreken` hoort monotoon te zijn; deze klem is het vangnet als een
  // aanroeper toch een negatieve waarde aanlevert.
  const uitkomst = effectiefGeneratiebudget(120_000, -50_000);
  assert.equal(uitkomst.budgetMs, 120_000);
  assert.ok(uitkomst.genoeg);
});

// ── De AUDITcategorie: timeout is geen annulering ───────────────────────────

test("#356 — een verlopen eigen deadline is `timeout`, geen `geannuleerd`", () => {
  // De naad: onze deadline en een weggelopen bestuurder breken HETZELFDE signaal
  // af. Leest de gateway alleen `signal.aborted`, dan schrijft hij beide als
  // `geannuleerd` in gateway_log en is achteraf niet te zien of het systeem te
  // traag was of de gebruiker weg.
  const ac = new AbortController();
  ac.abort(new RetrievalAfgebroken("timeout"));
  const fout = classificeerProviderFout(new Error("Request was aborted."), ac.signal);
  assert.ok(isGatewayFout(fout));
  assert.equal(fout.categorie, "timeout", "de auditcategorie volgt de OORZAAK, niet de vorm");
  assert.equal(fout.reden, "budget_verlopen");
});

test("#356 — een clientdisconnect blijft `geannuleerd`", () => {
  const ac = new AbortController();
  ac.abort(new RetrievalAfgebroken("annulering"));
  const fout = classificeerProviderFout(new Error("Request was aborted."), ac.signal);
  assert.equal(fout.categorie, "geannuleerd");
  assert.equal(fout.reden, "verzoek_afgebroken");
});

test("#356 — een abort zonder herkenbare reden is conservatief `geannuleerd`", () => {
  const ac = new AbortController();
  ac.abort(); // geen reason
  const fout = classificeerProviderFout(new Error("Request was aborted."), ac.signal);
  assert.equal(fout.categorie, "geannuleerd", "liever aan de gebruiker toeschrijven dan een timeout verzinnen");
});

test("#356 — de SDK-foutvorm alléén is niet genoeg; het signaal is gezaghebbend", () => {
  // Gemeten in @anthropic-ai/sdk@0.39.0: beide abortfouten dragen name "Error".
  const sdkAbort = Object.assign(new Error("Request was aborted."), { name: "Error" });
  const zonderSignaal = classificeerProviderFout(sdkAbort, undefined);
  assert.notEqual(zonderSignaal.categorie, "geannuleerd", "zonder signaal is de vorm niet herkenbaar");
  const ac = new AbortController();
  ac.abort(new RetrievalAfgebroken("annulering"));
  assert.equal(classificeerProviderFout(sdkAbort, ac.signal).categorie, "geannuleerd");
});

// ── De brug terug naar de route ─────────────────────────────────────────────

test("#356 — de route herkent een afgebroken GENERATIE en kent hem de juiste reden toe", () => {
  const ac = new AbortController();
  for (const [reden, verwacht] of [
    ["timeout", "timeout"],
    ["annulering", "annulering"],
  ] as const) {
    const eigen = new AbortController();
    eigen.abort(new RetrievalAfgebroken(reden));
    const gatewayfout = classificeerProviderFout(new Error("Request was aborted."), eigen.signal);
    assert.ok(isAfbreking(gatewayfout), `${reden}: de gatewayvorm moet als afbreking gelden`);
    assert.equal(redenVan(gatewayfout), verwacht);
    assert.equal(foutcategorieVoor(gatewayfout), verwacht, "anders valt de beurt in de generieke serverfout-tak");
  }
  assert.ok(ac);
});

test("#356 — een PROVIDERtimeout is géén afbreking en schakelt de fail-safes niet uit", () => {
  // De SDK-timeout ("Request timed out.") is een providerstoring, geen eigen
  // budget. Zou die als afbreking gelden, dan zouden de terugvallen uitvallen
  // die juist voor providerfouten bestaan.
  const providerTimeout = classificeerProviderFout(new Error("Request timed out."), undefined);
  assert.equal(providerTimeout.categorie, "timeout");
  assert.equal(providerTimeout.reden, "provider_timeout");
  assert.equal(isAfbreking(providerTimeout), false, "een trage provider is geen afgebroken beurt");
  assert.equal(foutcategorieVoor(providerTimeout), null);
});

// ── De registratie mag niet stil mislukken ──────────────────────────────────

test("#356 — de strikte afronding is fail-closed op de retourwaarde", async () => {
  const { rondAfStrikt } = await import("../../core/lib/ai-actie-afronding");
  // De RPC-keten wordt nagebootst tot en met `.abortSignal()`, want die gebruikt
  // de strikte variant om de call ECHT af te breken.
  const client = (uit: { data: unknown; error: unknown }, vertragingMs = 0) =>
    ({
      rpc: () => ({
        abortSignal: (signal: AbortSignal) =>
          new Promise((resolve, reject) => {
            const t = setTimeout(() => resolve(uit), vertragingMs);
            signal.addEventListener("abort", () => {
              clearTimeout(t);
              reject(new Error("AbortError"));
            }, { once: true });
          }),
      }),
    }) as unknown as Parameters<typeof rondAfStrikt>[0];

  assert.equal(await rondAfStrikt(client({ data: true, error: null }), "a1", "mislukt", "generatie:timeout"), true);
  assert.equal(
    await rondAfStrikt(client({ data: null, error: { message: "boem" } }), "a1", "mislukt", "generatie:timeout"),
    false,
    "een RPC-fout is een mislukte afronding"
  );
  assert.equal(
    await rondAfStrikt(client({ data: false, error: null }), "a1", "mislukt", "generatie:timeout"),
    false,
    "`false` betekent: geen rij bijgewerkt — de levenscyclus staat nog open"
  );
  for (const onbekend of [null, undefined, 0, "ok", {}]) {
    assert.equal(
      await rondAfStrikt(client({ data: onbekend, error: null }), "a1", "mislukt", "generatie:timeout"),
      false,
      `${JSON.stringify(onbekend)}: niet-weten is geen succes`
    );
  }
});

test("#356 — de strikte afronding BREEKT de RPC werkelijk af, niet alleen het wachten", async () => {
  const { rondAfStrikt } = await import("../../core/lib/ai-actie-afronding");
  let afgebroken = false;
  const traag = {
    rpc: () => ({
      abortSignal: (signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            afgebroken = true;
            reject(new Error("AbortError"));
          }, { once: true });
        }),
    }),
  } as unknown as Parameters<typeof rondAfStrikt>[0];

  // De aborttimer van `rondAfStrikt` is UNREF'd — terecht, want in productie
  // mag hij een lambda niet openhouden. Maar deze nep-RPC lost nooit op en
  // registreert geen eigen timer, dus zonder dit anker is die unref'd timer het
  // enige dat de event loop nog bezig houdt en mag Node afsluiten. Dat maakte
  // in CI drie tests `cancelled` terwijl er lokaal niets aan de hand leek: een
  // echte RPC heeft een socket, deze niet.
  const anker = setInterval(() => {}, 1_000);
  try {
    const t0 = Date.now();
    assert.equal(await rondAfStrikt(traag, "a1", "mislukt", "generatie:timeout", 60), false);
    assert.ok(afgebroken, "een Promise.race zou de RPC laten dooretteren tot het platform de functie doodt");
    assert.ok(Date.now() - t0 < 1_000, "en hij eet de afrondmarge niet op");
  } finally {
    clearInterval(anker);
  }
});

// ── Statische gates op de route ─────────────────────────────────────────────

test("#356 — de route legt de platformgrens expliciet vast", async () => {
  const { readFileSync } = await import("node:fs");
  const bron = readFileSync(new URL("../../app/api/chat/route.ts", import.meta.url), "utf8");
  assert.match(bron, /export const maxDuration = 300/, "de grens hoort uit de code te blijken, niet uit een dashboard");
  // De klok start in de WRAPPER, niet in de handler: authenticatie, sessieguard
  // en profielresolutie draaien daarvóór terwijl de platformklok al loopt.
  assert.match(bron, /performance\.now\(\) - ctx\.startMonotoonMs/, "de klok komt uit de wrapper");
  // De FASE is expliciet en wordt vóór de budgetcontrole gezet: bij "te weinig
  // tijd over" gooien we vóórdat de grendel bestaat, en afleiden uit de grendel
  // zou die afbreking dan als `retrieval` bestempelen.
  assert.match(bron, /let fase: "retrieval" \| "generatie" = "retrieval";/, "de fase is expliciet");
  const iFase = bron.indexOf('fase = "generatie";');
  const iBudget = bron.indexOf("const budget = effectiefGeneratiebudget(");
  assert.ok(iFase > 0 && iFase < iBudget, "de fase moet VÓÓR de budgetcontrole op generatie staan");
  assert.doesNotMatch(bron, /const fase = generatieGrendel \?/, "niet afleiden uit het bestaan van de grendel");
  assert.match(bron, /signal: generatieGrendel\.signal/, "de generatiecall moet het beurtsignaal krijgen");
  // De SDK-`timeout` BLIJFT staan, maar in zijn eigen rol: hij begrenst
  // uitsluitend time-to-first-byte (gemeten: `clearTimeout` in de `.finally()`
  // van de fetch, die resolvet zodra de headers binnen zijn). De duur van het
  // streamen wordt door het signaal begrensd. Twee grenzen, twee taken.
  assert.match(bron, /timeoutMs: VOLLEDIGE_ANALYSE_GENERATIE_TIMEOUT_MS/, "de TTFB-grens blijft nuttig");
});

test("#356 — SSE-uitvoer en -afsluiting overleven een verbroken verbinding", async () => {
  const { readFileSync } = await import("node:fs");
  const bron = readFileSync(new URL("../../app/api/chat/route.ts", import.meta.url), "utf8");
  // Gemeten: ná een disconnect gooien zowel enqueue als close `TypeError:
  // Invalid state`. Ongeguard overschrijft dat de oorspronkelijke fout.
  assert.match(bron, /const send = \(obj: unknown\) => \{\s*try \{/, "send moet een dode stream verdragen");
  assert.match(bron, /generatieGrendel\?\.stop\(\);\s*try \{\s*controller\.close\(\);/, "de eigenaar sluit vóór de respons");
});
