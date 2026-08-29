import { createHash } from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";

const HOST = "127.0.0.1";
const PORT = 8787;
const TOKEN = "wp3-e2e-local-oidc";
const DEPLOYMENT = "wp3-e2e-scanner";
const MAX_BYTES = 26 * 1024 * 1024;
const INFECTED_MARKER = "WP3-E2E-INFECTED-MARKER";

function json(res, status, body) {
  const inhoud = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(inhoud),
    "cache-control": "no-store",
  });
  res.end(inhoud);
}

function herkomst() {
  const nu = new Date().toISOString();
  return {
    engine: "clamav",
    engineVersion: "e2e-stub-1",
    signatureVersion: "e2e-current",
    signaturePublishedAt: nu,
    imageBuiltAt: nu,
    deploymentId: DEPLOYMENT,
  };
}

async function leesBody(req) {
  const delen = [];
  let totaal = 0;
  for await (const deel of req) {
    totaal += deel.length;
    if (totaal > 16 * 1024) throw new Error("body_te_groot");
    delen.push(deel);
  }
  return JSON.parse(Buffer.concat(delen).toString("utf8"));
}

function veiligeLokaleSignedUrl(waarde) {
  try {
    const url = new URL(waarde);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port === "54321" &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith("/storage/v1/object/sign/documenten-quarantaine/")
    ) ? url : null;
  } catch {
    return null;
  }
}

async function scan(req, res) {
  if (!scannerGeautoriseerd(req.headers)) {
    return json(res, 401, { code: "niet_geautoriseerd" });
  }
  const body = await leesBody(req).catch(() => null);
  const url = veiligeLokaleSignedUrl(body?.signedUrl);
  if (!url) return json(res, 400, { code: "pad_niet_toegestaan" });

  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return json(res, 502, { code: "bron_niet_opgehaald" });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    return json(res, 200, {
      verdict: "policy_blocked",
      ...herkomst(),
      sha256: createHash("sha256").update(buffer).digest("hex"),
      durationMs: 1,
      code: "bron_te_groot",
    });
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const besmet = buffer.includes(Buffer.from(INFECTED_MARKER));
  return json(res, 200, {
    verdict: besmet ? "infected" : "clean",
    ...herkomst(),
    sha256,
    durationMs: 1,
    ...(besmet ? { detection: "E2E.Test.Marker" } : {}),
  });
}

export function scannerGeautoriseerd(headers) {
  return (
    headers.authorization === `Bearer ${TOKEN}` &&
    headers["x-vercel-trusted-oidc-idp-token"] === TOKEN
  );
}

export function maakScannerStub() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return json(res, 200, { ready: true, eicarOk: true, ...herkomst() });
      }
      if (req.method === "POST" && req.url === "/scan") return await scan(req, res);
      return json(res, 404, { code: "niet_gevonden" });
    } catch {
      return json(res, 500, { code: "interne_fout" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  maakScannerStub().listen(PORT, HOST, () => {
    process.stdout.write(`E2E scannerstub gereed op http://${HOST}:${PORT}\n`);
  });
}
