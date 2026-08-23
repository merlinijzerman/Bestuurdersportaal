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

test("scanner bouwt nooit automatisch op een Git-push", async () => {
  const inhoud = await readFile(fileURLToPath(vercelJsonUrl), "utf8");
  const configuratie = JSON.parse(inhoud);

  assert.deepEqual(configuratie.git, { deploymentEnabled: false });
});
