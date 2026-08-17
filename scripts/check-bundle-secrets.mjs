// ============================================================================
//  Buildoutput-sleutelcheck (WP5-5b, pen-testvoorbereiding 2026-08-17).
// ----------------------------------------------------------------------------
//  `check-service-role-leak.sh` toetst de BRON. Deze check toetst wat er
//  daadwerkelijk in de gebouwde clientbundle terechtkomt — de enige plek waar
//  een pen-tester kijkt. Bron en build kunnen uiteenlopen: Next.js inlinet
//  `NEXT_PUBLIC_*` letterlijk, en een server-only import die per ongeluk in een
//  client-component belandt sleept zijn module-scope mee de bundle in.
//
//  Drie regels:
//   1. POSITIEVE SENTINEL — de anon-key MOET in .next/static staan. Vindt de
//      scan hem niet, dan is niet bewezen dat de bundle schoon is; dan is
//      bewezen dat er in de verkeerde map is gezocht. Zonder deze controle is
//      een lege of misgerichte scan niet te onderscheiden van een schone.
//   2. De service-role-key mag NERGENS in .next staan (client én server-chunks).
//   3. Geen enkel structureel geheimpatroon in .next/static: `sb_secret_`, de
//      letterlijke env-naam, of een JWT met rolclaim `service_role`.
//
//  Draai vanuit mvp/ NA `npm run build`:
//    NEXT_PUBLIC_SUPABASE_ANON_KEY=… node scripts/check-bundle-secrets.mjs
//
//  Exit 0 = schoon; exit 1 = lek of niet-uitgevoerde scan.
//
//  Geen sleutelwaarde wordt geprint — uitsluitend booleans, tellingen en paden.
// ============================================================================
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const WORTEL = process.cwd();
const NEXT_DIR = join(WORTEL, ".next");
const STATIC_DIR = join(NEXT_DIR, "static");

let fouten = 0;
const melding = (tekst) => {
  console.log(`  LEK: ${tekst}`);
  fouten += 1;
};

/** Alle bestanden onder een map, plat. */
function bestandenOnder(map) {
  const uit = [];
  if (!existsSync(map)) return uit;
  const stapel = [map];
  while (stapel.length) {
    const huidig = stapel.pop();
    for (const naam of readdirSync(huidig)) {
      const pad = join(huidig, naam);
      const st = statSync(pad);
      if (st.isDirectory()) stapel.push(pad);
      else if (st.isFile()) uit.push(pad);
    }
  }
  return uit;
}

/** Leest tekstbestanden; binair levert een lege string (geen valse treffers). */
function leesTekst(pad) {
  try {
    const buf = readFileSync(pad);
    if (buf.includes(0)) return "";
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

// ── Voorwaarde: er moet een build zijn ───────────────────────────────────────
if (!existsSync(NEXT_DIR)) {
  console.error("FAAL: .next ontbreekt — draai eerst `npm run build`. Scan niet uitgevoerd.");
  process.exit(1);
}
if (!existsSync(STATIC_DIR)) {
  console.error("FAAL: .next/static ontbreekt — buildoutput onvolledig. Scan niet uitgevoerd.");
  process.exit(1);
}

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
if (anonKey.length < 8) {
  console.error(
    "FAAL: NEXT_PUBLIC_SUPABASE_ANON_KEY niet (of te kort) gezet. Zonder die waarde\n" +
      "      is de positieve sentinel niet te toetsen en zegt een schone uitslag niets."
  );
  process.exit(1);
}

const staticBestanden = bestandenOnder(STATIC_DIR);
const nextBestanden = bestandenOnder(NEXT_DIR);
console.log(
  `[1/3] Positieve sentinel: anon-key aanwezig in .next/static (${staticBestanden.length} bestanden)…`
);

let sentinelGevonden = 0;
for (const pad of staticBestanden) {
  if (leesTekst(pad).includes(anonKey)) sentinelGevonden += 1;
}
if (sentinelGevonden === 0) {
  melding(
    "sentinel mist: de anon-key staat in geen enkel bestand onder .next/static — " +
      "de scan heeft de clientbundle kennelijk niet gelezen"
  );
} else {
  console.log(`      gevonden in ${sentinelGevonden} bestand(en) — scan leest de echte bundle.`);
}

// ── 2. Service-role-key mag nergens in .next staan ───────────────────────────
console.log(`[2/3] Service-role-key komt niet voor in .next (${nextBestanden.length} bestanden)…`);
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (serviceKey.length >= 8) {
  for (const pad of nextBestanden) {
    if (leesTekst(pad).includes(serviceKey)) {
      melding(`service-role-key letterlijk aanwezig in ${relative(WORTEL, pad)}`);
    }
  }
} else {
  console.log("      (geen SUPABASE_SERVICE_ROLE_KEY in de omgeving — waardevergelijking overgeslagen;");
  console.log("       de structurele patronen hieronder gelden onverkort)");
}

// ── 3. Structurele geheimpatronen in de clientbundle ─────────────────────────
console.log("[3/3] Structurele geheimpatronen in .next/static…");
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;

for (const pad of staticBestanden) {
  const inhoud = leesTekst(pad);
  if (!inhoud) continue;
  const kort = relative(WORTEL, pad);

  if (inhoud.includes("sb_secret_")) {
    melding(`Supabase secret-sleutelpatroon (sb_secret_) in ${kort}`);
  }
  if (inhoud.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    melding(`letterlijke env-naam SUPABASE_SERVICE_ROLE_KEY in ${kort}`);
  }
  for (const treffer of inhoud.matchAll(JWT)) {
    let rol = null;
    try {
      const payload = Buffer.from(
        treffer[1].replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf8");
      rol = JSON.parse(payload).role ?? null;
    } catch {
      // Geen geldige JWT-payload: geen bevinding. Bewust stil — dit patroon
      // matcht ook op willekeurige base64 in een bundle.
    }
    if (rol === "service_role") {
      // Nooit het token zelf loggen.
      melding(`JWT met rolclaim 'service_role' in ${kort}`);
    }
  }
}

console.log();
if (fouten === 0) {
  console.log("OK: buildoutput bevat de anon-key en geen service-role-materiaal.");
  process.exit(0);
}
console.log(`FAAL: ${fouten} bevinding(en) in de buildoutput.`);
process.exit(1);
