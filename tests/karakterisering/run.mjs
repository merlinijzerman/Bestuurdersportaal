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
import { createHash } from "node:crypto";
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

const modus = process.argv.includes("--record") ? "record" : process.argv.includes("--verify") ? "verify" : null;
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length) : null;

if (!modus) {
  console.error("Gebruik: run.mjs --record | --verify [--only=<slug>]");
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
  // json (met tekst-fallback zodat een niet-JSON-fout leesbaar blijft).
  const tekst = res.buffer.toString("utf8");
  try {
    return normaliseerJson(JSON.parse(tekst));
  } catch {
    return { _niet_json: tekst.slice(0, 500) };
  }
}

async function bouwSnapshot(scenario, ctx) {
  if (scenario.preseed) await scenario.preseed(ctx);
  const cookie = scenario.rol === "anon" ? null : await ctx.cookieVoor(scenario.rol);
  const res = await doeVerzoek({
    method: scenario.method,
    path: scenario.path,
    cookie,
    body: scenario.body,
    rawBody: scenario.rawBody,
    headers: scenario.headers,
  });
  return {
    status: res.status,
    headers: normaliseerHeaders(res.headers, scenario.headersExtra),
    body: bodySnapshot(res, scenario.verwacht),
  };
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

  const teDraaien = only ? scenarios.filter((s) => s.slug === only) : scenarios;
  if (only && teDraaien.length === 0) throw new Error(`geen scenario met slug ${only}`);

  let ok = 0, fout = 0;
  const mislukt = [];
  for (const s of teDraaien) {
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

  console.log(`\n[${modus}] ${ok} ok, ${fout} fout (${teDraaien.length} scenario's).`);
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
