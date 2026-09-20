// ============================================================================
//  #407 labsmoke — hermetische tests op de registrylezer.
// ----------------------------------------------------------------------------
//  Geen netwerk, geen echte registry: elke test bouwt zijn eigen registratie in
//  een tijdelijke map en verandert er precies één ding aan. Zo toetst elke
//  assertie één grendel, en niet "de lezer doet het nog".
// ============================================================================
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { LAB_PROFIEL_ID, RegistryFout, leesLabprofiel, registryMap } from "./registry";

const TENANT = "77358864-32ba-454f-9e48-cf3356d115dd";

/** De geldige basisregistratie; elke test muteert hier een kopie van. */
function basis(): Record<string, unknown> {
  return {
    "retrieval-profiles.json": {
      retrieval_profiles: [
        {
          id: LAB_PROFIEL_ID,
          environment_id: "microsoft_lab",
          tenant_id: "entra_lab",
          identity_id: "lab_test",
          application_id: "lab_app",
          data_source_id: "lab_bron",
          adapter: "microsoft_365_copilot_retrieval",
          permission_model: "delegated",
          production_wiring: false,
        },
      ],
    },
    "environments.json": {
      environments: [{ id: "microsoft_lab", tenant_id: TENANT }],
    },
    "tenants.json": {
      tenants: [{ id: "entra_lab", environment_id: "microsoft_lab", tenant_id: TENANT, primary_domain: "Lab.onmicrosoft.com" }],
    },
    "identities.json": {
      identities: [
        {
          id: "lab_test",
          environment_id: "microsoft_lab",
          account: "pgb-test@Lab.onmicrosoft.com",
          object_id: "076CE16F-74A2-4CC7-874B-7761E7747708",
        },
      ],
    },
    "applications.json": {
      applications: [
        {
          id: "lab_app",
          tenant_id: "entra_lab",
          client_id: "A23CC4CA-C0B3-4D32-B69E-06E4C894DA7D",
          credential_model: "public_client_pkce",
          redirect_uris: ["http://localhost"],
          delegated_permissions: ["User.Read", "Files.Read.All", "Sites.Read.All"],
          client_secret_present: false,
        },
      ],
    },
    "data-sources.json": {
      data_sources: [
        {
          id: "lab_bron",
          tenant_id: "entra_lab",
          kind: "sharepoint_site",
          site_url: "https://lab.sharepoint.com/sites/PGBRetrievalLab",
          root_url: "https://lab.sharepoint.com/sites/PGBRetrievalLab/Shared Documents",
          index_status: "reindex_requested_zero_results",
          index_checked_at: "2026-09-20",
        },
      ],
    },
  };
}

function schrijf(inhoud: Record<string, unknown>): string {
  const map = mkdtempSync(join(tmpdir(), "labsmoke-registry-"));
  mkdirSync(join(map, "registry"));
  for (const [bestand, data] of Object.entries(inhoud)) {
    writeFileSync(join(map, "registry", bestand), JSON.stringify(data), "utf8");
  }
  return map;
}

function metMutatie(muteer: (inhoud: Record<string, any>) => void): string {
  const inhoud = basis();
  muteer(inhoud as Record<string, any>);
  return schrijf(inhoud);
}

test("leest het labprofiel en normaliseert tenant, actor en client naar kleine letters", () => {
  const map = schrijf(basis());
  try {
    const profiel = leesLabprofiel(map);
    assert.equal(profiel.profielId, LAB_PROFIEL_ID);
    assert.equal(profiel.tenantId, TENANT);
    assert.equal(profiel.actorObjectId, "076ce16f-74a2-4cc7-874b-7761e7747708");
    assert.equal(profiel.clientId, "a23cc4ca-c0b3-4d32-b69e-06e4c894da7d");
    assert.equal(profiel.siteHostnaam, "lab.sharepoint.com");
    assert.equal(profiel.siteRelatiefPad, "/sites/PGBRetrievalLab");
    assert.equal(profiel.indexStatus, "reindex_requested_zero_results");
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
});

test("weigert elk ander profiel-id dan het labprofiel", () => {
  const map = schrijf(basis());
  try {
    assert.throws(
      () => leesLabprofiel(map, "pgb_preview_sharepoint_driveitem"),
      (fout: RegistryFout) => fout.code === "profiel_niet_toegestaan",
    );
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
});

test("stopt bij kruisverwijzingen die naar verschillende tenants wijzen", () => {
  const map = metMutatie((inhoud) => {
    inhoud["applications.json"].applications[0].tenant_id = "entra_the_paradox";
  });
  try {
    assert.throws(
      () => leesLabprofiel(map),
      (fout: RegistryFout) => fout.code === "registratie_inconsistent",
    );
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
});

test("stopt wanneer environment en tenant een andere tenant-GUID dragen", () => {
  const map = metMutatie((inhoud) => {
    inhoud["environments.json"].environments[0].tenant_id = "00000000-0000-0000-0000-000000000000";
  });
  try {
    assert.throws(() => leesLabprofiel(map), (fout: RegistryFout) => fout.code === "registratie_inconsistent");
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
});

test("weigert een appregistratie die een secret draagt of geen public client is", () => {
  const metSecret = metMutatie((inhoud) => {
    inhoud["applications.json"].applications[0].secret_ref = "keychain://x/y";
  });
  const confidential = metMutatie((inhoud) => {
    inhoud["applications.json"].applications[0].credential_model = "confidential_client";
  });
  try {
    assert.throws(() => leesLabprofiel(metSecret), (fout: RegistryFout) => fout.code === "app_heeft_secret");
    assert.throws(() => leesLabprofiel(confidential), (fout: RegistryFout) => fout.code === "registratie_inconsistent");
  } finally {
    rmSync(metSecret, { recursive: true, force: true });
    rmSync(confidential, { recursive: true, force: true });
  }
});

test("weigert een profiel dat aan productie is gekoppeld of een andere adapter draait", () => {
  const gekoppeld = metMutatie((inhoud) => {
    inhoud["retrieval-profiles.json"].retrieval_profiles[0].production_wiring = true;
  });
  const andereAdapter = metMutatie((inhoud) => {
    inhoud["retrieval-profiles.json"].retrieval_profiles[0].adapter = "graph_driveitem_search";
  });
  try {
    assert.throws(() => leesLabprofiel(gekoppeld), (fout: RegistryFout) => fout.code === "profiel_productiegekoppeld");
    assert.throws(() => leesLabprofiel(andereAdapter), (fout: RegistryFout) => fout.code === "registratie_inconsistent");
  } finally {
    rmSync(gekoppeld, { recursive: true, force: true });
    rmSync(andereAdapter, { recursive: true, force: true });
  }
});

test("weigert een bronroot die buiten de geregistreerde site ligt", () => {
  const map = metMutatie((inhoud) => {
    inhoud["data-sources.json"].data_sources[0].root_url = "https://lab.sharepoint.com/sites/AndereSite/Shared Documents";
  });
  try {
    assert.throws(() => leesLabprofiel(map), (fout: RegistryFout) => fout.code === "bron_root_ongeldig");
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
});

test("weigert een site-URL met query, poort of niet-SharePoint-host", () => {
  for (const [siteUrl, waarom] of [
    ["https://lab.sharepoint.com/sites/PGBRetrievalLab?x=1", "query"],
    ["https://lab.sharepoint.com:8443/sites/PGBRetrievalLab", "poort"],
    ["https://lab.example.com/sites/PGBRetrievalLab", "host"],
  ] as const) {
    const map = metMutatie((inhoud) => {
      inhoud["data-sources.json"].data_sources[0].site_url = siteUrl;
      inhoud["data-sources.json"].data_sources[0].root_url = `${siteUrl}/Shared Documents`;
    });
    try {
      assert.throws(
        () => leesLabprofiel(map),
        (fout: RegistryFout) => fout.code === "bron_site_ongeldig" || fout.code === "bron_root_ongeldig",
        `site-URL met ${waarom} werd geaccepteerd`,
      );
    } finally {
      rmSync(map, { recursive: true, force: true });
    }
  }
});

test("stopt wanneer een id tweemaal voorkomt — dan is de run niet reproduceerbaar", () => {
  const map = metMutatie((inhoud) => {
    inhoud["identities.json"].identities.push({ ...inhoud["identities.json"].identities[0] });
  });
  try {
    assert.throws(() => leesLabprofiel(map), (fout: RegistryFout) => fout.code === "registratie_dubbel");
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
});

test("registryMap volgt INTEGRATIES_REGISTRY_DIR en valt anders terug op de zustermap", () => {
  const eerder = process.env.INTEGRATIES_REGISTRY_DIR;
  try {
    delete process.env.INTEGRATIES_REGISTRY_DIR;
    assert.equal(registryMap("/repo/mvp"), resolve("/repo/mvp", "..", "bestuurdersportaal-integraties"));
    process.env.INTEGRATIES_REGISTRY_DIR = "/elders/registry";
    assert.equal(registryMap("/repo/mvp"), "/elders/registry");
    process.env.INTEGRATIES_REGISTRY_DIR = "relatief";
    assert.equal(registryMap("/repo/mvp"), resolve("/repo/mvp", "relatief"));
  } finally {
    if (eerder === undefined) delete process.env.INTEGRATIES_REGISTRY_DIR;
    else process.env.INTEGRATIES_REGISTRY_DIR = eerder;
  }
});
