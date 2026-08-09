// ============================================================================
// T6 — Afschrift-tijdlijn + auditlog (C2/C4): deterministisch, beide sporen.
// ----------------------------------------------------------------------------
// KERNCORRECTIE (ontwerpbeslissing 8): er zijn twee auditsporen. Een tijdlijn
// uit één spoor is aantoonbaar onvolledig. Deze module voegt procedure_log
// (spoor 'proces') en governance_events (spoor 'besluit', mét hash) samen op
// tijdstip, met een expliciete spoor-kolom en besluit_code waar van toepassing.
//
// Twee weergaven uit dezelfde merge:
//   • 02_Tijdlijn  — leesbaar (HTML + CSV), met labels uit audit-labels.ts.
//   • 03_Auditlog  — ruw (CSV + JSON), met bron-kolom, hash, en oude/nieuwe
//                    waarde. procedure_log heeft GEEN hash — dat wordt in de
//                    inhoudsopgave/§6 vermeld, zodat niemand denkt dat de
//                    integriteitsgarantie voor beide sporen even sterk is.
//
// Puur en zonder DB (input = AfschriftBron). Geen taalmodel: dit is laag B.
// ============================================================================

import { auditEventLabel } from "./audit-labels";
import type { AfschriftBron } from "./afschrift-types";

export type Spoor = "proces" | "besluit";

/** Eén samengevoegde auditregel (raw + afgeleid label). */
export interface AuditRegel {
  tijdstip: string; // ISO
  spoor: Spoor;
  besluit_code: string | null;
  event_type: string;
  label: string;
  actor: string | null;
  hash: string | null; // alleen 'besluit'-spoor
  reden: string | null;
  oude_waarde: unknown;
  nieuwe_waarde: unknown;
  payload: Record<string, unknown> | null; // alleen 'proces'-spoor
}

export interface TijdlijnMeta {
  procescode: string;
  procedureTitel: string;
  versie: string;
  gegenereerdOp: string; // ISO
}

// ── Merge ────────────────────────────────────────────────────────────────────

/** Voegt beide sporen samen tot één chronologische, deterministische reeks. */
export function bouwAuditRegels(bron: AfschriftBron): AuditRegel[] {
  const regels: AuditRegel[] = [];

  // Spoor 'proces' — procedure_log.
  for (const log of bron.procedureLog) {
    regels.push({
      tijdstip: log.tijdstip,
      spoor: "proces",
      besluit_code: null,
      event_type: log.event_type,
      label: auditEventLabel(log.event_type),
      actor: log.actor_naam,
      hash: null,
      reden: null,
      oude_waarde: null,
      nieuwe_waarde: null,
      payload: log.payload ?? null,
    });
  }

  // Spoor 'besluit' — governance_events per Decision Object (ontdubbeld op id).
  const gezien = new Set<string>();
  for (const view of bron.decisions) {
    const code = view.decision.besluit_code;
    for (const e of view.events) {
      if (gezien.has(e.id)) continue;
      gezien.add(e.id);
      regels.push({
        tijdstip: e.tijdstip,
        spoor: "besluit",
        besluit_code: code,
        event_type: e.event_type,
        label: auditEventLabel(e.event_type),
        actor: e.actor_naam,
        hash: e.hash,
        reden: e.reden,
        oude_waarde: e.oude_waarde,
        nieuwe_waarde: e.nieuwe_waarde,
        payload: null,
      });
    }
  }

  // Chronologisch, met stabiele deterministische tie-break.
  regels.sort((a, b) => {
    const ta = Date.parse(a.tijdstip);
    const tb = Date.parse(b.tijdstip);
    if (ta !== tb) return ta - tb;
    if (a.spoor !== b.spoor) return a.spoor < b.spoor ? -1 : 1;
    if (a.event_type !== b.event_type) return a.event_type < b.event_type ? -1 : 1;
    return (a.besluit_code ?? "") < (b.besluit_code ?? "") ? -1 : 1;
  });

  return regels;
}

// ── Hulp: formattering ───────────────────────────────────────────────────────

function htmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** RFC 4180 CSV-cel: altijd quoten, interne quotes verdubbelen. */
function csvCel(waarde: unknown): string {
  const s = waarde === null || waarde === undefined ? "" : String(waarde);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRij(cellen: unknown[]): string {
  return cellen.map(csvCel).join(",");
}

function jsonKort(waarde: unknown): string {
  if (waarde === null || waarde === undefined) return "";
  if (typeof waarde === "string") return waarde;
  try {
    return JSON.stringify(waarde);
  } catch {
    return String(waarde);
  }
}

/** Korte, leesbare omschrijving voor de tijdlijn-weergave. */
function beschrijf(r: AuditRegel): string {
  if (r.spoor === "proces") {
    if (!r.payload) return "";
    const delen = Object.entries(r.payload)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : jsonKort(v)}`);
    return delen.join(" · ");
  }
  if (r.reden) return r.reden;
  const nw = jsonKort(r.nieuwe_waarde);
  return nw.length > 160 ? nw.slice(0, 157) + "…" : nw;
}

function datumTijd(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  // Vaste, locale-onafhankelijke weergave (deterministisch, geen toLocale…).
  return iso.replace("T", " ").replace(/\.\d+Z$/, "Z").replace(/Z$/, " UTC");
}

// ── 02_Tijdlijn ──────────────────────────────────────────────────────────────

export function tijdlijnCSV(regels: AuditRegel[]): string {
  const kop = ["tijdstip", "spoor", "besluit_code", "event_type", "label", "actor", "hash", "omschrijving"];
  const rijen = regels.map((r) =>
    csvRij([r.tijdstip, r.spoor, r.besluit_code, r.event_type, r.label, r.actor, r.hash, beschrijf(r)])
  );
  return [csvRij(kop), ...rijen].join("\r\n") + "\r\n";
}

export function tijdlijnHTML(regels: AuditRegel[], meta: TijdlijnMeta): string {
  const rijen = regels
    .map((r) => {
      const spoorKlasse = r.spoor === "besluit" ? "sp-besluit" : "sp-proces";
      return `<tr class="${spoorKlasse}">
  <td class="t">${htmlEsc(datumTijd(r.tijdstip))}</td>
  <td><span class="badge ${spoorKlasse}">${htmlEsc(r.spoor)}</span></td>
  <td>${htmlEsc(r.besluit_code ?? "")}</td>
  <td>${htmlEsc(r.label)}</td>
  <td>${htmlEsc(r.actor ?? "")}</td>
  <td class="d">${htmlEsc(beschrijf(r))}</td>
  <td class="h">${htmlEsc(r.hash ? r.hash.slice(0, 12) : "—")}</td>
</tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8">
<title>Tijdlijn — ${htmlEsc(meta.procescode)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 2rem; font-size: 13px; }
  h1 { font-size: 18px; margin: 0 0 .2rem; }
  .meta { color: #555; margin-bottom: 1.2rem; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid #e5e5e5; }
  th { background: #f5f5f5; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  td.t { white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.h { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #777; white-space: nowrap; }
  td.d { color: #333; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; }
  .badge.sp-proces { background: #eef2ff; color: #3730a3; }
  .badge.sp-besluit { background: #ecfdf5; color: #065f46; }
  tr.sp-besluit td.t { border-left: 3px solid #10b981; padding-left: 6px; }
  tr.sp-proces td.t { border-left: 3px solid #6366f1; padding-left: 6px; }
  @media print { body { margin: 0; } th { background: #f0f0f0 !important; -webkit-print-color-adjust: exact; } }
</style></head>
<body>
<h1>Tijdlijn — ${htmlEsc(meta.procedureTitel)}</h1>
<div class="meta">${htmlEsc(meta.procescode)} · versie ${htmlEsc(meta.versie)} · gegenereerd ${htmlEsc(datumTijd(meta.gegenereerdOp))} · ${regels.length} gebeurtenissen uit beide auditsporen (proces + besluit)</div>
<table>
  <thead><tr><th>Tijdstip (UTC)</th><th>Spoor</th><th>Besluit</th><th>Gebeurtenis</th><th>Actor</th><th>Omschrijving</th><th>Hash</th></tr></thead>
  <tbody>
${rijen}
  </tbody>
</table>
</body></html>
`;
}

// ── 03_Auditlog ──────────────────────────────────────────────────────────────

export function auditlogCSV(regels: AuditRegel[]): string {
  const kop = ["tijdstip", "bron", "besluit_code", "event_type", "label", "actor", "hash", "reden", "oude_waarde", "nieuwe_waarde", "payload"];
  const rijen = regels.map((r) =>
    csvRij([
      r.tijdstip, r.spoor, r.besluit_code, r.event_type, r.label, r.actor, r.hash,
      r.reden, jsonKort(r.oude_waarde), jsonKort(r.nieuwe_waarde), jsonKort(r.payload),
    ])
  );
  return [csvRij(kop), ...rijen].join("\r\n") + "\r\n";
}

export function auditlogJSON(regels: AuditRegel[]): string {
  // `bron` = spoor, expliciet zoals in de inhoudsopgave beschreven.
  const items = regels.map((r) => ({
    tijdstip: r.tijdstip,
    bron: r.spoor,
    besluit_code: r.besluit_code,
    event_type: r.event_type,
    label: r.label,
    actor: r.actor,
    hash: r.hash,
    reden: r.reden,
    oude_waarde: r.oude_waarde ?? null,
    nieuwe_waarde: r.nieuwe_waarde ?? null,
    payload: r.payload ?? null,
  }));
  return JSON.stringify(items, null, 2);
}
