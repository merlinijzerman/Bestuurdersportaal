import { pathToFileURL } from "node:url";

const DEFAULT_LIMITS = Object.freeze({
  maxSignatureAgeHours: 48,
  maxImageAgeMinutes: 30,
});

const MAX_RESPONSE_BYTES = 16 * 1024;

function geldigeDatum(waarde) {
  if (typeof waarde !== "string" || waarde.length === 0) return null;
  const tijd = Date.parse(waarde);
  return Number.isFinite(tijd) ? tijd : null;
}

export function validateScannerHealth(payload, nowMs = Date.now(), limits = DEFAULT_LIMITS) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, code: "health_body_ongeldig" };
  }
  if (payload.ready !== true || payload.eicarOk !== true || payload.engine !== "clamav") {
    return { ok: false, code: "scanner_niet_gereed" };
  }
  if (
    typeof payload.engineVersion !== "string" ||
    payload.engineVersion.length === 0 ||
    typeof payload.signatureVersion !== "string" ||
    payload.signatureVersion.length === 0 ||
    typeof payload.deploymentId !== "string" ||
    !payload.deploymentId.startsWith("dpl_")
  ) {
    return { ok: false, code: "herkomst_ongeldig" };
  }

  const signatureMs = geldigeDatum(payload.signaturePublishedAt);
  const imageMs = geldigeDatum(payload.imageBuiltAt);
  if (signatureMs === null || imageMs === null) {
    return { ok: false, code: "herkomstdatum_ongeldig" };
  }

  const klokspelingMs = 5 * 60_000;
  const signatureLeeftijdMs = nowMs - signatureMs;
  const imageLeeftijdMs = nowMs - imageMs;
  if (
    signatureLeeftijdMs < -klokspelingMs ||
    signatureLeeftijdMs > limits.maxSignatureAgeHours * 3_600_000
  ) {
    return { ok: false, code: "signatures_verouderd" };
  }
  if (
    imageLeeftijdMs < -klokspelingMs ||
    imageLeeftijdMs > limits.maxImageAgeMinutes * 60_000
  ) {
    return { ok: false, code: "image_niet_ververst" };
  }

  return {
    ok: true,
    deploymentId: payload.deploymentId,
    engineVersion: payload.engineVersion,
    signatureVersion: payload.signatureVersion,
    signaturePublishedAt: payload.signaturePublishedAt,
    imageBuiltAt: payload.imageBuiltAt,
  };
}

function positiefGetal(waarde, naam) {
  const getal = Number(waarde);
  if (!Number.isFinite(getal) || getal <= 0) {
    throw new Error(`${naam} moet een positief getal zijn`);
  }
  return getal;
}

export function parseArgs(argv) {
  const [url, ...rest] = argv;
  if (!url) throw new Error("Gebruik: verify-scanner-health.mjs <health-url> [opties]");
  const parsedUrl = new URL(url);
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.port ||
    parsedUrl.pathname !== "/health" ||
    parsedUrl.search ||
    parsedUrl.hash ||
    !parsedUrl.hostname.endsWith(".vercel.app")
  ) {
    throw new Error("De health-URL moet exact een HTTPS .vercel.app-/health-URL zijn");
  }

  const opties = {
    url: parsedUrl,
    maxSignatureAgeHours: DEFAULT_LIMITS.maxSignatureAgeHours,
    maxImageAgeMinutes: DEFAULT_LIMITS.maxImageAgeMinutes,
    attempts: 12,
    intervalSeconds: 10,
  };
  for (let i = 0; i < rest.length; i += 2) {
    const vlag = rest[i];
    const waarde = rest[i + 1];
    if (waarde === undefined) throw new Error(`Waarde ontbreekt voor ${vlag}`);
    if (vlag === "--max-signature-age-hours") opties.maxSignatureAgeHours = positiefGetal(waarde, vlag);
    else if (vlag === "--max-image-age-minutes") opties.maxImageAgeMinutes = positiefGetal(waarde, vlag);
    else if (vlag === "--attempts") opties.attempts = positiefGetal(waarde, vlag);
    else if (vlag === "--interval-seconds") opties.intervalSeconds = positiefGetal(waarde, vlag);
    else throw new Error(`Onbekende optie: ${vlag}`);
  }
  if (!Number.isInteger(opties.attempts) || opties.attempts > 60) {
    throw new Error("--attempts moet een geheel getal van maximaal 60 zijn");
  }
  return opties;
}

async function leesKleineJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`health_http_${response.status}`);
  const lengte = Number(response.headers.get("content-length") ?? 0);
  if (lengte > MAX_RESPONSE_BYTES) throw new Error("health_respons_te_groot");
  const tekst = await response.text();
  if (Buffer.byteLength(tekst) > MAX_RESPONSE_BYTES) throw new Error("health_respons_te_groot");
  return JSON.parse(tekst);
}

async function main(argv) {
  const opties = parseArgs(argv);
  let laatsteCode = "health_onbereikbaar";
  for (let poging = 1; poging <= opties.attempts; poging += 1) {
    try {
      const payload = await leesKleineJson(opties.url);
      const oordeel = validateScannerHealth(payload, Date.now(), opties);
      if (oordeel.ok) {
        console.log(JSON.stringify({ tag: "scanner-signature-refresh", status: "groen", ...oordeel }));
        return;
      }
      laatsteCode = oordeel.code;
    } catch (error) {
      laatsteCode = error instanceof Error ? error.message : "health_onbereikbaar";
    }
    if (poging < opties.attempts) {
      await new Promise((resolve) => setTimeout(resolve, opties.intervalSeconds * 1_000));
    }
  }
  throw new Error(`Productie-scannerhealth bleef rood: ${laatsteCode}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : "Scannerhealthcontrole mislukt");
    process.exitCode = 1;
  });
}
