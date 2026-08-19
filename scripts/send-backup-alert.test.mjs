import assert from "node:assert/strict";
import test from "node:test";

import { buildAlert, sendBackupAlert } from "./send-backup-alert.mjs";

test("maakt de drie alertsoorten ondubbelzinnig", () => {
  for (const [category, label] of [
    ["backup_failed", "back-up mislukt"],
    ["b2_evidence_invalid", "B2-bewijs ongeldig"],
    ["alert_channel_unconfigured", "alertkanaal niet geconfigureerd"],
  ]) {
    const alert = buildAlert({
      env: { ALERT_CATEGORY: category, ALERT_REASON: "synthetische test" },
      now: new Date("2026-08-19T12:00:00Z"),
    });
    assert.equal(alert.categoryLabel, label);
    assert.match(alert.payload.text, new RegExp(label));
    assert.equal(alert.payload.category, category);
  }
});

test("laat de inhoudelijke fout leidend als het webhookkanaal ontbreekt", async () => {
  const result = await sendBackupAlert({
    env: {
      ALERT_CATEGORY: "b2_evidence_invalid",
      ALERT_REASON: "completion marker beschadigd",
    },
  });
  assert.equal(result.delivered, false);
  assert.equal(result.payload.reason, "completion marker beschadigd");
});

test("faalt expliciet als alertdelivery verplicht is maar de webhook ontbreekt", async () => {
  await assert.rejects(
    sendBackupAlert({
      env: {
        ALERT_CATEGORY: "backup_failed",
        ALERT_REASON: "workflow rood",
        ALERT_WEBHOOK_REQUIRED: "true",
      },
    }),
    /BACKUP_ALERT_WEBHOOK_URL ontbreekt/,
  );
});

test("verstuurt categorie en reden naar de geconfigureerde webhook", async () => {
  let request;
  const result = await sendBackupAlert({
    env: {
      BACKUP_ALERT_WEBHOOK_URL: "https://alerts.example.invalid/hook",
      ALERT_CATEGORY: "backup_failed",
      ALERT_REASON: "synthetische workflowfout",
      ALERT_SEVERITY: "critical",
      GITHUB_REPOSITORY: "merlinijzerman/Bestuurdersportaal",
    },
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(null, { status: 204 });
    },
    now: new Date("2026-08-19T12:00:00Z"),
  });

  assert.equal(result.delivered, true);
  assert.equal(request.url, "https://alerts.example.invalid/hook");
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.category, "backup_failed");
  assert.match(payload.text, /back-up mislukt/);
  assert.equal(payload.reason, "synthetische workflowfout");
});
