// ============================================================================
//  monitoring-health.sanity.ts — pure helpers van de healthcheck (P5).
//
//  Toetst de host-parsing en de foutclassificatie van de tenant-app-probe. Deze
//  logica bepaalt of "Uptime kernfunctionaliteit" terecht rood/groen staat, dus
//  ze moet programmatisch vastliggen. Geen netwerk, geen env — puur.
//
//  Uitvoeren: npx tsx platform/lib/monitoring-health.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  saneerHost,
  parseHosts,
  klassificeerNetwerkfout,
} from "./monitoring-health-core";

let n = 0;
const check = (naam: string, cond: boolean) => {
  assert.ok(cond, `FAAL: ${naam}`);
  n++;
  console.log(`  ✓ ${naam}`);
};

console.log("monitoring-health — host-parsing + foutclassificatie:\n");

// ── saneerHost ──────────────────────────────────────────────────────────────
check("kale host blijft ongewijzigd", saneerHost("app.fonds.nl") === "app.fonds.nl");
check("schema wordt gestript (de probe prependt zelf https)", saneerHost("https://app.fonds.nl") === "app.fonds.nl");
check("http-schema wordt óók gestript", saneerHost("http://app.fonds.nl") === "app.fonds.nl");
check("pad wordt gestript", saneerHost("app.fonds.nl/api/healthz/ping") === "app.fonds.nl");
check("schema + trailing slash samen", saneerHost("https://app.fonds.nl/") === "app.fonds.nl");
check("witruimte wordt getrimd", saneerHost("  app.fonds.nl  ") === "app.fonds.nl");
check("trailing FQDN-punt eraf", saneerHost("app.fonds.nl.") === "app.fonds.nl");
check("lege/witruimte-waarde → null", saneerHost("   ") === null && saneerHost("") === null);

// ── parseHosts ──────────────────────────────────────────────────────────────
check("ontbrekende env → lege lijst", parseHosts(undefined).length === 0 && parseHosts("").length === 0);
check("enkele host → één element", JSON.stringify(parseHosts("app.fonds.nl")) === JSON.stringify(["app.fonds.nl"]));
check(
  "apex,www-lijst → beide, gesaneerd, in volgorde",
  JSON.stringify(parseHosts("fonds.nl, www.fonds.nl")) === JSON.stringify(["fonds.nl", "www.fonds.nl"])
);
check(
  "schema in de lijst wordt gesaneerd",
  JSON.stringify(parseHosts("https://fonds.nl,https://www.fonds.nl")) ===
    JSON.stringify(["fonds.nl", "www.fonds.nl"])
);
check(
  "duplicaten (na saneren) worden ontdubbeld",
  JSON.stringify(parseHosts("app.fonds.nl, https://app.fonds.nl/")) === JSON.stringify(["app.fonds.nl"])
);
check("lege segmenten vallen weg", JSON.stringify(parseHosts("app.fonds.nl, ,")) === JSON.stringify(["app.fonds.nl"]));

// ── klassificeerNetwerkfout (gesloten vocabulaire) ──────────────────────────
check("DNS: ENOTFOUND → dns-fout", klassificeerNetwerkfout({ code: "ENOTFOUND" }) === "dns-fout");
check("DNS: EAI_AGAIN → dns-fout", klassificeerNetwerkfout({ code: "EAI_AGAIN" }) === "dns-fout");
check("verbinding geweigerd", klassificeerNetwerkfout({ code: "ECONNREFUSED" }) === "verbinding geweigerd");
check("undici legt de code onder cause.code", klassificeerNetwerkfout({ cause: { code: "ECONNREFUSED" } }) === "verbinding geweigerd");
check("AbortError → time-out", klassificeerNetwerkfout({ name: "AbortError" }) === "time-out");
check("connect-timeout code → time-out", klassificeerNetwerkfout({ code: "UND_ERR_CONNECT_TIMEOUT" }) === "time-out");
check("cert-fout → tls-fout", klassificeerNetwerkfout({ code: "CERT_HAS_EXPIRED" }) === "tls-fout");
check("altname-mismatch → tls-fout", klassificeerNetwerkfout({ cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" } }) === "tls-fout");
check("ongeldige URL → ongeldige host", klassificeerNetwerkfout({ code: "ERR_INVALID_URL" }) === "ongeldige host");
check("onbekende fout → onbereikbaar (fail-safe vocab)", klassificeerNetwerkfout(new Error("iets raars")) === "onbereikbaar");

console.log(`\n${n} sanity-checks geslaagd (monitoring-health).`);
