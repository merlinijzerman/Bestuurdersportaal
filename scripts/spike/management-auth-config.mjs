#!/usr/bin/env node
// ============================================================================
//  Spike T0.5 (#335) — S9: read-only uitlezen van de hosted Supabase Auth-config via de
//  Management API, verwerkt door een VASTE ALLOWLIST. De ruwe respons wordt nooit weggeschreven
//  of geprint; secrets (client-secrets, keys) staan niet in de allowlist. Uitsluitend GET.
//
//  Env: SUPABASE_MANAGEMENT_API_TOKEN (zelfde token als scripts/verify-supabase-auth-config.mjs),
//       SPIKE_PROJECT_REF (Preview-project; 20 kleine letters/cijfers).
//  Uitvoer: markdown op stdout met alleen allowlisted sleutels, de ingeschakelde OAuth-providers
//  (P9; e-mail en telefoon zijn geen OAuth) en of er een sleutel over linking domains bestaat (P6).
// ============================================================================
const token = process.env.SUPABASE_MANAGEMENT_API_TOKEN?.trim();
const ref = process.env.SPIKE_PROJECT_REF?.trim() ?? "";
if (!token) { process.stderr.write("SUPABASE_MANAGEMENT_API_TOKEN is vereist\n"); process.exit(1); }
if (!/^[a-z0-9]{20}$/.test(ref)) { process.stderr.write("SPIKE_PROJECT_REF ongeldig (verwacht 20 kleine letters/cijfers)\n"); process.exit(1); }

/** Alleen deze sleutels worden gelezen en getoond (booleans/getallen/korte strings). */
const ALLOWLIST = [
  "disable_signup",                       // P2
  "security_manual_linking_enabled",      // P3
  "external_azure_enabled",               // P1
  "external_azure_url",                   // P1 (tenant-URL, geen secret)
  "jwt_exp",                              // P8
  "hook_custom_access_token_enabled",     // P7
  "hook_custom_access_token_uri",         // P7
  "uri_allow_list",                       // P4
  "site_url",                             // P4
];
/** Geen OAuth-providers, ook al heten hun sleutels external_*_enabled. */
const GEEN_OAUTH = new Set(["email", "phone", "anonymous_users"]);

let res;
try {
  res = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/config/auth`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
} catch (e) {
  process.stderr.write(`Management API onbereikbaar: ${e.name === "TimeoutError" ? "timeout (15 s)" : e.message}\n`);
  process.exit(1);
}
if (!res.ok) { process.stderr.write(`Management API: HTTP ${res.status}\n`); process.exit(1); }
const config = await res.json();
if (!config || typeof config !== "object" || Array.isArray(config)) { process.stderr.write("Onverwachte responsvorm\n"); process.exit(1); }

const toon = (v) => (typeof v === "string" ? (v.length > 120 ? `${v.slice(0, 117)}…` : v) : JSON.stringify(v));
const regels = ALLOWLIST.map((k) => `| \`${k}\` | ${Object.prototype.hasOwnProperty.call(config, k) ? toon(config[k]) : "(sleutel ontbreekt)"} |`);

// P9: welke OAuth-providers staan aan? Alleen namen, geen waarden.
const aan = Object.keys(config)
  .filter((k) => /^external_[a-z0-9_]+_enabled$/.test(k) && config[k] === true)
  .map((k) => k.replace(/^external_/, "").replace(/_enabled$/, ""))
  .filter((naam) => !GEEN_OAUTH.has(naam))
  .sort();
// P6: bestaat er überhaupt een sleutel over linking domains?
const linkingKeys = Object.keys(config).filter((k) => /linking_domain/i.test(k));
const p9Ok = aan.length === 1 && aan[0] === "azure";

process.stdout.write([
  `# S9 — hosted Auth-config (allowlist), project \`${ref}\``,
  ``,
  `| Sleutel | Waarde |`, `|---|---|`, ...regels,
  ``,
  `- **P9 ingeschakelde OAuth-providers (e-mail/telefoon uitgezonderd):** ${aan.length ? aan.join(", ") : "(geen)"} — verwacht uitsluitend \`azure\` → ${p9Ok ? "✅" : "❌"}`,
  `- **P6 linking-domain-sleutel aanwezig:** ${linkingKeys.length ? linkingKeys.map((k) => `\`${k}\``).join(", ") : "nee — via Management API niet instelbaar; navraag bij Supabase nodig"}`,
  `- Ruwe respons niet opgeslagen; ${Object.keys(config).length} sleutels ontvangen, ${ALLOWLIST.length} getoond.`,
  ``,
].join("\n"));
if (!p9Ok) process.exitCode = 1;
