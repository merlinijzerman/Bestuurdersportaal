// ============================================================================
//  scanner/test/harness/w0-runner.mjs — end-to-end proefopstelling voor W0.
// ----------------------------------------------------------------------------
//  Draait IN een container op hetzelfde Docker-netwerk als de scanner, met
//  netwerk-alias `abc123xyz.supabase.co`. Daarmee wordt de allowlist getest
//  zoals hij is: exact hostname, poort 443, https, vast padprefix. Geen
//  testvlag, geen versoepeling — de productiecode draait ongewijzigd.
//
//  Deze opstelling vervult drie rollen tegelijk:
//    1. OIDC-identityprovider  — mint tokens en publiceert de JWKS;
//    2. Supabase Storage-mock  — levert de corpusbestanden op signed-URL-vorm;
//    3. beheerworker           — roept /scan aan en beoordeelt het verdict.
//
//  Rol 3 is bewust ook hier belegd: zo loopt het hele pad (token minten →
//  URL aanbieden → verdict terugkrijgen) precies als in productie.
// ============================================================================

import https from "node:https";
import { readFile, readdir } from "node:fs/promises";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

const SCANNER = process.env.SCANNER_URL ?? "http://bp-scan-test:80";
const CORPUS = "/corpus";
const ISSUER = "https://abc123xyz.supabase.co";
const AUDIENCE = "https://scanner.test";
const SUBJECT = "owner:testteam:project:beheer:environment:production";
const OWNER_ID = "team_w0test";
const PROJECT_ID = "prj_w0beheer";

// Vaste UUID's zodat de objectsleutels het productiepatroon volgen
// (<fonds-uuid>/<document-uuid>.<ext>) en de vormtoets ze accepteert.
const FONDS = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const DOC = "9c858901-8a57-4791-81fe-4c455b099bc9";

// ── Sleutels + JWKS ─────────────────────────────────────────────────────────
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = await exportJWK(publicKey);
jwk.kid = "w0-testsleutel";
jwk.alg = "RS256";
jwk.use = "sig";

/** Mint een token. Met `afwijkingen` maken we bewust ongeldige varianten. */
async function mintToken(afwijkingen = {}) {
  return new SignJWT({
    owner_id: afwijkingen.owner_id ?? OWNER_ID,
    project_id: afwijkingen.project_id ?? PROJECT_ID,
    environment: afwijkingen.environment ?? "production",
  })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(afwijkingen.iss ?? ISSUER)
    .setAudience(afwijkingen.aud ?? AUDIENCE)
    .setSubject(afwijkingen.sub ?? SUBJECT)
    .setIssuedAt()
    .setExpirationTime(afwijkingen.exp ?? "1h")
    .sign(privateKey);
}

// ── Mockserver: JWKS + Storage ──────────────────────────────────────────────
const cert = await readFile("/certs/cert.pem");
const sleutel = await readFile("/certs/sleutel.pem");

const bestandenOpNaam = new Map();
for (const naam of await readdir(CORPUS)) {
  bestandenOpNaam.set(naam, await readFile(`${CORPUS}/${naam}`));
}

const server = https.createServer({ cert, key: sleutel }, async (req, res) => {
  const url = new URL(req.url, ISSUER);

  if (url.pathname === "/.well-known/jwks") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ keys: [jwk] }));
  }

  // Signed-URL-vorm van Supabase Storage. De laatste segmenten bepalen welk
  // corpusbestand we teruggeven; de `bestand`-queryparameter is puur voor de
  // proefopstelling en zit niet in het productiepad.
  if (url.pathname.startsWith("/storage/v1/object/sign/")) {
    const gevraagd = url.searchParams.get("bestand");
    const data = bestandenOpNaam.get(gevraagd ?? "");
    if (!data) {
      res.writeHead(404);
      return res.end();
    }
    // Speciale gedragingen om de downloadbewaking te toetsen.
    const gedrag = url.searchParams.get("gedrag");
    if (gedrag === "redirect") {
      res.writeHead(302, { location: "https://abc123xyz.supabase.co/elders" });
      return res.end();
    }
    if (gedrag === "liegt_over_lengte") {
      // Kondigt weinig aan maar stuurt veel: de bytecap moet op de WERKELIJK
      // ontvangen bytes werken, niet op Content-Length.
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": "10" });
      return res.end(Buffer.alloc(80 * 1024 * 1024, 0x42));
    }
    if (gedrag === "druppelt") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.write(data.subarray(0, 10));
      return; // daarna niets meer: de idle-timeout moet ingrijpen
    }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(data.length),
    });
    return res.end(data);
  }

  res.writeHead(404);
  res.end();
});

await new Promise((r) => server.listen(443, r));
console.log("mock luistert op 443 (JWKS + storage)\n");

// ── Aanroepen ───────────────────────────────────────────────────────────────

async function scan({ bestand, gedrag, token, ext = "pdf" }) {
  const q = new URLSearchParams({ bestand });
  if (gedrag) q.set("gedrag", gedrag);
  const signedUrl =
    `${ISSUER}/storage/v1/object/sign/documenten-quarantaine/${FONDS}/${DOC}.${ext}?${q}`;
  const res = await fetch(`${SCANNER}/scan`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token ?? (await mintToken())}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ signedUrl }),
  });
  return { status: res.status, lichaam: await res.json().catch(() => ({})) };
}

// Rechtstreekse aanroep met een zelf samengestelde URL (voor de SSRF-gevallen).
async function scanRuweUrl(signedUrl) {
  const res = await fetch(`${SCANNER}/scan`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await mintToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ signedUrl }),
  });
  return { status: res.status, lichaam: await res.json().catch(() => ({})) };
}

// ── Testgevallen ────────────────────────────────────────────────────────────

let geslaagd = 0;
let gefaald = 0;

function beoordeel(naam, werkelijk, verwacht) {
  const ok = verwacht(werkelijk);
  if (ok) {
    geslaagd += 1;
    console.log(`  GROEN  ${naam.padEnd(44)} ${samenvat(werkelijk)}`);
  } else {
    gefaald += 1;
    console.log(`  ROOD   ${naam.padEnd(44)} ${samenvat(werkelijk)}`);
  }
}

function samenvat({ status, lichaam }) {
  const kern = lichaam.verdict ?? lichaam.code ?? "?";
  const extra = lichaam.detection ? ` [${lichaam.detection}]` : lichaam.code && lichaam.verdict ? ` [${lichaam.code}]` : "";
  return `${status} ${kern}${extra}`;
}

console.log("── Schone dragers (verwacht: clean) ──");
for (const [bestand, ext] of [["schoon.pdf", "pdf"], ["schoon.docx", "docx"]]) {
  beoordeel(bestand, await scan({ bestand, ext }), (r) => r.lichaam.verdict === "clean");
}

// ── EICAR-liveness ──────────────────────────────────────────────────────────
//  GEMETEN EIGENSCHAP, en die stuurt hoe deze test eruitziet: ClamAV detecteert
//  EICAR uitsluitend als het bestand EXACT de 68 bytes is. Eén byte ervoor of
//  erachter en de uitkomst is `OK` — het is een whole-file-hash-signature, geen
//  patroon. Gevolg:
//
//   - DOCX werkt als drager: zip-entries worden byte-exact uitgepakt, dus de
//     ingesloten 68 bytes matchen. Dit is de echte end-to-end livenesstest.
//   - PDF werkt NIET als drager: ClamAV negeert /Length en pakt een stream uit
//     met een zelf berekende lengte (hier 114 i.p.v. 68, inclusief
//     scheidingstekens), waardoor de hash nooit matcht. Dat is geen gat in de
//     scanner en niet met een instelling op te lossen — EICAR is simpelweg
//     ongeschikt als markering binnen een PDF.
//
//  De PDF-drager blijft als INFO staan zodat niemand later denkt dat hij
//  vergeten is, of hem "repareert" door ergens een controle te versoepelen.
console.log("\n── EICAR-liveness ──");
beoordeel(
  "eicar-drager.docx (byte-exacte zip-entry)",
  await scan({ bestand: "eicar-drager.docx", ext: "docx" }),
  (r) => r.lichaam.verdict === "infected"
);
{
  const r = await scan({ bestand: "eicar-drager.pdf", ext: "pdf" });
  console.log(
    `  INFO   eicar-drager.pdf → ${samenvat(r)} ` +
      "(verwacht: EICAR is niet detecteerbaar binnen een PDF-stream, zie toelichting)"
  );
}

console.log("\n── Limietdragers die de SCANNER moet vangen (verwacht: NOOIT clean) ──");
for (const [bestand, ext] of [
  ["versleuteld.docx", "docx"],
  ["te-groot.bin", "pdf"],
]) {
  if (!bestandenOpNaam.has(bestand)) {
    console.log(`  OVERGESLAGEN ${bestand} (niet in corpus)`);
    continue;
  }
  beoordeel(bestand, await scan({ bestand, ext }), (r) => r.lichaam.verdict !== "clean");
}

// ── Wat NIET de scanner z'n werk is ─────────────────────────────────────────
//  Beide gevallen hieronder komen als `clean` terug, en dat is juist: er zit
//  geen malware in. De poort is valideerUpload (core/lib/bestand-validatie.ts),
//  die in de worker VÓÓR de scan draait. Geverifieerd met de productiecode via
//  test/harness/applaag-controle.mts:
//
//    zipbom.docx → decompressie_cap        (ratio 1009,8 tegen plafond 120)
//    kapot.docx  → ooxml_subtype_mismatch  (markerentry onleesbaar)
//
//  Hier vastgelegd zodat niemand later de scanner gaat oprekken — of erger, een
//  ClamAV-limiet gaat versoepelen — voor een taak die een laag hoger al beter
//  en goedkoper is belegd.
console.log("\n── Belegd bij valideerUpload, niet bij de scanner ──");
for (const [bestand, ext, reden] of [
  ["zipbom.docx", "docx", "decompressie_cap"],
  ["kapot.docx", "docx", "ooxml_subtype_mismatch"],
]) {
  if (!bestandenOpNaam.has(bestand)) continue;
  const r = await scan({ bestand, ext });
  console.log(`  INFO   ${bestand.padEnd(18)} → ${samenvat(r)} (uploadvalidatie weigert: ${reden})`);
}

console.log("\n── Downloadbewaking ──");
beoordeel(
  "3xx-redirect wordt niet gevolgd",
  await scan({ bestand: "schoon.pdf", gedrag: "redirect" }),
  (r) => r.lichaam.verdict === "error" && r.lichaam.code === "bron_redirect"
);

// Een server die minder aankondigt dan hij stuurt, wordt door de HTTP-cliënt
// op Content-Length afgekapt: de scanner ziet dan een ANDER bestand dan het
// origineel. Dat is geen scannerfout — het is precies waarvoor de hashbinding
// in de worker bestaat. We toetsen hier dus niet "niet clean", maar dat de
// teruggegeven sha256 aantoonbaar afwijkt van die van het echte bestand,
// zodat de worker het als hash_mismatch afkeurt en niet promoveert.
{
  const { createHash } = await import("node:crypto");
  const echteHash = createHash("sha256").update(bestandenOpNaam.get("schoon.pdf")).digest("hex");
  const r = await scan({ bestand: "schoon.pdf", gedrag: "liegt_over_lengte" });
  beoordeel(
    "afgekapte bron levert afwijkende sha256 (worker weigert)",
    r,
    (x) => x.lichaam.sha256 !== undefined && x.lichaam.sha256 !== echteHash
  );
}

console.log("\n── SSRF-allowlist (verwacht: 400, geen netwerkverbinding) ──");
for (const [naam, url] of [
  ["http in plaats van https", "http://abc123xyz.supabase.co/storage/v1/object/sign/documenten-quarantaine/x.pdf"],
  ["localhost", "https://localhost/storage/v1/object/sign/documenten-quarantaine/x.pdf"],
  ["link-local metadata", "https://169.254.169.254/storage/v1/object/sign/documenten-quarantaine/x.pdf"],
  ["ander hostname", "https://kwaadaardig.example/storage/v1/object/sign/documenten-quarantaine/x.pdf"],
  ["suffix-aanval op hostname", `https://abc123xyz.supabase.co.aanvaller.nl/storage/v1/object/sign/documenten-quarantaine/${FONDS}/${DOC}.pdf`],
  ["andere bucket", `${ISSUER}/storage/v1/object/sign/documenten/${FONDS}/${DOC}.pdf`],
  ["REST-API in plaats van storage", `${ISSUER}/rest/v1/documenten?select=*`],
  ["dubbel-encoded traversal", `${ISSUER}/storage/v1/object/sign/documenten-quarantaine/%252e%252e/geheim.pdf`],
  ["afwijkende poort", `https://abc123xyz.supabase.co:8443/storage/v1/object/sign/documenten-quarantaine/${FONDS}/${DOC}.pdf`],
  ["credentials in de URL", `https://u:p@abc123xyz.supabase.co/storage/v1/object/sign/documenten-quarantaine/${FONDS}/${DOC}.pdf`],
]) {
  beoordeel(naam, await scanRuweUrl(url), (r) => r.status === 400);
}

console.log("\n── OIDC-poort (verwacht: 401) ──");
beoordeel("geen token", await scan({ bestand: "schoon.pdf", token: "" }), (r) => r.status === 401);
beoordeel(
  "verkeerde audience",
  await scan({ bestand: "schoon.pdf", token: await mintToken({ aud: "https://ergens.anders" }) }),
  (r) => r.status === 401
);
beoordeel(
  "verkeerde issuer",
  await scan({ bestand: "schoon.pdf", token: await mintToken({ iss: "https://oidc.vercel.com/anders" }) }),
  (r) => r.status === 401
);
beoordeel(
  "preview-environment in subject",
  await scan({
    bestand: "schoon.pdf",
    token: await mintToken({ sub: "owner:testteam:project:beheer:environment:preview" }),
  }),
  (r) => r.status === 401
);
beoordeel(
  "app-project in subject",
  await scan({
    bestand: "schoon.pdf",
    token: await mintToken({ sub: "owner:testteam:project:app:environment:production" }),
  }),
  (r) => r.status === 401
);
beoordeel(
  "kloppende subject maar afwijkend project_id (hernoemd project)",
  await scan({ bestand: "schoon.pdf", token: await mintToken({ project_id: "prj_iets_anders" }) }),
  (r) => r.status === 401
);
beoordeel(
  "kloppende subject maar afwijkend owner_id",
  await scan({ bestand: "schoon.pdf", token: await mintToken({ owner_id: "team_anders" }) }),
  (r) => r.status === 401
);

console.log(`\n${"═".repeat(64)}`);
console.log(`GROEN: ${geslaagd}   ROOD: ${gefaald}`);
console.log("═".repeat(64));

server.close();
process.exit(gefaald === 0 ? 0 : 1);
