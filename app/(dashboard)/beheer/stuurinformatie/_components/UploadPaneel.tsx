"use client";

// ============================================================================
//  Excel-upload-paneel (T14) — vast sjabloon, controlescherm, commit-na-akkoord.
// ----------------------------------------------------------------------------
//  Flow: sjabloon downloaden → .xlsx kiezen → POST /upload (server-side parsen
//  en mappen; GEEN writes) → controlescherm (herkend/waarde/Δ vorige/status) →
//  "Overnemen in formulier": de herkende waarden vullen de formulierstate en
//  publiceren loopt via de éne savebar (één publish-pad; invoerbron 'upload').
//  Onherkende labels (⚠) worden nooit gecommit; ontbrekende verplichte velden
//  blokkeren het overnemen — vereisten expliciet vóór de actie.
// ============================================================================

import { useRef, useState } from "react";
import {
  bouwControleVelden,
  type ControleVeld,
  type HerkendVeld,
  type OnherkendVeld,
  type SjabloonDoel,
  type SjabloonReferentie,
} from "@/core/lib/stuurinfo-sjabloon";
import type { Snapshot } from "./StuurinfoInvoer";

export type UploadToepassing = {
  velden: Array<{ doel: SjabloonDoel; waarde: number }>;
};

type UploadRespons = {
  herkend: HerkendVeld[];
  onherkend: OnherkendVeld[];
  ontbrekend: string[];
  evenwicht: { verschil: number; sluit: boolean } | null;
  samenvatting: string;
};

type Props = {
  referentie: Snapshot | null;
  onToepassen: (toepassing: UploadToepassing) => void;
  uitgeschakeld: boolean;
};

const STAPPEN = [
  { nr: 1, titel: "Sjabloon", tekst: "Download het vaste sjabloon (vaste veldlabels in kolom A)." },
  { nr: 2, titel: "Upload", tekst: "Kies het ingevulde .xlsx-bestand; velden worden op label herkend." },
  { nr: 3, titel: "Controle", tekst: "Per veld: herkend, waarde en afwijking t.o.v. de vorige periode." },
  { nr: 4, titel: "Bevestigen", tekst: "Pas na akkoord komen de waarden in het formulier; de balanscheck draait mee." },
];

const fmt = (v: number | null): string =>
  v === null ? "—" : v.toLocaleString("nl-NL", { maximumFractionDigits: 2 });

const fmtDelta = (v: number | null): string =>
  v === null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}`;

export default function UploadPaneel({ referentie, onToepassen, uitgeschakeld }: Props) {
  const [resultaat, setResultaat] = useState<UploadRespons | null>(null);
  const [bestandsnaam, setBestandsnaam] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function verwerk(bestand: File) {
    setBezig(true);
    setFout(null);
    setResultaat(null);
    setBestandsnaam(bestand.name);
    try {
      const formData = new FormData();
      formData.append("bestand", bestand);
      const res = await fetch("/api/stuurinformatie/beheer/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Verwerken mislukt");
      setResultaat(data as UploadRespons);
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Verwerken mislukt");
    } finally {
      setBezig(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const controleRijen: ControleVeld[] = resultaat
    ? bouwControleVelden(
        { herkend: resultaat.herkend, onherkend: resultaat.onherkend, ontbrekend: resultaat.ontbrekend },
        (referentie as SjabloonReferentie | null) ?? null
      )
    : [];

  const magOvernemen = resultaat !== null && resultaat.ontbrekend.length === 0 && !uitgeschakeld;

  return (
    <section id="upload" className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-lg font-semibold text-ink mb-1">Upload i.p.v. typen</h2>
      <p className="text-sm text-muted mb-4">
        Vul het vaste sjabloon en upload het — de velden worden op vaste labels herkend en pas na uw
        akkoord overgenomen. Er wordt niets opgeslagen zonder de controle- en publicatiestap.
      </p>

      {/* ── Stappen ── */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4 mb-4">
        {STAPPEN.map((s) => (
          <div key={s.nr} className="rounded-lg border border-line p-3">
            <div className="text-xs font-semibold text-accent mb-1">
              {s.nr} · {s.titel}
            </div>
            <div className="text-xs text-muted">{s.tekst}</div>
          </div>
        ))}
      </div>

      {/* ── Acties ── */}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/api/stuurinformatie/beheer/sjabloon"
          className="rounded-lg border border-app-line-strong px-4 py-2 text-sm text-ink hover:bg-app-bg"
        >
          Sjabloon downloaden (.xlsx)
        </a>
        <label
          className={`rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink ${
            uitgeschakeld || bezig ? "opacity-50 pointer-events-none" : "cursor-pointer"
          }`}
        >
          {bezig ? "Verwerken…" : "Bestand kiezen (.xlsx)"}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            disabled={uitgeschakeld || bezig}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) verwerk(f);
            }}
          />
        </label>
        {bestandsnaam && <span className="text-xs text-muted">{bestandsnaam}</span>}
      </div>

      {fout && (
        <div className="mt-3 rounded-lg border border-err/30 bg-err-tint p-3 text-sm text-err-ink">{fout}</div>
      )}

      {/* ── Controlescherm ── */}
      {resultaat && (
        <div className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="py-2 pr-3 text-left font-medium">Veld in bestand</th>
                  <th className="py-2 px-3 text-left font-medium">Portaalveld</th>
                  <th className="py-2 px-3 text-right font-medium">Waarde</th>
                  <th className="py-2 px-3 text-right font-medium">Δ vorige</th>
                  <th className="py-2 pl-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {controleRijen.map((r, i) => (
                  <tr key={`${r.bronLabel}-${i}`} className="border-b border-line/60">
                    <td className="py-1.5 pr-3 text-ink">{r.bronLabel}</td>
                    <td className="py-1.5 px-3 text-muted">{r.doelLabel ?? "— geen match —"}</td>
                    <td className="py-1.5 px-3 text-right text-ink">{fmt(r.waarde)}</td>
                    <td className="py-1.5 px-3 text-right text-muted">{fmtDelta(r.deltaVorige)}</td>
                    <td className="py-1.5 pl-3">
                      {r.status === "herkend" ? (
                        <span className="text-ok-ink">✓ herkend</span>
                      ) : (
                        <span className="text-warn-ink">⚠ handmatig invoeren</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Samenvattingsbalk ── */}
          <div
            className={`mt-3 rounded-lg border p-3 text-sm ${
              resultaat.ontbrekend.length === 0 && (resultaat.evenwicht?.sluit ?? false)
                ? "border-ok/30 bg-ok-tint text-ok-ink"
                : "border-warn/30 bg-warn-tint text-warn-ink"
            }`}
          >
            {resultaat.samenvatting}
            {resultaat.ontbrekend.length > 0 && (
              <div className="mt-1 text-xs">
                Ontbrekend (verplicht): {resultaat.ontbrekend.join(", ")}. Vul deze velden in het
                bestand aan of voer ze handmatig in.
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() =>
                resultaat &&
                onToepassen({
                  velden: resultaat.herkend.map((h) => ({ doel: h.veld.doel, waarde: h.waarde })),
                })
              }
              disabled={!magOvernemen}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-50"
              title={
                magOvernemen
                  ? undefined
                  : "Alle verplichte velden moeten herkend zijn voordat u kunt overnemen."
              }
            >
              Overnemen in formulier
            </button>
            <span className="text-xs text-muted">
              Publiceren gebeurt daarna via de balk onderaan — u ziet exact wat er naar het dashboard gaat.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
