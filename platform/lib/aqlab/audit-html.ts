// lib/aqlab/audit-html.ts
// -----------------------------------------------------------------------------
// AQLab — HTML-renderer voor het BEVROREN auditrapport (AQL-4, functioneel
// scherm 8). Pure string-builder in de stijl van lib/auditdossier-html.ts: een
// server-side gerenderde, A4-print-vriendelijke HTML die standalone leesbaar is
// (geen Next.js runtime / CSS-bundling nodig). Doet GEEN DB-calls — alle data zit
// in de meegegeven view (bevriezing gebeurt in lib/aqlab/audit-export.ts).
//
// De inhoud_hash (sha256) wordt door de export-service over de HIER geretourneerde
// string berekend en apart (append-only, aqlab_audit_exports) vastgelegd; hij
// wordt bewust NIET in de HTML zelf geëmbed (anders zou de hash over zichzelf
// lopen). Verificatie = opgeslagen bytes opnieuw hashen = match.
// -----------------------------------------------------------------------------

import { DISCLAIMER_44, SCOPE_BANNER_PRODUCTBREED, SCOPE_LABEL } from "../../../core/lib/aqlab/assurance-teksten";

function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDatumTijd(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("nl-NL", {
      day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

export interface AqlabAuditScore {
  criterium: string;
  methode: string;
  score: number | null;
  pass: boolean | null;
  motivatie: string | null;
  meetbeperking: string | null;
}

export interface AqlabAuditFinding {
  ernst: string;
  type: string | null;
  omschrijving: string | null;
  status: string;
}

export interface AqlabAuditReview {
  oordeel: string;
  motivatie: string | null;
  door: string | null;
  op: string | null;
}

/** Zelf-bevattende view voor het auditrapport. Alle velden zijn al opgelost door
 *  de export-service; de renderer voegt niets toe behalve opmaak + disclaimer. */
export interface AqlabAuditView {
  feature: { code: string; naam: string };
  variant: { prompt_versie: string | null; model_config: string | null };
  run: { id: string; run_type: string; gestart_op: string | null; voltooid_op: string | null };
  testset: { code: string | null; naam: string | null; aantal_testgevallen: number };
  snapshot_hashes: string[];
  scores: AqlabAuditScore[];
  findings: AqlabAuditFinding[];
  human_reviews: AqlabAuditReview[];
  regressie: { release_advies: string | null; samenvatting: string | null };
  besluit: {
    release_status: string;
    besluit: string | null;
    besluit_door_naam: string | null;
    besluit_op: string | null;
    motivatie: string | null;
    kritieke_bevindingen_count: number;
    assurance_scope: string;
  };
  gegenereerd_op: string;
  gegenereerd_door_naam: string | null;
}

function rijen(cells: (string | number | null)[][], head: string[]): string {
  const thead = `<thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`;
  const tbody = cells.length
    ? cells.map((r) => `<tr>${r.map((c) => `<td>${esc(c === null ? "—" : String(c))}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${head.length}" class="leeg">Geen gegevens</td></tr>`;
  return `<table>${thead}<tbody>${tbody}</tbody></table>`;
}

/** Rendert het bevroren auditrapport als volledige HTML-string. */
export function renderAqlabAuditHtml(view: AqlabAuditView): string {
  const scopeLabel = SCOPE_LABEL[view.besluit.assurance_scope] ?? view.besluit.assurance_scope;

  const scoresTabel = rijen(
    view.scores.map((s) => [
      s.criterium,
      s.methode,
      s.score === null ? "—" : String(s.score),
      s.pass === null ? "—" : s.pass ? "voldoet" : "voldoet niet",
      s.motivatie,
      s.meetbeperking,
    ]),
    ["Criterium", "Methode", "Score", "Oordeel", "Motivatie", "Meetbeperking"]
  );

  const findingsTabel = rijen(
    view.findings.map((f) => [f.ernst, f.type, f.omschrijving, f.status]),
    ["Ernst", "Type", "Omschrijving", "Status"]
  );

  const reviewsTabel = rijen(
    view.human_reviews.map((r) => [r.oordeel, r.door, fmtDatumTijd(r.op), r.motivatie]),
    ["Oordeel", "Beoordelaar", "Tijdstip", "Motivatie"]
  );

  const snapshotTabel = rijen(
    view.snapshot_hashes.map((h) => [h]),
    ["Snapshot-hash (sha256)"]
  );

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AQLab auditrapport — ${esc(view.feature.naam)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
         color: #1a1a1a; line-height: 1.5; font-size: 12px; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 22px 0 6px; border-bottom: 2px solid #e5e5e5; padding-bottom: 3px; }
  .sub { color: #555; font-size: 12px; margin: 0 0 14px; }
  .disclaimer { background: #fff8e6; border: 1px solid #e6c15a; border-radius: 8px;
                padding: 10px 12px; margin: 12px 0 18px; font-size: 11.5px; }
  .disclaimer strong { display: block; margin-bottom: 3px; }
  .kv { display: grid; grid-template-columns: 210px 1fr; gap: 2px 12px; margin: 8px 0; }
  .kv dt { color: #555; }
  .kv dd { margin: 0; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; font-size: 11px; }
  th, td { text-align: left; border: 1px solid #ddd; padding: 4px 6px; vertical-align: top; }
  th { background: #f3f3f3; }
  td.leeg { color: #888; font-style: italic; text-align: center; }
  .besluit-vrij { color: #1a7f37; font-weight: 700; }
  .besluit-blok { color: #b3261e; font-weight: 700; }
  footer { margin-top: 24px; border-top: 1px solid #ddd; padding-top: 8px; color: #555; font-size: 10.5px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
</style>
</head>
<body>
  <h1>AI Quality Lab — Auditrapport</h1>
  <p class="sub">${esc(view.feature.naam)} (${esc(view.feature.code)}) · ${esc(scopeLabel)}</p>

  <div class="disclaimer">
    <strong>Disclaimer (geen juridische garantie)</strong>
    ${esc(DISCLAIMER_44)}
  </div>
  ${view.besluit.assurance_scope === "productbreed" ? `<p class="sub"><strong>${esc(scopeLabel)}.</strong> ${esc(SCOPE_BANNER_PRODUCTBREED)}</p>` : ""}

  <h2>1. Feature &amp; variant</h2>
  <dl class="kv">
    <dt>AI-feature</dt><dd>${esc(view.feature.naam)} (${esc(view.feature.code)})</dd>
    <dt>Promptversie</dt><dd>${esc(view.variant.prompt_versie ?? "—")}</dd>
    <dt>Modelconfiguratie</dt><dd>${esc(view.variant.model_config ?? "—")}</dd>
    <dt>Type controle (scope)</dt><dd>${esc(scopeLabel)}</dd>
  </dl>

  <h2>2. Testset &amp; run</h2>
  <dl class="kv">
    <dt>Testset</dt><dd>${esc(view.testset.naam ?? "—")}${view.testset.code ? ` (${esc(view.testset.code)})` : ""}</dd>
    <dt>Aantal testgevallen</dt><dd>${esc(view.testset.aantal_testgevallen)}</dd>
    <dt>Run-type</dt><dd>${esc(view.run.run_type)}</dd>
    <dt>Run-id</dt><dd class="mono">${esc(view.run.id)}</dd>
    <dt>Gedraaid</dt><dd>${esc(fmtDatumTijd(view.run.voltooid_op ?? view.run.gestart_op))}</dd>
  </dl>
  ${snapshotTabel}

  <h2>3. Scores per criterium</h2>
  ${scoresTabel}

  <h2>4. Blokkades &amp; bevindingen</h2>
  ${findingsTabel}

  <h2>5. Menselijke reviews</h2>
  ${reviewsTabel}

  <h2>6. Regressie-uitkomst</h2>
  <dl class="kv">
    <dt>Releaseadvies (run)</dt><dd>${esc(view.regressie.release_advies ?? "—")}</dd>
    <dt>Samenvatting</dt><dd>${esc(view.regressie.samenvatting ?? "—")}</dd>
  </dl>

  <h2>7. Go/no-go-besluit</h2>
  <dl class="kv">
    <dt>Releasestatus</dt><dd>${esc(view.besluit.release_status)}</dd>
    <dt>Besluit</dt><dd class="${view.besluit.besluit === "vrijgegeven" ? "besluit-vrij" : view.besluit.besluit === "geblokkeerd" ? "besluit-blok" : ""}">${esc(view.besluit.besluit ?? "—")}</dd>
    <dt>Besluitnemer</dt><dd>${esc(view.besluit.besluit_door_naam ?? "—")}</dd>
    <dt>Besluittijdstip</dt><dd>${esc(fmtDatumTijd(view.besluit.besluit_op))}</dd>
    <dt>Open kritieke bevindingen</dt><dd>${esc(view.besluit.kritieke_bevindingen_count)}</dd>
    <dt>Motivatie</dt><dd>${esc(view.besluit.motivatie ?? "—")}</dd>
  </dl>

  <footer>
    <div>Gegenereerd op ${esc(fmtDatumTijd(view.gegenereerd_op))}${view.gegenereerd_door_naam ? ` door ${esc(view.gegenereerd_door_naam)}` : ""}.</div>
    <div>De verificatiehash (sha256) van dit rapport is append-only vastgelegd in het auditregister (aqlab_audit_exports). Herberekening van de opgeslagen inhoud moet exact overeenkomen.</div>
  </footer>
</body>
</html>`;
}
