// ============================================================================
//  scanner/test/vercel-config.test.mjs — deploydiscipline voor de image.
// ----------------------------------------------------------------------------
//  De scanner bevat ClamAV-signatures in de containerimage. Een Git-push voor
//  ongerelateerde app-, beheer- of documentatiecode mag daarom NOOIT een nieuw
//  registry-image maken. Alleen de gecontroleerde Vercel Deploy Hook mag een
//  scannerbuild starten (dagelijkse signature-refresh of bewuste release).
// ============================================================================

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const vercelJsonUrl = new URL("../vercel.json", import.meta.url);
const refreshWorkflowUrl = new URL(
  "../../.github/workflows/scanner-signature-refresh.yml",
  import.meta.url
);

test("scanner bouwt nooit automatisch op een Git-push", async () => {
  const inhoud = await readFile(fileURLToPath(vercelJsonUrl), "utf8");
  const configuratie = JSON.parse(inhoud);

  assert.deepEqual(configuratie.git, { deploymentEnabled: false });
});

test("signatureverversing blijft via de geheime preview-hook gepland", async () => {
  const inhoud = await readFile(fileURLToPath(refreshWorkflowUrl), "utf8");

  assert.match(inhoud, /schedule:/);
  assert.match(inhoud, /cron: "17 3 \* \* \*"/);
  assert.match(inhoud, /workflow_dispatch:/);
  assert.match(inhoud, /VERCEL_SCANNER_PREVIEW_DEPLOY_HOOK_URL/);
  assert.match(inhoud, /buildCache=false/);
});
