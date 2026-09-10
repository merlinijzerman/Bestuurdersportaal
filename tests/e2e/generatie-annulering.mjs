// ============================================================================
//  #356 (G-13) — ECHTE afbrekingen middenin een generatie: annulering én timeout.
// ----------------------------------------------------------------------------
//  Waarom dit geen node:test-suite is: `req.signal`, een gesloten
//  ReadableStream en de werkelijke levensduur van een providercall zijn
//  RUNTIMEgedrag van Next. Een gesimuleerd AbortController-signaal bewijst
//  daarover niets — het bewijst alleen dat onze eigen code een signaal doorgeeft.
//  Deze test breekt echte HTTP-verbindingen af, laat een echte deadline
//  verlopen, en kijkt daarna in de database wat er van de beurt is vastgelegd.
//
//  TWEE SCENARIO'S
//    A. annulering — de bestuurder verbreekt de verbinding tijdens het genereren.
//    B. timeout    — de deadline verloopt terwijl de provider nog streamt.
//       Daarvoor zetten we `generatie_timeout_ms` in de WEGWERPdatabase tijdelijk
//       op de ondergrens (30 s) en zwijgt de stub langer. Geen productietestvlag:
//       de begrenzing IS al een fondsvlag, dus die gebruiken we — en zetten hem
//       in `finally` terug, ook als de test faalt.
//
//  ⚠ DEZE TEST WIJZIGT FONDSCONFIGURATIE EN LAAT EEN SPOOR NA.
//  Scenario B zet `generatie_timeout_ms` en verwijdert hem daarna weer, maar de
//  trigger `fn_fonds_config_capture` schrijft elke configwijziging weg in
//  `fonds_config_log` — en die tabel is APPEND-ONLY (`fn_log_append_only`), dus
//  dat spoor is per ontwerp niet op te ruimen. De instellingen-goldens
//  (`instellingen.get.beheerder`, `w4.instellingen.get.bestuurder`) bevatten het
//  historieveld en vallen daardoor om zodra deze test eerder heeft gedraaid.
//
//  DUS: draai deze test ALTIJD ná het karakteriseringsharnas, op een
//  wegwerpdatabase, en gooi de stack daarna weg. Dat is geen tekortkoming van de
//  test maar van de combinatie: een echte configwijziging hoort een auditregel
//  op te leveren, en een golden die het historieveld pint hoort dat te zien.
//
//  Voorwaarden (zelfde recept als het karakteriseringsharnas):
//    • gebouwde app op APP_BASE_URL (`npm run build && PORT=3000 npm run start`)
//    • de WP4-providerstub op 8790 met een TRAGE tweede delta:
//        WP4_AI_STUB_DELTA1_MS=300 WP4_AI_STUB_DELTA2_MS=45000 \
//          node tests/e2e/fixtures/ai-provider-stub.mjs
//    • .env.local met de lokale Supabase-sleutels
//
//  Draaien:  node --env-file=.env.local tests/e2e/generatie-annulering.mjs
// ============================================================================
import pg from "pg";
import { randomUUID } from "node:crypto";
import { sessieCookies } from "../karakterisering/sessie.mjs";
import { ENV, FONDS_ID, WACHTWOORD, emailVoor } from "../karakterisering/config.mjs";

const BASIS = ENV.appBaseUrl;
// Dezelfde vraag als de w311-SSE-golden: die loopt aantoonbaar door tot de
// generatie. Een vagere vraag valt in de verduidelijkingstak — een eigen stream
// zonder providercall, en dan valt er niets af te breken.
const VRAAG = "Wat is een beleidsdekkingsgraad?";

// DIRECTE databaseverbinding, geen PostgREST: `ai_gateway_private` staat bewust
// niet in de blootgestelde schema's — dat is precies de bedoeling van dat
// schema. Alleen de test kijkt hier binnen.
const DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const db = new pg.Client({ connectionString: DB_URL });

let fouten = 0;
function toets(naam, ok, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✖"} ${naam}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fouten++;
}

async function gatewayRegels(sinds) {
  const { rows } = await db.query(
    `select taaktype, resultaat, correlatie_id, actie_id, aangemaakt
       from ai_gateway_private.gateway_log
      where aangemaakt >= $1
      order by aangemaakt desc limit 20`,
    [sinds]
  );
  return rows;
}

/**
 * DE actie die bij deze beurt hoort, opgezocht via het `actie_id` uit de
 * gatewaylogregel. "Nieuwste rij sinds tijdstip" kan bij parallel werk de
 * verkeerde beurt beoordelen — en dan toetst de test iets anders dan het
 * scenario dat hij net heeft uitgelokt.
 */
async function actieVoor(actieId) {
  const { rows } = await db.query(
    `select id, status, resultaat_ref, gestart_op from public.ai_actie where id = $1`,
    [actieId]
  );
  return rows[0] ?? null;
}

/** De vlag zoals we hem AANTROFFEN — inclusief "bestond niet". */
async function leesGeneratieBudget() {
  const { rows } = await db.query(
    `select waarde from public.fonds_feature_flags
      where fonds_id = $1 and flag_key = 'generatie_timeout_ms'`,
    [FONDS_ID]
  );
  return rows.length === 0 ? { bestond: false } : { bestond: true, waarde: rows[0].waarde };
}

async function zetGeneratieBudget(waarde) {
  await db.query(
    `insert into public.fonds_feature_flags (fonds_id, flag_key, waarde)
          values ($1, 'generatie_timeout_ms', $2::jsonb)
     on conflict (fonds_id, flag_key) do update set waarde = excluded.waarde`,
    [FONDS_ID, JSON.stringify(waarde)]
  );
}

/**
 * Herstelt EXACT de aangetroffen toestand. Blind verwijderen zou een fonds dat
 * de vlag wél had stilzwijgend terugzetten op de default — een test hoort de
 * omgeving achter te laten zoals hij hem vond.
 */
async function herstelGeneratieBudget(begintoestand) {
  if (begintoestand.bestond) {
    await zetGeneratieBudget(begintoestand.waarde);
    console.log(`  · generatie_timeout_ms hersteld op ${JSON.stringify(begintoestand.waarde)}`);
  } else {
    await db.query(
      `delete from public.fonds_feature_flags where fonds_id = $1 and flag_key = 'generatie_timeout_ms'`,
      [FONDS_ID]
    );
    console.log("  · generatie_timeout_ms verwijderd (bestond niet vooraf)");
  }
}

/** Tellers van de providerstub: hoeveel calls er kwamen (retry-bewijs). */
async function stubTellers() {
  const res = await fetch("http://127.0.0.1:8790/stats").catch(() => null);
  return res && res.ok ? await res.json() : null;
}

/**
 * LEVENSLOOP van de providerstreams. `streams +1` bewijst alleen dat er geen
 * tweede call kwam; deze tellers bewijzen dat de OORSPRONKELIJKE verbinding
 * werkelijk is afgebroken en niet stilletjes is uitgelopen.
 */
async function stubLevensloop() {
  const res = await fetch("http://127.0.0.1:8790/levensloop").catch(() => null);
  return res && res.ok ? await res.json() : null;
}

function toetsLevensloop(voor, na, label) {
  if (!voor || !na) return;
  toets(`${label}: precies één stream vroegtijdig gesloten`, na.afgebroken - voor.afgebroken === 1, `${na.afgebroken - voor.afgebroken}`);
  toets(`${label}: geen actieve stream meer bij de provider`, na.actief === 0, `${na.actief} actief`);
  toets(`${label}: de stream is NIET netjes voltooid`, na.voltooid - voor.voltooid === 0, `${na.voltooid - voor.voltooid}`);
  toets(`${label}: geen tweede delta geschreven`, na.tweedeDeltas - voor.tweedeDeltas === 0, `${na.tweedeDeltas - voor.tweedeDeltas}`);
}

/**
 * Voert één beurt uit. `bijGeneratie` wordt aangeroepen zodra de generatie
 * aantoonbaar is begonnen — dat is het VOORTGANGSevent, niet een tekstdelta: de
 * route houdt een staart ter grootte van de vervolgvragenmarker achter, dus bij
 * een korte eerste delta komt er nog niets naar buiten. Wachten op tekst zou de
 * hele stream uitlezen en dan valt er niets meer af te breken.
 */
async function beurt({ bijGeneratie, signal } = {}) {
  const { cookieHeader } = await sessieCookies({
    url: ENV.url,
    anonKey: ENV.anonKey,
    email: emailVoor("bestuurder"),
    password: WACHTWOORD,
  });
  const gebeurtenissen = [];
  let generatieBegonnen = false;

  const res = await fetch(`${BASIS}/api/chat`, {
    method: "POST",
    // Een VERSE sleutel per verzoek: de AI-preflight bindt hem aan de inhoud en
    // weigert hergebruik.
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ vraag: VRAAG }),
    signal,
  });
  if (res.status !== 200) {
    const tekst = await res.text().catch(() => "");
    throw new Error(`status ${res.status} — ${tekst.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // BUFFEREND parsen: één SSE-event kan over meerdere netwerkchunks verdeeld
  // aankomen. Per chunk splitsen zou zo'n event stilzwijgend missen — en dan
  // ziet de test het generatie-voortgangsevent niet, breekt hij te laat af, en
  // slaagt hij om de verkeerde reden.
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE-events worden gescheiden door een lege regel.
      let grens;
      while ((grens = buffer.indexOf("\n\n")) !== -1) {
        const blok = buffer.slice(0, grens);
        buffer = buffer.slice(grens + 2);
        for (const regel of blok.split("\n")) {
          if (!regel.startsWith("data: ")) continue;
          let o;
          try {
            o = JSON.parse(regel.slice(6));
          } catch {
            continue;
          }
          gebeurtenissen.push(o);
          if (!generatieBegonnen && o.type === "progress" && o.fase === "generatie" && o.status === "bezig") {
            generatieBegonnen = true;
            if (bijGeneratie) await bijGeneratie();
          }
        }
      }
    }
  } catch {
    /* verwacht in scenario A: de lezer is afgebroken */
  }
  return { gebeurtenissen, generatieBegonnen };
}

// ── Gedeelde controles op de vastlegging ────────────────────────────────────

/**
 * Toetst het duurzame spoor. De `ai_actie` wordt opgezocht via het `actie_id`
 * uit de gatewaylogregel, zodat we gegarandeerd DEZE beurt beoordelen.
 */
async function toetsVastlegging(sinds, verwachtResultaat, verwachtRef) {
  const generatie = (await gatewayRegels(sinds)).filter((r) => r.taaktype === "chat_generatie");
  toets("er is een gatewaylogregel voor de generatie", generatie.length > 0, `${generatie.length} regels`);
  if (generatie.length === 0) return;

  const regel = generatie[0];
  toets(`\`gateway_log.resultaat = ${verwachtResultaat}\``, regel.resultaat === verwachtResultaat, `${regel.resultaat}`);
  toets("de regel draagt een correlatie-id", (regel.correlatie_id ?? "").length >= 8);
  toets("de regel draagt het actie-id van deze beurt", Boolean(regel.actie_id), `${regel.actie_id}`);
  if (!regel.actie_id) return;

  const actie = await actieVoor(regel.actie_id);
  toets("de bijbehorende ai_actie bestaat", actie !== null);
  if (!actie) return;
  toets("de actie eindigt NIET als voltooid", actie.status !== "voltooid", `status=${actie.status}`);
  toets("`ai_actie.status = mislukt`", actie.status === "mislukt", `status=${actie.status}`);
  toets(`\`resultaat_ref = ${verwachtRef}\``, actie.resultaat_ref === verwachtRef, `${actie.resultaat_ref}`);
}

// ── A. Clientdisconnect ─────────────────────────────────────────────────────

async function scenarioAnnulering() {
  console.log("\n── A. de bestuurder verbreekt de verbinding tijdens het genereren ──");
  const sinds = new Date(Date.now() - 2_000).toISOString();
  const ctrl = new AbortController();
  const tellersVoor = await stubTellers();
  const levensloopVoor = await stubLevensloop();

  let uitkomst;
  try {
    uitkomst = await beurt({
      signal: ctrl.signal,
      bijGeneratie: async () => {
        // Even doorlopen zodat de providercall echt onderweg is; de stub houdt
        // de stream daarna nog tientallen seconden open.
        await new Promise((r) => setTimeout(r, 1_000));
        ctrl.abort(); // ECHTE disconnect: de socket gaat dicht
      },
    });
  } catch (e) {
    if (!/abort/i.test(String(e))) throw e;
    uitkomst = { gebeurtenissen: [], generatieBegonnen: true };
  }

  toets("de generatie is aantoonbaar begonnen vóór de afbreking", uitkomst.generatieBegonnen);
  toets("geen `done`-event", !uitkomst.gebeurtenissen.some((e) => e.type === "done"));

  await new Promise((r) => setTimeout(r, 3_000));
  await toetsVastlegging(sinds, "geannuleerd", "generatie:annulering");

  const tellersNa = await stubTellers();
  if (tellersVoor && tellersNa) {
    toets(
      "geen tweede providercall (geen retry)",
      tellersNa.streams - tellersVoor.streams === 1,
      `${tellersNa.streams - tellersVoor.streams} streams`
    );
  }
  toetsLevensloop(levensloopVoor, await stubLevensloop(), "annulering");
}

// ── B. Verlopen deadline ────────────────────────────────────────────────────

async function scenarioTimeout() {
  console.log("\n── B. de deadline verloopt terwijl de provider nog streamt ──");
  const sinds = new Date(Date.now() - 2_000).toISOString();
  const tellersVoor = await stubTellers();
  const levensloopVoor = await stubLevensloop();

  // Wat we AANTREFFEN, zodat we exact dat kunnen terugzetten.
  const begintoestand = await leesGeneratieBudget();
  // Ondergrens van de band: 30 s. De stub zwijgt langer, dus de deadline wint.
  // Let op: dit schrijft een APPEND-ONLY regel in `fonds_config_log` die niet
  // meer weg kan — zie de waarschuwing bovenaan dit bestand.
  await zetGeneratieBudget(30_000);
  try {
    const t0 = Date.now();
    const { gebeurtenissen, generatieBegonnen } = await beurt();
    const duur = Date.now() - t0;

    toets("de generatie is aantoonbaar begonnen", generatieBegonnen);
    toets(
      "de beurt stopte op ONZE deadline, niet bij de provider",
      duur >= 30_000 && duur < 44_000,
      `${duur} ms (stub zwijgt 45 s)`
    );

    const foutEvents = gebeurtenissen.filter((e) => e.type === "error");
    toets("er is precies één timeout-melding voor de bestuurder", foutEvents.length === 1, `${foutEvents.length}`);
    if (foutEvents.length === 1) {
      toets(
        "de melding gaat over het OPSTELLEN, niet over het zoeken",
        /opstellen van het antwoord/i.test(foutEvents[0].error ?? ""),
        foutEvents[0].error
      );
    }
    toets("geen `done`-event", !gebeurtenissen.some((e) => e.type === "done"));

    await new Promise((r) => setTimeout(r, 3_000));
    await toetsVastlegging(sinds, "timeout", "generatie:timeout");

    const tellersNa = await stubTellers();
    if (tellersVoor && tellersNa) {
      toets(
        "geen tweede providercall (geen retry)",
        tellersNa.streams - tellersVoor.streams === 1,
        `${tellersNa.streams - tellersVoor.streams} streams`
      );
    }
    toetsLevensloop(levensloopVoor, await stubLevensloop(), "timeout");
  } finally {
    await herstelGeneratieBudget(begintoestand);
  }
}

async function main() {
  await db.connect();
  try {
    await scenarioAnnulering();
    await scenarioTimeout();
  } finally {
    await db.end();
  }
  console.log(
    fouten === 0 ? "\nGROEN: annulering én timeout end-to-end bewezen." : `\nROOD: ${fouten} controle(s) gefaald.`
  );
  process.exit(fouten === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FOUT:", e instanceof Error ? e.message : e);
  process.exit(1);
});
