"use client";

// #192 — kiezer voor het koppelen van een BESTAAND artefact aan een vereiste.
// Haalt kandidaten op (GET …/vereisten/kandidaten), laat kiezen (radio bij
// min_aantal 1, checkbox bij >1), en koppelt via de bestaande koppelroute. Al
// aan een andere vereiste gekoppelde kandidaten zijn zichtbaar onbeschikbaar.
// De lege staat wijst de weg naar het aanmaken — of legt uit waarom dat hier
// niet kan (evaluation: geen pad; ai_validation: ontstaat in de AI-flow).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EvidenceItem, RequirementType } from "@/core/lib/decision-view";
import { requirementSleutel } from "@/core/lib/requirement-sleutel";

interface Kandidaat {
  id: string;
  titel: string | null;
  datum: string | null;
  actor: string | null;
  gebonden_aan: string | null;
  meta: string | null;
}

const TYPE_TEKST: Record<string, { ev: string; mv: string; de: boolean }> = {
  risk: { ev: "risico", mv: "risico's", de: false },
  assumption: { ev: "aanname", mv: "aannames", de: true },
  kpi: { ev: "KPI", mv: "KPI's", de: true },
  approval: { ev: "besluit", mv: "besluiten", de: false },
  evaluation: { ev: "evaluatie", mv: "evaluaties", de: true },
  ai_validation: { ev: "AI-validatie", mv: "AI-validaties", de: true },
};

function metaVan(k: Kandidaat): string {
  return [k.datum, k.actor, k.meta].filter(Boolean).join(" · ");
}

export default function VereisteKiezer({
  procedureId,
  vereiste,
  onClose,
}: {
  procedureId: string;
  vereiste: EvidenceItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const type = vereiste.requirement_type as RequirementType;
  const t = TYPE_TEKST[type] ?? { ev: "feit", mv: "feiten", de: false };
  const meervoud = vereiste.min_aantal > 1;
  const nogNodig = Math.max(0, vereiste.min_aantal - vereiste.gebonden_feiten.length);

  const [laden, setLaden] = useState(true);
  const [kandidaten, setKandidaten] = useState<Kandidaat[]>([]);
  const [zoek, setZoek] = useState("");
  const [selectie, setSelectie] = useState<Set<string>>(new Set());
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const sleutel = requirementSleutel(
    vereiste.stap_volgorde,
    vereiste.requirement_type,
    vereiste.documenttype,
    vereiste.label
  );

  useEffect(() => {
    let afgebroken = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/procedures/${procedureId}/vereisten/kandidaten?requirement_sleutel=${encodeURIComponent(sleutel)}`
        );
        const data = (await res.json().catch(() => ({}))) as {
          kandidaten?: Kandidaat[];
          error?: string;
        };
        if (afgebroken) return;
        if (!res.ok) setFout(data.error ?? "Kandidaten laden mislukt");
        else setKandidaten(data.kandidaten ?? []);
      } catch {
        if (!afgebroken) setFout("Kandidaten laden mislukt");
      } finally {
        if (!afgebroken) setLaden(false);
      }
    })();
    return () => {
      afgebroken = true;
    };
  }, [procedureId, sleutel]);

  function toggle(id: string, disabled: boolean) {
    if (disabled) return;
    setSelectie((prev) => {
      const next = meervoud ? new Set(prev) : new Set<string>();
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function koppel() {
    setBezig(true);
    setFout(null);
    try {
      const payload = {
        stap_volgorde: vereiste.stap_volgorde,
        requirement_type: vereiste.requirement_type,
        documenttype: vereiste.documenttype,
        label: vereiste.label,
      };
      for (const bronId of selectie) {
        const res = await fetch(
          `/api/procedures/${procedureId}/vereisten/koppel`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ actie: "koppel", vereiste: payload, bron_id: bronId }),
          }
        );
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          setFout(d.error ?? "Koppelen mislukt");
          setBezig(false);
          return;
        }
      }
      onClose();
      router.refresh();
    } catch {
      setFout("Koppelen mislukt");
      setBezig(false);
    }
  }

  const alGebonden = new Set(vereiste.gebonden_feiten.map((f) => f.id));
  const zichtbaar = kandidaten
    .filter((k) => !alGebonden.has(k.id))
    .filter((k) => {
      const q = zoek.trim().toLowerCase();
      if (!q) return true;
      return `${k.titel ?? ""} ${metaVan(k)}`.toLowerCase().includes(q);
    });

  const titel = meervoud
    ? `Koppel bestaande ${t.mv}`
    : `Koppel een bestaand${t.de ? "e" : ""} ${t.ev}`;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-6 bg-[rgb(18_35_59/0.38)]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[620px] max-h-[80vh] flex flex-col bg-white border border-line rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-line">
          <h3 className="font-serif text-[17px] font-semibold text-ink">{titel}</h3>
          <p className="text-xs text-muted mt-1">
            Kies het feit uit dit dossier dat deze vereiste vervult. Wat je kiest wordt
            vastgelegd met datum en persoon.
          </p>
          <span className="mt-2 inline-flex items-center gap-2 bg-accent-tint border border-line rounded-lg px-2.5 py-1 text-xs text-accent-ink font-medium">
            {vereiste.label}
          </span>
        </div>

        <div className="px-5 py-3.5 overflow-auto flex-1">
          {fout && (
            <div className="mb-3 text-xs text-err-ink bg-err-tint border border-err/30 rounded-lg px-3 py-2">
              {fout}
            </div>
          )}
          {laden ? (
            <div className="text-sm text-muted py-6 text-center">Kandidaten laden…</div>
          ) : zichtbaar.length === 0 ? (
            <LegeStaat type={type} t={t} onClose={onClose} />
          ) : (
            <>
              <input
                type="search"
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                placeholder="Zoek op titel of persoon…"
                className="w-full border border-app-line-control rounded-lg px-3 py-2 text-[13px] mb-3 bg-white outline-none focus:border-accent"
              />
              <ul className="space-y-2">
                {zichtbaar.map((k) => {
                  const disabled = !!k.gebonden_aan;
                  const gekozen = selectie.has(k.id);
                  return (
                    <li key={k.id}>
                      <label
                        className={`flex gap-3 items-start border rounded-xl px-3 py-2.5 ${
                          disabled
                            ? "border-line bg-app-zebra border-dashed cursor-not-allowed"
                            : `cursor-pointer ${gekozen ? "border-accent bg-accent-tint" : "border-line hover:border-accent hover:bg-accent-tint"}`
                        }`}
                      >
                        <input
                          type={meervoud ? "checkbox" : "radio"}
                          name="kandidaat"
                          checked={gekozen}
                          disabled={disabled}
                          onChange={() => toggle(k.id, disabled)}
                          className="mt-0.5 accent-accent"
                        />
                        <span className="min-w-0">
                          <span className="block font-semibold text-[13.5px] text-ink">
                            {k.titel ?? "(zonder titel)"}
                          </span>
                          {metaVan(k) && (
                            <span className="block text-xs text-muted mt-0.5">{metaVan(k)}</span>
                          )}
                          {disabled && (
                            <span className="mt-1.5 inline-block text-xs text-err-ink bg-err-tint rounded px-1.5 py-0.5">
                              Al gekoppeld aan: {k.gebonden_aan}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line flex items-center justify-between gap-3 bg-app-zebra">
          <span className="text-xs text-muted">
            {selectie.size === 0
              ? meervoud
                ? `Nog ${nogNodig} nodig voor vervulling`
                : "Niets geselecteerd"
              : meervoud
                ? `${selectie.size} geselecteerd · nog ${Math.max(0, nogNodig - selectie.size)} nodig`
                : "1 geselecteerd"}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-app-line-control rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-accent-tint"
            >
              Annuleren
            </button>
            <button
              type="button"
              onClick={koppel}
              disabled={selectie.size === 0 || bezig}
              className="bg-accent border border-accent rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-ink disabled:opacity-45"
            >
              {bezig ? "Bezig…" : "Koppelen"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function LegeStaat({
  type,
  t,
  onClose,
}: {
  type: RequirementType;
  t: { ev: string; mv: string; de: boolean };
  onClose: () => void;
}) {
  // Doodlopende-weg-toets (#192, bevinding #198): niet elk type heeft een
  // aanmaakpad. Geen knop naar een niet-bestaande pagina.
  if (type === "ai_validation") {
    return (
      <div className="border border-dashed border-app-line-strong rounded-xl py-6 px-5 text-center bg-app-zebra">
        <h4 className="font-serif text-[15px] font-semibold text-ink mb-1.5">
          Er zijn nog geen AI-validaties in dit dossier
        </h4>
        <p className="text-xs text-muted max-w-[400px] mx-auto">
          AI-validaties worden niet hier aangemaakt — ze ontstaan wanneer een AI-output in
          de validatieflow wordt beoordeeld. Zodra dat is gebeurd, verschijnen ze hier om
          te koppelen.
        </p>
      </div>
    );
  }
  if (type === "evaluation") {
    return (
      <div className="border border-dashed border-app-line-strong rounded-xl py-6 px-5 text-center bg-app-zebra">
        <h4 className="font-serif text-[15px] font-semibold text-ink mb-1.5">
          Evaluaties kunnen nog niet in het portaal worden vastgelegd
        </h4>
        <p className="text-xs text-muted max-w-[400px] mx-auto">
          Voor dit type bestaat nog geen vastleg- of aanmaakpad in het portaal. Deze
          vereiste kan daarom nog niet worden vervuld — dat is een bekend openstaand punt.
        </p>
      </div>
    );
  }
  return (
    <div className="border border-dashed border-app-line-strong rounded-xl py-6 px-5 text-center bg-app-zebra">
      <h4 className="font-serif text-[15px] font-semibold text-ink mb-1.5">
        Er is nog geen {t.ev} in dit dossier
      </h4>
      <p className="text-xs text-muted max-w-[400px] mx-auto mb-3.5">
        Deze vereiste vraagt om een feit dat nog niet bestaat. Leg het eerst vast in het
        bijbehorende paneel van dit dossier — daarna kun je het hier koppelen.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="bg-accent border border-accent rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-ink"
      >
        Sluiten
      </button>
    </div>
  );
}
