"use client";

// ============================================================================
//  Bronnen-whitelist — beheerscherm (Scenario A, besluit 0072).
// ----------------------------------------------------------------------------
//  Overzicht + toevoegen/bewerken + (de)activeren + review-signalering + test-
//  knop (proefvraag → welke entries matchen; pure matchWhitelist, geen fetch) +
//  wijzigingslog (in-app notificatie aan overige beheerders). Mutaties lopen via
//  de server-actions (withPlatform); de harde domeinvalidatie en look-alike-
//  waarschuwing zitten server-side, deze UI spiegelt ze alleen.
// ============================================================================

import { useMemo, useState, useTransition } from "react";
import {
  matchWhitelist,
  type WhitelistEntry,
  type WhitelistMatchtype,
} from "@/core/lib/web-whitelist";
import { NORMGEWICHTEN, NORMGEWICHT_LABEL } from "@/core/lib/bronsoort";
import {
  whitelistAanmaken,
  whitelistBijwerken,
  whitelistStatus,
  type WhitelistLogRegel,
  type WhitelistResultaat,
} from "../acties";

const MATCHTYPE_LABEL: Record<WhitelistMatchtype, string> = {
  domein: "Exact domein",
  domein_subdomeinen: "Domein + subdomeinen",
  padprefix: "Padprefix",
};

const STATUS_STIJL: Record<string, string> = {
  actief: "bg-ok-tint text-ok-ink",
  inactief: "bg-app-bg text-muted",
  in_review: "bg-warn-tint text-warn-ink",
};

const VANDAAG = new Date().toISOString().slice(0, 10);

function reviewVerlopen(datum?: string | null): boolean {
  return !!datum && datum < VANDAAG;
}

type FormState = {
  id?: string;
  domein: string;
  matchtype: WhitelistMatchtype;
  pad: string;
  normgewicht: string;
  categorie: string;
  tier: string;
  toelichting: string;
  review_datum: string;
  reden: string;
};

const LEEG_FORM: FormState = {
  domein: "",
  matchtype: "domein_subdomeinen",
  pad: "",
  normgewicht: "bindend",
  categorie: "",
  tier: "",
  toelichting: "",
  review_datum: "",
  reden: "",
};

export default function BronnenWhitelistClient({
  entries,
  log,
  magBeheren,
}: {
  entries: WhitelistEntry[];
  log: WhitelistLogRegel[];
  magBeheren: boolean;
}) {
  const [pending, start] = useTransition();
  const [form, setForm] = useState<FormState | null>(null);
  const [veldfouten, setVeldfouten] = useState<Record<string, string>>({});
  const [melding, setMelding] = useState<{ soort: "ok" | "fout"; tekst: string } | null>(null);
  const [bevestigLookAlike, setBevestigLookAlike] = useState(false);

  // Filters
  const [zoek, setZoek] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [normFilter, setNormFilter] = useState("");

  // Test-knop
  const [testUrl, setTestUrl] = useState("");
  const actieveEntries = useMemo(() => entries.filter((e) => e.status === "actief"), [entries]);
  const testResultaat = useMemo(() => {
    if (!testUrl.trim()) return null;
    return matchWhitelist(testUrl.trim(), actieveEntries);
  }, [testUrl, actieveEntries]);

  const gefilterd = useMemo(() => {
    return entries.filter((e) => {
      if (statusFilter && e.status !== statusFilter) return false;
      if (normFilter && e.normgewicht !== normFilter) return false;
      if (zoek && !e.domein.toLowerCase().includes(zoek.toLowerCase())) return false;
      return true;
    });
  }, [entries, zoek, statusFilter, normFilter]);

  function open(entry?: WhitelistEntry) {
    setMelding(null);
    setVeldfouten({});
    setBevestigLookAlike(false);
    if (entry) {
      setForm({
        id: entry.id,
        domein: entry.domein,
        matchtype: entry.matchtype,
        pad: entry.pad ?? "",
        normgewicht: entry.normgewicht,
        categorie: entry.categorie ?? "",
        tier: entry.tier ?? "",
        toelichting: entry.toelichting,
        review_datum: entry.review_datum ?? "",
        reden: "",
      });
    } else {
      setForm({ ...LEEG_FORM });
    }
  }

  function verwerk(res: WhitelistResultaat) {
    if (res.ok) {
      setMelding({ soort: "ok", tekst: res.bericht + (res.genotificeerd ? ` (${res.genotificeerd} overige beheerder(s) genotificeerd)` : "") });
      setForm(null);
      setVeldfouten({});
      setBevestigLookAlike(false);
    } else {
      setVeldfouten(res.veldfouten ?? {});
      if (res.waarschuwing) setBevestigLookAlike(false);
      setMelding({ soort: "fout", tekst: res.melding });
    }
  }

  function opslaan() {
    if (!form) return;
    setMelding(null);
    const huidig = form;
    start(async () => {
      const res = huidig.id
        ? await whitelistBijwerken({ ...huidig, id: huidig.id, bevestigLookAlike })
        : await whitelistAanmaken({ ...huidig, bevestigLookAlike });
      // Bij een look-alike-waarschuwing: markeer zodat een tweede klik bevestigt.
      if (!res.ok && res.foutcode === "lookalike") setBevestigLookAlike(true);
      verwerk(res);
    });
  }

  function zetStatus(id: string, status: string) {
    setMelding(null);
    start(async () => {
      const reden = status === "inactief" ? window.prompt("Reden voor deactiveren (optioneel):") ?? "" : "";
      verwerk(await whitelistStatus({ id, status, reden }));
    });
  }

  return (
    <div className="space-y-6">
      {melding && (
        <div className={`rounded-lg border px-4 py-2 text-sm ${melding.soort === "ok" ? "border-ok/30 bg-ok-tint text-ok-ink" : "border-err/30 bg-err-tint text-err-ink"}`}>
          {melding.tekst}
        </div>
      )}

      {/* Test-knop (proefvraag) */}
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink/80">Test een URL tegen de actieve whitelist</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            placeholder="https://www.dnb.nl/…"
            className="min-w-[16rem] flex-1 rounded-lg border border-line px-3 py-1.5 text-sm"
          />
        </div>
        {testUrl.trim() && (
          <p className="mt-2 text-sm">
            {testResultaat ? (
              <span className="text-ok-ink">
                ✓ Matcht <strong>{testResultaat.entry.domein}</strong> ({MATCHTYPE_LABEL[testResultaat.entry.matchtype]}) — normgewicht{" "}
                <strong>{NORMGEWICHT_LABEL[testResultaat.normgewicht]}</strong>. Zou worden opgehaald.
              </span>
            ) : (
              <span className="text-err-ink">✗ Geen match — deze URL zou vóór ophalen worden geweigerd.</span>
            )}
          </p>
        )}
      </section>

      {/* Filters + toevoegen */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={zoek}
          onChange={(e) => setZoek(e.target.value)}
          placeholder="Zoek domein…"
          className="rounded-lg border border-line px-3 py-1.5 text-sm"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-line px-3 py-1.5 text-sm">
          <option value="">Alle statussen</option>
          <option value="actief">Actief</option>
          <option value="in_review">In review</option>
          <option value="inactief">Inactief</option>
        </select>
        <select value={normFilter} onChange={(e) => setNormFilter(e.target.value)} className="rounded-lg border border-line px-3 py-1.5 text-sm">
          <option value="">Alle normgewichten</option>
          {NORMGEWICHTEN.map((n) => (
            <option key={n} value={n}>{NORMGEWICHT_LABEL[n]}</option>
          ))}
        </select>
        {magBeheren && (
          <button onClick={() => open()} className="ml-auto rounded-lg bg-nav px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">
            + Bron toevoegen
          </button>
        )}
      </div>

      {/* Tabel */}
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-app-bg text-xs uppercase tracking-wide text-ink/60">
            <tr>
              <th className="px-3 py-2">Domein</th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Normgewicht</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Review</th>
              {magBeheren && <th className="px-3 py-2">Acties</th>}
            </tr>
          </thead>
          <tbody>
            {gefilterd.length === 0 ? (
              <tr><td colSpan={magBeheren ? 7 : 6} className="px-3 py-6 text-center text-ink/50">Geen bronnen gevonden.</td></tr>
            ) : (
              gefilterd.map((e) => (
                <tr key={e.id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2 font-medium">
                    {e.domein}
                    {e.matchtype === "padprefix" && e.pad && <span className="text-ink/50"> {e.pad}</span>}
                  </td>
                  <td className="px-3 py-2 text-ink/70">{MATCHTYPE_LABEL[e.matchtype]}</td>
                  <td className="px-3 py-2">{NORMGEWICHT_LABEL[e.normgewicht] ?? e.normgewicht}</td>
                  <td className="px-3 py-2 text-ink/70">{e.tier ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STIJL[e.status] ?? ""}`}>{e.status}</span>
                  </td>
                  <td className="px-3 py-2">
                    {reviewVerlopen(e.review_datum) ? (
                      <span className="rounded-full bg-warn-tint px-2 py-0.5 text-xs font-medium text-warn-ink">review nodig</span>
                    ) : (
                      <span className="text-xs text-ink/50">{e.review_datum ?? "—"}</span>
                    )}
                  </td>
                  {magBeheren && (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button onClick={() => open(e)} disabled={pending} className="rounded border border-line px-2 py-1 text-xs hover:bg-app-bg">Bewerken</button>
                        {e.status === "actief" ? (
                          <button onClick={() => zetStatus(e.id, "inactief")} disabled={pending} className="rounded border border-line px-2 py-1 text-xs text-err-ink hover:bg-err-tint">Deactiveren</button>
                        ) : (
                          <button onClick={() => zetStatus(e.id, "actief")} disabled={pending} className="rounded border border-line px-2 py-1 text-xs text-ok-ink hover:bg-ok-tint">Activeren</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Wijzigingslog — in-app notificatie aan overige beheerders (AC-B3) */}
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink/80">Recente wijzigingen</h2>
        <p className="text-xs text-ink/50">Zichtbaar voor alle beheerders — de compenserende control bij optioneel vier-ogen.</p>
        <ul className="mt-2 space-y-1 text-xs">
          {log.length === 0 ? (
            <li className="text-ink/50">Nog geen wijzigingen.</li>
          ) : (
            log.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-2 text-ink/70">
                <span className="text-ink/40">{r.tijdstip.slice(0, 16).replace("T", " ")}</span>
                <span className="font-medium text-ink">{r.handeling}</span>
                <span>{r.domein_snapshot ?? "—"}</span>
                {r.reden && <span className="italic">— {r.reden}</span>}
              </li>
            ))
          )}
        </ul>
      </section>

      {/* Formulier (toevoegen/bewerken) */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="mt-10 w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">{form.id ? "Bron bewerken" : "Bron toevoegen"}</h3>

            <div className="mt-4 space-y-3">
              <Veld label="Domein" fout={veldfouten.domein}>
                <input value={form.domein} onChange={(e) => setForm({ ...form, domein: e.target.value })} placeholder="dnb.nl" className="w-full rounded-lg border border-line px-3 py-1.5 text-sm" />
              </Veld>
              <div className="grid grid-cols-2 gap-3">
                <Veld label="Matchtype" fout={veldfouten.matchtype}>
                  <select value={form.matchtype} onChange={(e) => setForm({ ...form, matchtype: e.target.value as WhitelistMatchtype })} className="w-full rounded-lg border border-line px-3 py-1.5 text-sm">
                    {(Object.keys(MATCHTYPE_LABEL) as WhitelistMatchtype[]).map((m) => (
                      <option key={m} value={m}>{MATCHTYPE_LABEL[m]}</option>
                    ))}
                  </select>
                </Veld>
                {form.matchtype === "padprefix" && (
                  <Veld label="Pad" fout={veldfouten.pad}>
                    <input value={form.pad} onChange={(e) => setForm({ ...form, pad: e.target.value })} placeholder="/pensioen" className="w-full rounded-lg border border-line px-3 py-1.5 text-sm" />
                  </Veld>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Veld label="Normgewicht" fout={veldfouten.normgewicht}>
                  <select value={form.normgewicht} onChange={(e) => setForm({ ...form, normgewicht: e.target.value })} className="w-full rounded-lg border border-line px-3 py-1.5 text-sm">
                    {NORMGEWICHTEN.map((n) => (
                      <option key={n} value={n}>{NORMGEWICHT_LABEL[n]}</option>
                    ))}
                  </select>
                </Veld>
                <Veld label="Tier (label)">
                  <input value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} placeholder="1 / 2 / 3 / context" className="w-full rounded-lg border border-line px-3 py-1.5 text-sm" />
                </Veld>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Veld label="Categorie (label)">
                  <input value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })} placeholder="wet/toezicht" className="w-full rounded-lg border border-line px-3 py-1.5 text-sm" />
                </Veld>
                <Veld label="Review-datum">
                  <input type="date" value={form.review_datum} onChange={(e) => setForm({ ...form, review_datum: e.target.value })} className="w-full rounded-lg border border-line px-3 py-1.5 text-sm" />
                </Veld>
              </div>
              <Veld label="Toelichting (reden gezaghebbend)" fout={veldfouten.toelichting}>
                <textarea value={form.toelichting} onChange={(e) => setForm({ ...form, toelichting: e.target.value })} rows={2} className="w-full rounded-lg border border-line px-3 py-1.5 text-sm" />
              </Veld>
              {form.id && (
                <Veld label="Reden van wijziging (optioneel)">
                  <input value={form.reden} onChange={(e) => setForm({ ...form, reden: e.target.value })} className="w-full rounded-lg border border-line px-3 py-1.5 text-sm" />
                </Veld>
              )}
              {bevestigLookAlike && (
                <div className="rounded-lg border border-warn/30 bg-warn-tint px-3 py-2 text-xs text-warn-ink">
                  Dit domein lijkt op een bestaand gezaghebbend domein. Controleer op typefouten. Klik nogmaals op &ldquo;Opslaan&rdquo; om te bevestigen.
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setForm(null)} disabled={pending} className="rounded-lg border border-line px-4 py-1.5 text-sm">Annuleren</button>
              <button onClick={opslaan} disabled={pending} className="rounded-lg bg-nav px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">
                {pending ? "Bezig…" : "Opslaan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Veld({ label, fout, children }: { label: string; fout?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink/70">{label}</span>
      {children}
      {fout && <span className="mt-1 block text-xs text-err-ink">{fout}</span>}
    </label>
  );
}
