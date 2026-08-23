import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("scanner schakelt automatische Git-deployments uit", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8")
  );

  assert.equal(config.git?.deploymentEnabled, false);
});
