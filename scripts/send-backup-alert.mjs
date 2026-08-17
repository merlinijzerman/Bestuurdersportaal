#!/usr/bin/env node

const webhookUrl = process.env.BACKUP_ALERT_WEBHOOK_URL?.trim();
if (!webhookUrl) throw new Error("BACKUP_ALERT_WEBHOOK_URL ontbreekt");

const severity = process.env.ALERT_SEVERITY?.trim() || "critical";
const reason = process.env.ALERT_REASON?.trim() || "onbekende back-upafwijking";
const details = process.env.ALERT_DETAILS?.trim() || "Geen verdere details beschikbaar.";
const runUrl = process.env.ALERT_RUN_URL?.trim() || null;

const response = await fetch(webhookUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  signal: AbortSignal.timeout(10_000),
  body: JSON.stringify({
    text: `[${severity.toUpperCase()}] Supabase-back-up: ${reason}`,
    severity,
    reason,
    details,
    repository: process.env.GITHUB_REPOSITORY ?? null,
    workflow_run_url: runUrl,
    emitted_at: new Date().toISOString(),
  }),
});

if (!response.ok) {
  throw new Error(`Back-upalert gaf HTTP ${response.status}`);
}

process.stdout.write(`Back-upalert verzonden: ${severity} · ${reason}\n`);
