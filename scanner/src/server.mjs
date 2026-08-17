// ============================================================================
//  scanner/src/server.mjs — HTTP-laag van de geïsoleerde malwarescanner.
// ----------------------------------------------------------------------------
//  Twee routes:
//    GET  /health  — open, geen document-, klant- of geheime gegevens. Levert
//                    engine-, signature- en deploymentherkomst, zodat de
//                    beheerworker kan vaststellen tegen WELKE scanner een
//                    verdict is afgegeven.
//    POST /scan    — de enige beschermde route. OIDC → URL-allowlist →
//                    begrensde streaming download → clamd INSTREAM → verdict.
//
//  Fail-closed op elk niveau: ontbrekende configuratie, een onbekende
//  clamd-uitkomst, een afgekapte download of een overschreden limiet levert
//  nooit "schoon" op.
// ============================================================================

import http from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { beoordeelBronUrl } from "./bron-url.mjs";
import { maakOidcVerifier } from "./oidc.mjs";
import { openInstream } from "./clamd.mjs";

// ── Configuratie ────────────────────────────────────────────────────────────
// Alles verplicht. Ontbreekt er één, dan start de scanner niet: een scanner die
// draait met een half ingevulde allowlist is gevaarlijker dan geen scanner.
const VERPLICHT = [
  "SCANNER_OIDC_ISSUER",
  "SCANNER_OIDC_AUDIENCE",
  "SCANNER_OIDC_SUBJECT",
  "SCANNER_OIDC_OWNER_ID",
  "SCANNER_OIDC_PROJECT_ID",
  "SCANNER_SUPABASE_HOST",
];
const ontbreekt = VERPLICHT.filter((k) => !process.env[k]);
if (ontbreekt.length > 0) {
  console.error(
    JSON.stringify({ tag: "scanner", fase: "config-onvolledig", ontbreekt })
  );
  process.exit(1);
}

const CONFIG = {
  poort: Number(process.env.PORT ?? 80),
  bucket: "documenten-quarantaine",
  supabaseHost: process.env.SCANNER_SUPABASE_HOST,
  // Ruim boven de 25 MB-uploadgrens van de applicatie. Raakt een bestand deze
  // cap, dan is dat geen randgeval maar een signaal.
  maxBytes: Number(process.env.SCANNER_MAX_BYTES ?? 64 * 1024 * 1024),
  clamdSocket: process.env.SCANNER_CLAMD_SOCKET ?? "/tmp/clamd/clamd.sock",
  verbindTimeoutMs: 5_000,
  downloadTotaalTimeoutMs: 120_000,
  downloadIdleTimeoutMs: 20_000,
  scanTotaalTimeoutMs: 180_000,
  clamdStartWachtMs: 30_000,
};

if (
  !Number.isInteger(CONFIG.poort) ||
  CONFIG.poort < 1 ||
  CONFIG.poort > 65_535 ||
  !Number.isInteger(CONFIG.maxBytes) ||
  CONFIG.maxBytes < 25 * 1024 * 1024 ||
  CONFIG.maxBytes > 64 * 1024 * 1024 ||
  !/^[a-z0-9-]+\.supabase\.co$/i.test(CONFIG.supabaseHost)
) {
  console.error(JSON.stringify({ tag: "scanner", fase: "config-ongeldig" }));
  process.exit(1);
}

const verifieerOidc = maakOidcVerifier({
  issuer: process.env.SCANNER_OIDC_ISSUER,
  audience: process.env.SCANNER_OIDC_AUDIENCE,
  subject: process.env.SCANNER_OIDC_SUBJECT,
  ownerId: process.env.SCANNER_OIDC_OWNER_ID,
  projectId: process.env.SCANNER_OIDC_PROJECT_ID,
});

// ── Herkomst (vastgelegd tijdens de build) ──────────────────────────────────
const herkomst = await leesHerkomst();

async function leesHerkomst() {
  const lees = async (pad) => {
    try {
      return (await readFile(pad, "utf8")).trim();
    } catch {
      return "";
    }
  };
  const engineRuw = await lees("/app/herkomst/engine.txt");
  const dailyRuw = await lees("/app/herkomst/daily.txt");
  const gebouwdOp = await lees("/app/herkomst/gebouwd-op.txt");

  // "ClamAV 1.4.6/27812/Fri Aug 15 08:11:03 2026" → engineversie eruit.
  const engineVersion = /ClamAV\s+([0-9.]+)/.exec(engineRuw)?.[1] ?? "onbekend";
  // sigtool --info levert onder meer "Version: 27812" en "Build time: ...".
  const signatureVersion = /Version:\s*(\S+)/.exec(dailyRuw)?.[1] ?? "onbekend";
  const buildTijd = /Build time:\s*(.+)/.exec(dailyRuw)?.[1]?.trim() ?? "";
  const gepubliceerd = buildTijd ? new Date(buildTijd) : null;

  return {
    engineVersion,
    signatureVersion,
    signaturePublishedAt:
      gepubliceerd && !Number.isNaN(gepubliceerd.getTime())
        ? gepubliceerd.toISOString()
        : null,
    imageBuiltAt: gebouwdOp || null,
    // Vercel geeft de deployment-id als systeem-env mee. Zonder die waarde kan
    // de beheerworker niet vaststellen of het verdict van de actueel gezonde
    // deployment komt — dus dat is een expliciete "onbekend", geen lege string.
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? "onbekend",
    // De EICAR-poort is een BUILD-gate: staat deze image er, dan is hij
    // geslaagd, anders was er geen image geweest.
    eicarOk: true,
  };
}

// ── Semafoor: één scan tegelijk per instance ────────────────────────────────
// Fluid Compute kan meerdere requests binnen dezelfde instance uitvoeren. clamd
// houdt de signatureset één keer in het geheugen, maar gelijktijdige scans
// stapelen wel werkgeheugen en kunnen de instance over de grens duwen. Bij
// bezetting weigeren we netjes met 429 — de beheerworker behandelt dat als
// tijdelijk, nooit als scanfout en zeker niet als "schoon".
let scanBezig = false;

// ── Server ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      const ready = clamdGereed();
      return json(res, ready ? 200 : 503, { ...herkomst, ready });
    }
    if (req.method === "POST" && req.url === "/scan") {
      return await behandelScan(req, res);
    }
    return json(res, 404, { code: "niet_gevonden" });
  } catch (fout) {
    // Nooit een stacktrace of interne melding naar buiten: die kan een pad,
    // een hostname of een fragment van de signed URL bevatten.
    console.error(JSON.stringify({ tag: "scanner", fase: "onverwacht", naam: fout?.name }));
    return json(res, 500, { code: "interne_fout" });
  }
});

async function behandelScan(req, res) {
  const oordeel = await verifieerOidc(req.headers.authorization);
  if (!oordeel.ok) {
    console.warn(JSON.stringify({ tag: "scanner", fase: "auth-geweigerd", code: oordeel.code }));
    return json(res, 401, { code: "niet_geautoriseerd" });
  }

  // De health-check en de scan kunnen door Vercel op verschillende, gelijktijdig
  // koud startende instances landen. Een succesvolle /health is daarom geen
  // garantie dat déze instance clamd al geladen heeft. Houd de echte scan
  // begrensd open; zo kan deze instance na de gebruikelijke ~15 s koude start
  // alsnog veilig scannen in plaats van een zinloze retrylus te veroorzaken.
  if (!(await wachtOpClamd(CONFIG.clamdStartWachtMs))) {
    res.setHeader("Retry-After", "5");
    return json(res, 503, { code: "scanner_start_op" });
  }

  const body = await leesJsonBody(req);
  if (!body.ok) return json(res, 400, { code: body.code });

  const bron = beoordeelBronUrl(body.waarde.signedUrl, {
    supabaseHost: CONFIG.supabaseHost,
    bucket: CONFIG.bucket,
  });
  if (!bron.ok) {
    // De foutcode is veilig (gesloten verzameling); de URL zelf gaat NIET in
    // het log — die is een capability.
    console.warn(JSON.stringify({ tag: "scanner", fase: "bron-geweigerd", code: bron.code }));
    return json(res, 400, { code: bron.code });
  }

  if (scanBezig) {
    res.setHeader("Retry-After", "5");
    return json(res, 429, { code: "scanner_bezet" });
  }
  scanBezig = true;
  const start = Date.now();
  try {
    const uitkomst = await scanBron(bron.url);
    return json(res, 200, {
      ...uitkomst,
      ...herkomst,
      durationMs: Date.now() - start,
    });
  } finally {
    scanBezig = false;
  }
}

function clamdGereed() {
  return existsSync(CONFIG.clamdSocket);
}

async function wachtOpClamd(maxWachtMs) {
  const deadline = Date.now() + maxWachtMs;
  while (!clamdGereed() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return clamdGereed();
}

/**
 * Haalt de bron begrensd op en voert hem in één doorgang aan clamd én aan de
 * hashfunctie. De bytes raken de schijf nooit.
 *
 * @param {URL} url
 */
async function scanBron(url) {
  const afbreker = new AbortController();
  const totaalTimer = setTimeout(() => afbreker.abort(), CONFIG.downloadTotaalTimeoutMs);

  let sessie = null;
  try {
    const respons = await fetch(url, {
      method: "GET",
      // Geen redirects volgen: een 3xx is de klassieke ontsnapping uit een
      // hostname-allowlist. Elke omleiding is hier een fout, geen hint.
      redirect: "manual",
      signal: afbreker.signal,
      headers: { accept: "application/octet-stream" },
    });

    if (respons.status >= 300 && respons.status < 400) {
      return { verdict: "error", code: "bron_redirect" };
    }
    if (!respons.ok || !respons.body) {
      return { verdict: "error", code: "bron_niet_opgehaald" };
    }

    sessie = await openInstream(CONFIG.clamdSocket, {
      verbindTimeoutMs: CONFIG.verbindTimeoutMs,
      totaalTimeoutMs: CONFIG.scanTotaalTimeoutMs,
    });

    const hash = createHash("sha256");
    let bytes = 0;
    let laatsteData = Date.now();

    // Idle-bewaking: een server die traag druppelt mag het scanslot niet
    // uren bezet houden. Content-Length wordt bewust NIET vertrouwd — alleen
    // de werkelijk ontvangen bytes tellen.
    const idleTimer = setInterval(() => {
      if (Date.now() - laatsteData > CONFIG.downloadIdleTimeoutMs) afbreker.abort();
    }, 1_000);

    try {
      for await (const brok of respons.body) {
        laatsteData = Date.now();
        bytes += brok.length;
        if (bytes > CONFIG.maxBytes) {
          sessie.afbreken();
          sessie = null;
          return { verdict: "policy_blocked", code: "bron_te_groot" };
        }
        const buf = Buffer.from(brok);
        hash.update(buf);
        await sessie.schrijf(buf);
      }
    } finally {
      clearInterval(idleTimer);
    }

    if (bytes === 0) {
      sessie.afbreken();
      sessie = null;
      return { verdict: "error", code: "bron_leeg" };
    }

    const clamd = await sessie.afronden();
    sessie = null;
    const sha256 = hash.digest("hex");

    switch (clamd.soort) {
      case "schoon":
        return { verdict: "clean", sha256, bytes };
      case "gevonden":
        return {
          verdict: "infected",
          sha256,
          bytes,
          // Genormaliseerd: alleen tekens die in een ClamAV-detectienaam horen.
          // De ruwe string is aanvallerbeïnvloedbaar en gaat niet ongefilterd
          // het auditspoor in.
          detection: clamd.detectie.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 96),
        };
      case "limiet":
        return { verdict: "policy_blocked", sha256, bytes, code: "scanlimiet_geraakt" };
      default:
        return { verdict: "error", sha256, bytes, code: "scanner_antwoord_ongeldig" };
    }
  } catch (fout) {
    if (sessie) sessie.afbreken();
    const afgebroken = fout?.name === "AbortError" || afbreker.signal.aborted;
    return { verdict: "error", code: afgebroken ? "bron_timeout" : "bron_fout" };
  } finally {
    clearTimeout(totaalTimer);
  }
}

// ── Hulpfuncties ────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 8 * 1024;

async function leesJsonBody(req) {
  let ruw = "";
  for await (const brok of req) {
    ruw += brok;
    if (ruw.length > MAX_BODY_BYTES) return { ok: false, code: "body_te_groot" };
  }
  try {
    const waarde = JSON.parse(ruw);
    if (typeof waarde !== "object" || waarde === null) {
      return { ok: false, code: "body_ongeldig" };
    }
    return { ok: true, waarde };
  } catch {
    return { ok: false, code: "body_ongeldig" };
  }
}

function json(res, status, lichaam) {
  const tekst = JSON.stringify(lichaam);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(tekst);
}

server.listen(CONFIG.poort, () => {
  console.log(
    JSON.stringify({
      tag: "scanner",
      fase: "gereed",
      poort: CONFIG.poort,
      engine: herkomst.engineVersion,
      signatures: herkomst.signatureVersion,
    })
  );
});
