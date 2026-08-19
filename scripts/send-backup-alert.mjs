#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const CATEGORY_LABELS = Object.freeze({
  backup_failed: "back-up mislukt",
  b2_evidence_invalid: "B2-bewijs ongeldig",
  alert_channel_unconfigured: "alertkanaal niet geconfigureerd",
});

function optionalValue(env, name) {
  const value = env[name]?.trim();
  return value || null;
}

export function buildAlert({ env = process.env, now = new Date() } = {}) {
  const category = optionalValue(env, "ALERT_CATEGORY") || "b2_evidence_invalid";
  const categoryLabel = CATEGORY_LABELS[category];
  if (!categoryLabel) throw new Error(`Onbekende alertcategorie: ${category}`);

  const severity = optionalValue(env, "ALERT_SEVERITY") || "critical";
  const reason = optionalValue(env, "ALERT_REASON") || "onbekende back-upafwijking";
  const details = optionalValue(env, "ALERT_DETAILS") || "Geen verdere details beschikbaar.";
  const runUrl = optionalValue(env, "ALERT_RUN_URL");

  return {
    category,
    categoryLabel,
    payload: {
      text: `[${severity.toUpperCase()}] Supabase-back-up · ${categoryLabel}: ${reason}`,
      category,
      severity,
      reason,
      details,
      repository: optionalValue(env, "GITHUB_REPOSITORY"),
      workflow_run_url: runUrl,
      emitted_at: now.toISOString(),
    },
  };
}

async function writeSummary(message, env) {
  const summaryPath = optionalValue(env, "GITHUB_STEP_SUMMARY");
  if (summaryPath) await appendFile(summaryPath, `${message}\n`, "utf8");
}

export async function sendBackupAlert({ env = process.env, fetchImpl = fetch, now = new Date() } = {}) {
  const webhookUrl = optionalValue(env, "BACKUP_ALERT_WEBHOOK_URL");
  const webhookRequired = optionalValue(env, "ALERT_WEBHOOK_REQUIRED") === "true";
  const alert = buildAlert({ env, now });

  if (!webhookUrl) {
    const message = `Alertkanaal niet geconfigureerd; ${alert.categoryLabel}: ${alert.payload.reason}`;
    process.stderr.write(`::warning title=Alertkanaal niet geconfigureerd::${message}\n`);
    await writeSummary(`- Alertkanaal niet geconfigureerd; niet verzonden: **${alert.categoryLabel}** — ${alert.payload.reason}`, env);
    if (webhookRequired) throw new Error("BACKUP_ALERT_WEBHOOK_URL ontbreekt");
    return { delivered: false, ...alert };
  }

  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify(alert.payload),
  });

  if (!response.ok) throw new Error(`Back-upalert gaf HTTP ${response.status}`);

  process.stdout.write(
    `Back-upalert verzonden: ${alert.categoryLabel} · ${alert.payload.severity} · ${alert.payload.reason}\n`,
  );
  return { delivered: true, ...alert };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  sendBackupAlert().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
