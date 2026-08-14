// Preview/Productie-scheiding — uitvoerbare negatieve configuratiematrix.
//
// Deze tests koppelen het gedocumenteerde omgevingscontract aan de echte pure
// host-/tenantfuncties én aan de Preview-seed. Zo wordt een nieuwe Production-
// host in Preview, een ontbrekende exacte mapping of uitschakelbare enforcement
// een blokkerende regressie in CI.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { bepaalFondsContext, type TenantDomain } from "../../core/lib/tenant-host";
import {
  beoordeelToegang,
  tenantEnforceVoorOmgeving,
} from "../../core/lib/tenant-enforce";
import { bepaalRoute, bepaalSurface } from "../../core/lib/platform-host";

const PREVIEW_APP_HOSTS = [
  "app.preview.bestuurdersportaal.com",
  "pgb.preview.bestuurdersportaal.com",
  "phenc.preview.bestuurdersportaal.com",
  "huisartsenpensioen.preview.bestuurdersportaal.com",
] as const;
const PREVIEW_PLATFORM_HOST = "beheer.preview.bestuurdersportaal.com";
const PRODUCTIE_HOSTS = [
  "app.bestuurdersportaal.com",
  "beheer.bestuurdersportaal.com",
  "pgb.bestuurdersportaal.com",
  "phenc.bestuurdersportaal.com",
  "huisartsenpensioen.bestuurdersportaal.com",
  "horizon.bestuurdersportaal.com",
] as const;

const fondsPerHost = new Map(PREVIEW_APP_HOSTS.map((host, index) => [host, `fonds-${index}`]));
const domains: TenantDomain[] = PREVIEW_APP_HOSTS.map((host) => ({
  host,
  fondsId: fondsPerHost.get(host)!,
  actief: true,
}));

test("P1 — Preview-seed bevat exact vier Preview-apphosts en geen Productie-/Horizonhost", () => {
  const hier = dirname(fileURLToPath(import.meta.url));
  const seed = readFileSync(resolve(hier, "../../supabase/preview/seed.sql"), "utf8");
  const gevonden = [...seed.matchAll(/\('([^']+\.bestuurdersportaal\.com)'\s*,/g)].map(
    (match) => match[1]
  );

  assert.equal(gevonden.length, PREVIEW_APP_HOSTS.length, "geen dubbele/extrahost");
  assert.deepEqual(new Set(gevonden), new Set(PREVIEW_APP_HOSTS));
  for (const host of PRODUCTIE_HOSTS) assert.equal(gevonden.includes(host), false, host);
});

test("P2 — alle vier Preview-apphosts resolveren exact naar hun eigen tenant", () => {
  for (const host of PREVIEW_APP_HOSTS) {
    assert.deepEqual(bepaalFondsContext({ host, domains }), {
      type: "gevonden",
      fondsId: fondsPerHost.get(host),
    });
  }
});

test("P3 — iedere Preview-tenant wordt op alle drie vreemde Previewhosts geweigerd", () => {
  for (const sessieHost of PREVIEW_APP_HOSTS) {
    const sessieFondsId = fondsPerHost.get(sessieHost)!;
    for (const requestHost of PREVIEW_APP_HOSTS) {
      if (requestHost === sessieHost) continue;
      const resolutie = bepaalFondsContext({ host: requestHost, domains });
      assert.deepEqual(beoordeelToegang({ resolutie, sessieFondsId, enforce: true }), {
        toegestaan: false,
        reden: "fonds-mismatch",
      });
    }
  }
});

test("P4 — onbekende Preview-, Productie- en Vercelhosts openen geen Preview-tenant", () => {
  const onbekendeHosts = [
    "onbekend.preview.bestuurdersportaal.com",
    "app.bestuurdersportaal.com",
    "willekeurig.vercel.app",
    null,
  ];
  for (const host of onbekendeHosts) {
    const resolutie = bepaalFondsContext({ host, domains });
    assert.deepEqual(
      beoordeelToegang({ resolutie, sessieFondsId: "fonds-0", enforce: true }),
      { toegestaan: false, reden: "onbekende-host" }
    );
  }
});

test("P5 — Vercel Preview/Staging en Production blijven enforced bij ontbrekende of foute vlag", () => {
  for (const args of [
    { vercelEnv: "preview", tenantEnforce: "off" },
    { vercelTargetEnv: "staging", tenantEnforce: "" },
    { vercelEnv: "production", tenantEnforce: undefined },
  ]) {
    assert.equal(tenantEnforceVoorOmgeving(args), true);
  }
});

test("P6 — Preview-beheer is alleen platform; apphosts lekken geen platformroutes", () => {
  const appHostList = PREVIEW_APP_HOSTS.join(",");
  assert.equal(
    bepaalSurface({
      host: PREVIEW_PLATFORM_HOST,
      appHost: appHostList,
      platformHost: PREVIEW_PLATFORM_HOST,
    }),
    "platform"
  );

  for (const host of PREVIEW_APP_HOSTS) {
    const surface = bepaalSurface({
      host,
      appHost: appHostList,
      platformHost: PREVIEW_PLATFORM_HOST,
    });
    assert.equal(surface, "app");
    assert.deepEqual(bepaalRoute({ surface, pathname: "/platform/gebruikers" }), {
      type: "notFound",
    });
  }
});
