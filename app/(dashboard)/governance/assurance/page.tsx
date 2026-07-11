// app/(dashboard)/governance/assurance/page.tsx
// -----------------------------------------------------------------------------
// Scherm 9 — Assurance-view (AQL-4, functioneel §5). Het ENIGE fonds-scherm van
// het AI Quality Lab en volledig READ-ONLY: status, geaggregeerde scores, scope-
// label, geaggregeerde bevindingen, laatste kwaliteitscontrole, vrijgavestatus en
// auditrapport-download — met prominent de disclaimer (§4.4) en de "wat betekent
// deze score wél/niet"-uitleg. Nooit ruwe output/prompt/testcase-inhoud.
//
// De data komt van het gecureerde server-side endpoint (/api/aqlab/assurance);
// deze (dashboard)-boom importeert bewust NOOIT de service-role-client. De
// service-role leeft uitsluitend achter dat endpoint.
// -----------------------------------------------------------------------------

import { headers } from "next/headers";
import type { AssuranceView } from "@/lib/aqlab/assurance-core";

export const dynamic = "force-dynamic";

async function haalView(): Promise<AssuranceView | { fout: string }> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return { fout: "Kan het assurance-endpoint niet bepalen." };
  const isLokaal = host.startsWith("localhost") || host.startsWith("127.");
  const proto = h.get("x-forwarded-proto") ?? (isLokaal ? "http" : "https");
  try {
    const res = await fetch(`${proto}://${host}/api/aqlab/assurance`, {
      headers: { cookie: h.get("cookie") ?? "" },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { fout: body.error ?? `Assurance niet beschikbaar (status ${res.status}).` };
    }
    return (await res.json()) as AssuranceView;
  } catch {
    return { fout: "Assurance-view kon niet worden geladen." };
  }
}

function Regel({ label, waarde }: { label: string; waarde: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-line/60 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-semibold text-ink text-right">{waarde}</span>
    </div>
  );
}

export default async function AssurancePage() {
  const data = await haalView();

  return (
    <div className="p-4 sm:p-6 lg:p-7 max-w-4xl">
      <div className="mb-4">
        <h1 className="font-serif text-xl font-black text-ink">Kwaliteitsborging AI</h1>
        <p className="text-sm text-muted mt-1">
          Alleen-lezen overzicht van de kwaliteitsborging van de AI-ondersteuning die uw fonds gebruikt.
        </p>
      </div>

      {/* Disclaimer §4.4 — prominent boven aan. */}
      {"disclaimer" in data && (
        <div className="rounded-xl border border-warn/40 bg-warn-tint px-4 py-3 mb-4 text-sm text-warn-ink">
          <strong className="block mb-1">Let op — geen juridische garantie</strong>
          {data.disclaimer}
        </div>
      )}

      {/* Scope-banner (productbrede controle). */}
      {"scope_banner" in data && (
        <div className="rounded-xl border border-accent/30 bg-accent-tint px-4 py-3 mb-6 text-sm text-accent-ink">
          🛈 {data.scope_banner}
        </div>
      )}

      {"fout" in data ? (
        <div className="rounded-xl border border-err/30 bg-err-tint p-4 text-sm text-err-ink">
          {data.fout}
        </div>
      ) : data.tegels.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🛡️</div>
          <h3 className="font-semibold text-ink mb-1">Nog geen assurance-gegevens</h3>
          <p className="text-sm text-muted">
            Zodra een kwaliteitscontrole is uitgevoerd en vrijgegeven, verschijnt die hier.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {data.tegels.map((t) => (
            <div key={t.feature_code} className="bg-white border border-line rounded-xl p-4 sm:p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <h2 className="font-serif text-lg font-bold text-ink">{t.feature_naam}</h2>
                <span
                  className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full ${
                    t.status_label === "Vrijgegeven voor gebruik"
                      ? "bg-ok-tint text-ok-ink"
                      : t.status_label === "Review vereist"
                        ? "bg-warn-tint text-warn-ink"
                        : "bg-app-bg text-muted"
                  }`}
                >
                  {t.status_label}
                </span>
              </div>

              <div className="grid sm:grid-cols-2 gap-x-6">
                <Regel label="Laatste kwaliteitscontrole" waarde={
                  t.laatste_controle
                    ? new Date(t.laatste_controle).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })
                    : "—"
                } />
                <Regel label="Type controle" waarde={t.type_controle} />
                <Regel label="Aantal testgevallen" waarde={t.aantal_testgevallen} />
                <Regel label="Kritieke bevindingen" waarde={t.kritieke_bevindingen} />
                <Regel label="Openstaande menselijke review" waarde={t.openstaande_review} />
                <Regel label="Brongebondenheid (indicator)" waarde={t.brongebondenheid} />
                <Regel label="Format-compliance" waarde={t.format_compliance} />
                <Regel label="Regressie t.o.v. vorige vrijgegeven versie" waarde={t.regressie} />
                <Regel label="Geldigheid / scope van de controle" waarde={t.geldigheid} />
                <Regel label="Auditrapport" waarde={
                  t.audit_export_id ? (
                    <a
                      href={`/api/aqlab/assurance/audit/${t.audit_export_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-ink underline font-semibold"
                    >
                      Downloaden
                    </a>
                  ) : "—"
                } />
              </div>

              {/* "Wat betekent deze score wél / níet?" (§5.2a). */}
              <div className="mt-4 grid sm:grid-cols-2 gap-3">
                <div className="rounded-lg bg-ok-tint/50 border border-ok/20 px-3 py-2">
                  <div className="text-xs font-bold text-ok-ink mb-0.5">Wat betekent dit wél?</div>
                  <p className="text-xs text-ink">{t.wat_wel}</p>
                </div>
                <div className="rounded-lg bg-app-bg border border-line px-3 py-2">
                  <div className="text-xs font-bold text-muted mb-0.5">Wat betekent dit níet?</div>
                  <p className="text-xs text-ink">{t.wat_niet}</p>
                </div>
              </div>

              {t.inhoud_hash && (
                <p className="mt-2 text-[11px] text-muted break-all">
                  Verificatiehash (sha256): <span className="font-mono">{t.inhoud_hash}</span>
                </p>
              )}

              <p className="mt-3 text-xs text-muted italic">{t.footer}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
