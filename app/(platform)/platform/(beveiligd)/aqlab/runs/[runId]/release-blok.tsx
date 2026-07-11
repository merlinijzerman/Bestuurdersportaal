// app/(platform)/platform/(beveiligd)/aqlab/runs/[runId]/release-blok.tsx
// -----------------------------------------------------------------------------
// Scherm 8 (platform-console) — vrijgavebesluit + auditrapport. Read/write:
//   • Vrijgavebesluit vastleggen (CAP_GOVERN) — 7 statussen, formeel go/no-go,
//     motivatie verplicht bij afwijken/subset-vrijgave; kritieke bevinding blokkeert.
//   • Auditrapport genereren (bevroren HTML + inhoud_hash) + integriteit verifiëren.
// Server component met server-action-forms (geen client-JS). Alleen platform-console.
// -----------------------------------------------------------------------------

import { legVrijgaveActie, genereerAuditActie, verifieerAuditActie } from "../../acties";
import type { ReleaseConsoleContext } from "@/lib/aqlab/release";

// Het formele besluit volgt uit de status (vrijgegeven/geblokkeerd = go/no-go);
// er is bewust GÉÉN los besluit-veld (voorkomt status↔besluit-inconsistentie).
const STATUS_OPTIES: { waarde: string; label: string; formeel: boolean }[] = [
  { waarde: "getest", label: "Getest (run voltooid)", formeel: false },
  { waarde: "review_vereist", label: "Review vereist", formeel: false },
  { waarde: "aangepast", label: "Aangepast (na bevinding)", formeel: false },
  { waarde: "vrijgegeven", label: "Vrijgegeven — go (mensbesluit)", formeel: true },
  { waarde: "geblokkeerd", label: "Geblokkeerd — no-go (mensbesluit)", formeel: true },
  { waarde: "gearchiveerd", label: "Gearchiveerd", formeel: false },
];

export default function ReleaseBlok({
  runId,
  ctx,
  magGovern,
  melding,
}: {
  runId: string;
  ctx: ReleaseConsoleContext | null;
  magGovern: boolean;
  melding: { soort: "ok" | "fout" | "audit_ok" | "audit_fout" | "verify"; tekst: string } | null;
}) {
  const kritiek = ctx?.kritieke_bevindingen_count ?? 0;
  return (
    <section className="rounded-xl border border-line bg-white p-5 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="font-serif text-lg font-bold">Vrijgave &amp; audit (AQL-4)</h2>
        <span className="ml-auto text-xs text-ink/50">Scherm 8 — platform-console</span>
      </div>

      {melding && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            melding.soort === "ok" || melding.soort === "audit_ok"
              ? "bg-ok-tint text-ok-ink"
              : melding.soort === "verify"
                ? "bg-accent-tint text-accent-ink"
                : "bg-err-tint text-err-ink"
          }`}
        >
          {melding.tekst}
        </div>
      )}

      {/* Blokker-vereisten expliciet vóór de actie (UX-principe CLAUDE.md). */}
      <div className="grid gap-1 text-sm sm:grid-cols-2">
        <div>Run-type: <span className="font-mono">{ctx?.run_type ?? "—"}</span></div>
        <div>Run-advies: <span className="font-semibold">{ctx?.run_advies ?? "—"}</span></div>
        <div>
          Open kritieke bevindingen:{" "}
          <span className={kritiek > 0 ? "font-bold text-err-ink" : "text-ok-ink"}>{kritiek}</span>
        </div>
        <div>Laatste status: <span className="font-semibold">{ctx?.laatste_status ?? "—"}</span></div>
      </div>

      {kritiek > 0 && (
        <div className="rounded-lg bg-err-tint px-3 py-2 text-sm text-err-ink">
          Er staan {kritiek} open kritieke bevinding(en). Vrijgave is geblokkeerd
          (besluit ≠ vrijgegeven, advies ≠ accepteren) tot deze zijn opgelost/afgehandeld.
        </div>
      )}

      {ctx?.run_type === "ad_hoc" && (
        <div className="rounded-lg bg-warn-tint px-3 py-2 text-sm text-warn-ink">
          Ad-hoc run: kan nooit tot een formele vrijgave leiden (alleen testresultaat).
        </div>
      )}

      {/* Vrijgavebesluit (CAP_GOVERN). */}
      {magGovern ? (
        <form action={legVrijgaveActie} className="space-y-3 rounded-lg border border-line p-3">
          <input type="hidden" name="run_id" value={runId} />
          <label className="block text-sm">
            <span className="block text-ink/70">Nieuwe releasestatus (go/no-go = mensbesluit)</span>
            <select name="gewenste_status" className="mt-1 w-full rounded border border-line px-2 py-1 text-sm" defaultValue="getest">
              {STATUS_OPTIES.map((o) => (
                <option key={o.waarde} value={o.waarde}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="block text-ink/70">Motivatie (verplicht bij afwijken van advies of subset-vrijgave; ook bij een no-go tegen een positief advies)</span>
            <textarea name="motivatie" rows={2} className="mt-1 w-full rounded border border-line px-2 py-1 text-sm" placeholder="Governance-onderbouwing…" />
          </label>
          <p className="text-xs text-ink/50">
            Vrijgave én blokkade zijn mensbesluiten (Governance Owner, human-in-the-loop): het
            besluit volgt uit de status, wordt append-only en herleidbaar vastgelegd, en een
            go/no-go bevriest tevens het auditrapport.
          </p>
          <button type="submit" className="rounded bg-nav-accent px-3 py-1.5 text-sm font-semibold text-white">
            Besluit vastleggen
          </button>
        </form>
      ) : (
        <div className="rounded-lg bg-app-bg px-3 py-2 text-sm text-ink/60">
          Vrijgave vereist de capability <code className="font-mono text-xs">platform.aqlab.govern</code>
          {" "}(AI Governance Owner). U kunt wel het auditrapport genereren/verifiëren.
        </div>
      )}

      {/* Auditrapport genereren + verifiëren (CAP_OPERATE). */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <form action={genereerAuditActie}>
          <input type="hidden" name="run_id" value={runId} />
          <button type="submit" className="rounded border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-app-bg">
            📄 Auditrapport genereren
          </button>
        </form>
        {ctx?.laatste_audit_export_id && (
          <>
            <a
              href={`/api/aqlab/audit/${ctx.laatste_audit_export_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:underline"
            >
              laatste rapport openen
            </a>
            <form action={verifieerAuditActie}>
              <input type="hidden" name="run_id" value={runId} />
              <input type="hidden" name="export_id" value={ctx.laatste_audit_export_id} />
              <button type="submit" className="rounded border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-app-bg">
                🔎 Hash verifiëren
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
