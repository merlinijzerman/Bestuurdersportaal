// ============================================================================
//  W1 — Runner. `--record` legt snapshots vast, `--verify` vergelijkt.
// ----------------------------------------------------------------------------
//  Aannames: de Supabase-CLI-stack draait en `next start` serveert op
//  APP_BASE_URL (de CI-workflow bouwt + start ervoor). De runner seedt de DB
//  deterministisch, haalt per rol een sessiecookie op en draait elk scenario.
//
//  Gebruik:
//    node --env-file=.env.local tests/karakterisering/run.mjs --record
//    node --env-file=.env.local tests/karakterisering/run.mjs --verify
//    …--verify --only=profiel.get.bestuurder     (één scenario)
// ============================================================================
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ENV } from "./config.mjs";
import { seed, adminClient } from "./seed.mjs";
import { sessieCookies } from "./sessie.mjs";
import { scenarios } from "./scenarios.mjs";
import { normaliseerJson, normaliseerHeaders, locatieVorm, stabielJson } from "./normaliseer.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(HIER, "__snapshots__");

const modus = process.argv.includes("--record")
  ? "record"
  : process.argv.includes("--verify")
    ? "verify"
    : process.argv.includes("--authz")
      ? "authz"
      : process.argv.includes("--schema")
        ? "schema"
        : null;
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length) : null;

if (!modus) {
  console.error("Gebruik: run.mjs --record | --verify | --authz | --schema [--only=<slug>]");
  process.exit(2);
}

// Ruw HTTP-verzoek zonder redirects te volgen (nodig voor de 307-redirectcase).
// `rawBody` stuurt de bytes ONGEWIJZIGD mee, zonder JSON.stringify. Nodig voor
// scenario's die juist een kapotte body moeten sturen: `documents/upload`
// parseert de JSON vandaag vóór de sessiecontrole, en dat verschil is alleen te
// meten met een body die niet valide is (W4, #96).
function doeVerzoek({ method, path, cookie, body, rawBody, headers }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, ENV.appBaseUrl);
    const data =
      rawBody !== undefined
        ? Buffer.from(rawBody)
        : body === undefined
          ? null
          : Buffer.from(JSON.stringify(body));
    const h = { ...(headers || {}) };
    if (cookie) h["cookie"] = cookie;
    if (data && !h["content-type"]) h["content-type"] = "application/json";
    if (data) h["content-length"] = String(data.length);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: h },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: headerMap(res.headers), buffer: Buffer.concat(chunks) }));
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// node:http levert headers als plat object; wikkel in een .get() zoals fetch.
function headerMap(obj) {
  return {
    get(naam) {
      const v = obj[naam.toLowerCase()];
      return Array.isArray(v) ? v.join(", ") : v ?? null;
    },
  };
}

function bodySnapshot(res, verwacht) {
  if (verwacht === "bytes") {
    return {
      body_sha256: createHash("sha256").update(res.buffer).digest("hex"),
      body_bytes: res.buffer.length,
    };
  }
  // BESLUIT (W5, #101): `bestand` = status + headers + BYTELENGTE, zonder hash.
  //
  // Voor een xlsx/docx/HTML die een tijdstempel of een gegenereerde datum bevat
  // is `bytes` niet houdbaar: de sha256 verschilt per run of per dag, en dan
  // staat er binnen een week een snapshot dat iemand "even bijwerkt" tot het
  // niets meer toetst. De lengte is wél stabiel — een datum heeft een vaste
  // breedte — en samen met de drie headers dekt dat exact wat de wrapper zou
  // kunnen breken: de statuscode, het content-type, de bestandsnaam, nosniff, en
  // of er überhaupt een volledig bestand uitkomt.
  //
  // Wat dit expliciet NIET toetst is de INHOUD. Dat is een bewuste lacune per
  // route, gemotiveerd in scenarios.mjs — geen stilzwijgende versoepeling. Kies
  // `bytes` waar de bytes wél reproduceerbaar zijn; dat is per route gemeten en
  // niet aangenomen.
  if (verwacht === "bestand") {
    return { body_bytes: res.buffer.length };
  }
  // BESLUIT (W5, #101): `vorm` = status + headers, en de body EXPLICIET niet.
  //
  // Voor `auditdossier?formaat=html` is zelfs de bytelengte niet stabiel: de
  // footer rendert de generatiedatum via toLocaleDateString("nl-NL",
  // {month:"long"}) — "1 mei 2026" en "21 augustus 2026" verschillen in lengte.
  // Een snapshot dat om middernacht of aan het begin van een maand omvalt toetst
  // niets; het leert alleen aan om snapshots bij te werken zonder te kijken.
  //
  // De sleutel heet daarom `body_niet_gekarakteriseerd`: de lacune staat IN het
  // snapshot en is greppable, in plaats van dat hij als weggelaten regel
  // onzichtbaar is. Zie het ontwerpprincipe "een uitzondering is een waarde"
  // in core/lib/route-wrapper.md.
  if (verwacht === "vorm") {
    return { body_niet_gekarakteriseerd: true };
  }
  if (verwacht === "redirect") {
    return { location_vorm: locatieVorm(res.headers.get("location"), ENV.url) };
  }
  // BESLUIT (#311, fase 2B): `sse` = de VOLLEDIGE eventstroom, als lijst van
  // genormaliseerde JSON-events in ontvangstvolgorde.
  //
  // Tot #311 stond de SSE-route bewust buiten het harnas ("W5-lacune"): de
  // stroom kwam uit een echte Opus-aanroep en was dus niet deterministisch. Met
  // de lokale WP4-providerstub (tests/e2e/fixtures/ai-provider-stub.mjs) is de
  // providerkant vast, en dan is de stroom wél reproduceerbaar: dezelfde
  // progress-, meta-, delta-, done- en error-events, byte voor byte. Precies
  // die stroom is het contract dat de gateway-migratie ongewijzigd moet laten.
  //
  // Eén `data:`-regel = één event; niet-JSON-regels (er zouden er geen mogen
  // zijn) blijven als `_niet_json` zichtbaar in plaats van stil weg te vallen.
  if (verwacht === "sse") {
    const tekst = res.buffer.toString("utf8");
    const events = [];
    for (const regel of tekst.split("\n")) {
      if (!regel.startsWith("data:")) continue;
      const ruw = regel.slice("data:".length).trim();
      try {
        events.push(normaliseerJson(JSON.parse(ruw)));
      } catch {
        events.push({ _niet_json: ruw.slice(0, 200) });
      }
    }
    return { events };
  }
  // json (met tekst-fallback zodat een niet-JSON-fout leesbaar blijft).
  const tekst = res.buffer.toString("utf8");
  try {
    return normaliseerJson(JSON.parse(tekst));
  } catch {
    return { _niet_json: tekst.slice(0, 500) };
  }
}

// #311 — scenario's met een externe vereiste (nu alleen de lokale AI-providerstub)
// worden ZICHTBAAR overgeslagen als die ontbreekt, nooit stil. In CI staat de
// stub aan (karakterisering.yml), dus daar draaien ze altijd mee.
function vereisteAanwezig(scenario) {
  if (!scenario.vereist) return true;
  if (scenario.vereist === "ai-stub") return Boolean(ENV.aiStubUrl);
  throw new Error(`${scenario.slug}: onbekende vereiste '${scenario.vereist}'`);
}

async function bouwSnapshot(scenario, ctx) {
  if (scenario.preseed) await scenario.preseed(ctx);
  const cookie = scenario.rol === "anon" ? null : await ctx.cookieVoor(scenario.rol);
  // `idempotentie: true` (#311): een VERSE Idempotency-Key per verzoek. De
  // AI-preflight bindt de sleutel aan de inhoud en weigert hergebruik; een vaste
  // sleutel in de scenariotabel zou vanaf verify-ronde 2 een 409 opleveren en
  // dus niet het pad karakteriseren dat we willen zien. De waarde zelf komt
  // nooit in het snapshot (header-whitelist).
  const headers = scenario.idempotentie
    ? { ...(scenario.headers || {}), "idempotency-key": randomUUID() }
    : scenario.headers;
  const res = await doeVerzoek({
    method: scenario.method,
    path: scenario.path,
    cookie,
    body: scenario.body,
    rawBody: scenario.rawBody,
    headers,
  });
  const snap = {
    status: res.status,
    headers: normaliseerHeaders(res.headers, scenario.headersExtra),
    body: bodySnapshot(res, scenario.verwacht),
  };
  // `nawerk` (#311): extra, genormaliseerde waarneming NÁ de respons — concreet
  // de vingerafdruk van wat de providerstub ontving. Zo karakteriseert het
  // snapshot niet alleen wat de client terugkreeg, maar ook wat er naar de
  // provider ging (model, tokenbudget, sampling, system-/berichthash).
  if (scenario.nawerk) snap.nawerk = normaliseerJson(await scenario.nawerk(ctx, res));
  return snap;
}

async function main() {
  for (const [k, v] of Object.entries({ url: ENV.url, anonKey: ENV.anonKey, serviceKey: ENV.serviceKey })) {
    if (!v) throw new Error(`env ${k} ontbreekt`);
  }
  await mkdir(SNAP_DIR, { recursive: true });

  console.log(`[seed] deterministische seed opbouwen…`);
  const admin = adminClient();
  const { users } = await seed(admin);

  const cookieCache = new Map();
  const ctx = {
    admin,
    users,
    async cookieVoor(rol) {
      if (cookieCache.has(rol)) return cookieCache.get(rol);
      const u = users[rol];
      if (!u) throw new Error(`onbekende rol: ${rol}`);
      const { cookieHeader } = await sessieCookies({ url: ENV.url, anonKey: ENV.anonKey, email: u.email, password: u.password });
      cookieCache.set(rol, cookieHeader);
      return cookieHeader;
    },
  };

  // ── W7 flag-on-modus: toets de draaiende server tegen het autorisatiecontract ──
  // Draait met ENFORCE_CAPABILITY=on in de server-omgeving. Per in-scope scenario:
  //   matrix zegt "403"          → de server MOET 403 geven;
  //   matrix zegt "onveranderd"  → de server MOET dezelfde status geven als het
  //                                byte-identieke vlag-uit-snapshot.
  // Zo is de "28" een tegen de server geverifieerde contractwaarde, geen
  // voorspelling. De statische test w7-autz-matrix.test.ts borgt dat het contract
  // zelf klopt met de code; deze modus borgt dat de server het naleeft.
  if (modus === "authz") {
    // Spiegelt capabilityEnforceVoorOmgeving() bewust inline: run.mjs draait onder
    // kaal node en importeert geen TS. De pure functie in capability-enforce.ts is
    // de bron; wijzigt die van vorm, dan valt deze runner op.
    const enforceAan = (process.env.ENFORCE_CAPABILITY ?? "").trim().toLowerCase() === "on";
    if (enforceAan !== true) {
      throw new Error(
        "run.mjs --authz vereist ENFORCE_CAPABILITY=on in de server- én runner-omgeving; " +
          "anders toets je de vlag-uit-toestand tegen het vlag-aan-contract."
      );
    }
    const { matrix } = JSON.parse(await readFile(join(HIER, "authz-matrix.expected.json"), "utf8"));
    const perSlug = new Map(matrix.map((r) => [r.slug, r]));
    const teDoen = only ? scenarios.filter((s) => s.slug === only) : scenarios;
    let ok = 0, fout = 0;
    const mislukt = [];
    for (const s of teDoen) {
      const cel = perSlug.get(s.slug);
      if (!cel) continue; // buiten W7-scope (niet-gewrapt/machineroute) — niet getoetst
      if (!vereisteAanwezig(s)) {
        console.log(`  ⤳ ${s.slug}  — overgeslagen (vereist ${s.vereist}: niet geconfigureerd)`);
        continue;
      }
      let verwacht;
      if (cel.vlagAan === "403") {
        verwacht = 403;
      } else {
        const snap = JSON.parse(await readFile(join(SNAP_DIR, `${s.slug}.json`), "utf8"));
        verwacht = snap.status;
      }
      const snap = await bouwSnapshot(s, ctx);
      if (snap.status === verwacht) {
        ok++;
      } else {
        console.log(
          `  ✗ ${s.slug}  — verwacht ${verwacht} (${cel.vlagAan}), kreeg ${snap.status}`
        );
        fout++; mislukt.push(s.slug);
      }
    }
    console.log(`\n[authz] ${ok} ok, ${fout} fout (${perSlug.size} in scope van ${teDoen.length}).`);
    if (fout > 0) {
      console.log(`mislukt: ${mislukt.join(", ")}`);
      process.exit(1);
    }
    return;
  }

  // ── W9 flag-on-modus: toets de draaiende server onder ENFORCE_SCHEMA=on ──────
  // Twee claims, allebei tegen de echte server:
  //   Deel 1  GEEN OVER-STRENGHEID. Elk corpus-scenario MOET dezelfde status geven
  //           als zijn byte-identieke vlag-uit-snapshot. De losse schema's
  //           accepteren elke geldige body, dus de vlag mag geen enkel geldig
  //           verzoek breken. Eén afwijking = een schema is strenger dan de code.
  //   Deel 2  DE HANDHAVING VUURT. Een geauthenticeerde KAPOTTE-JSON-body naar elk
  //           van de 7 gesanctioneerde slikkers MOET 400 geven (de schema-poort
  //           slaat toe vóór de handler). Dat is de empirische bevestiging van §7:
  //           statisch afgeleid ≠ gemeten.
  if (modus === "schema") {
    const enforceAan = (process.env.ENFORCE_SCHEMA ?? "").trim().toLowerCase() === "on";
    if (enforceAan !== true) {
      throw new Error(
        "run.mjs --schema vereist ENFORCE_SCHEMA=on in de server- én runner-omgeving; " +
          "anders toets je de vlag-uit-toestand tegen het vlag-aan-contract."
      );
    }
    // Deel 1 — geen over-strengheid.
    const teDoen = only ? scenarios.filter((s) => s.slug === only) : scenarios;
    let ok1 = 0;
    const gewijzigd = [];
    for (const s of teDoen) {
      const snapVerwacht = JSON.parse(await readFile(join(SNAP_DIR, `${s.slug}.json`), "utf8"));
      const nu = await bouwSnapshot(s, ctx);
      if (nu.status === snapVerwacht.status) ok1++;
      else gewijzigd.push(`${s.slug}: was ${snapVerwacht.status}, nu ${nu.status}`);
    }
    console.log(`[schema] Deel 1 — geen over-strengheid: ${ok1}/${teDoen.length} status-ongewijzigd.`);
    for (const g of gewijzigd) console.log(`  ✗ ${g}`);

    // Deel 2 — de handhaving vuurt op de 7 slikkers.
    const SLIKKERS = [
      { naam: "classificatie.terugdraai", method: "POST", re: /^\/api\/classificatie\/[^/]+\/terugdraai$/ },
      { naam: "notulen.bevestig", method: "POST", re: /^\/api\/notulen\/segmenten\/[^/]+\/bevestig$/ },
      { naam: "organisatieprofiel", method: "PUT", re: /^\/api\/organisatieprofiel\/?$/ },
      { naam: "procedures.afschrift", method: "POST", re: /^\/api\/procedures\/[^/]+\/afschrift$/ },
      { naam: "profiel", method: "PATCH", re: /^\/api\/profiel\/?$/ },
      { naam: "risicos", method: "PATCH", re: /^\/api\/risicos\/[^/]+$/ },
      { naam: "vergaderingen.archief", method: "POST", re: /^\/api\/vergaderingen\/[^/]+\/archief$/ },
    ];
    let ok2 = 0;
    const slikkerFout = [];
    for (const sl of SLIKKERS) {
      // Zoek een GEAUTHENTICEERD scenario (rol != anon) voor deze route: geldig pad,
      // geldige sessie. De kapotte body maakt van elke uitkomst een 400 vóór de handler.
      const basis = scenarios.find(
        (s) => s.rol !== "anon" && s.method === sl.method && sl.re.test(s.path.split("?")[0]),
      );
      if (!basis) {
        slikkerFout.push(`${sl.naam}: geen geauthenticeerd scenario om op te bouwen — niet bevestigd`);
        continue;
      }
      const cookie = await ctx.cookieVoor(basis.rol);
      const res = await doeVerzoek({
        method: sl.method,
        path: basis.path,
        cookie,
        rawBody: "{ dit is geen json",
        headers: basis.headers,
      });
      if (res.status === 400) ok2++;
      else slikkerFout.push(`${sl.naam} (${basis.path}): verwacht 400, kreeg ${res.status}`);
    }
    console.log(`[schema] Deel 2 — handhaving op de slikkers: ${ok2}/${SLIKKERS.length} gaven 400 op kapotte JSON.`);
    for (const f of slikkerFout) console.log(`  ✗ ${f}`);

    const fout = gewijzigd.length + slikkerFout.length;
    console.log(`\n[schema] ${fout === 0 ? "GROEN" : "ROOD"}: ${ok1} ongewijzigd, ${ok2}/${SLIKKERS.length} slikkers bevestigd.`);
    if (fout > 0) process.exit(1);
    return;
  }

  const teDraaien = only ? scenarios.filter((s) => s.slug === only) : scenarios;
  if (only && teDraaien.length === 0) throw new Error(`geen scenario met slug ${only}`);

  let ok = 0, fout = 0, overgeslagen = 0;
  const mislukt = [];
  for (const s of teDraaien) {
    if (!vereisteAanwezig(s)) {
      console.log(`  ⤳ ${s.slug}  — overgeslagen (vereist ${s.vereist}: niet geconfigureerd)`);
      overgeslagen++;
      continue;
    }
    const snap = await bouwSnapshot(s, ctx);
    const tekst = stabielJson(snap);
    const pad = join(SNAP_DIR, `${s.slug}.json`);
    if (modus === "record") {
      await writeFile(pad, tekst, "utf8");
      console.log(`  ✎ ${s.slug}  (status ${snap.status})`);
      ok++;
    } else {
      let bestaand;
      try {
        bestaand = await readFile(pad, "utf8");
      } catch {
        console.log(`  ✗ ${s.slug}  — GEEN snapshot (eerst --record)`);
        fout++; mislukt.push(s.slug); continue;
      }
      if (bestaand === tekst) {
        console.log(`  ✓ ${s.slug}`);
        ok++;
      } else {
        console.log(`  ✗ ${s.slug}  — VERSCHIL`);
        toonDiff(bestaand, tekst);
        fout++; mislukt.push(s.slug);
      }
    }
  }

  console.log(
    `\n[${modus}] ${ok} ok, ${fout} fout${overgeslagen ? `, ${overgeslagen} overgeslagen` : ""} (${teDraaien.length} scenario's).`
  );
  if (fout > 0) {
    console.log(`mislukt: ${mislukt.join(", ")}`);
    process.exit(1);
  }
}

function toonDiff(verwacht, gekregen) {
  const a = verwacht.split("\n"), b = gekregen.split("\n");
  const n = Math.max(a.length, b.length);
  let getoond = 0;
  for (let i = 0; i < n && getoond < 30; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) console.log(`      - ${a[i]}`);
      if (b[i] !== undefined) console.log(`      + ${b[i]}`);
      getoond++;
    }
  }
}

main().catch((e) => {
  console.error("\n❌ RUNNER-FOUT:", e.message);
  process.exit(1);
});
