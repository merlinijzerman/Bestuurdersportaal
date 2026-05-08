"use client";

// Client-component: voorwaarden-paneel voor het Decision Object.
//
// Voorwaarden bij een (voorwaardelijk) besluit: KPI, drempelwaarde,
// monitorfrequentie, deadline, heroverwegingstrigger. Status-cyclus
// open → op_schema → afwijking → vervuld; aparte knop voor
// 'overschreden'.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  type ConditionStatus,
  type DecisionCondition,
  CONDITION_STATUS_LABEL,
} from "@/lib/decision-view";

interface Props {
  decisionId: string;
  conditions: DecisionCondition[];
}

const STATUS_CYCLUS: ConditionStatus[] = [
  "open",
  "op_schema",
  "afwijking",
  "vervuld",
];

function statusKleur(s: ConditionStatus): string {
  switch (s) {
    case "vervuld":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "op_schema":
      return "bg-blue-50 text-blue-800 border-blue-200";
    case "afwijking":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "overschreden":
      return "bg-rose-50 text-rose-800 border-rose-200";
    default:
      return "bg-gray-50 text-gray-700 border-gray-200";
  }
}

function formatDatum(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function VoorwaardenPaneel({ decisionId, conditions }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bezig, setBezig] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const [voorwaarde, setVoorwaarde] = useState("");
  const [eigenaar, setEigenaar] = useState("");
  const [kpi, setKpi] = useState("");
  const [drempel, setDrempel] = useState("");
  const [monitor, setMonitor] = useState("");
  const [deadline, setDeadline] = useState("");
  const [trigger, setTrigger] = useState("");

  async function nieuw() {
    if (!voorwaarde.trim()) {
      setFout("Voorwaarde is verplicht");
      return;
    }
    setBezig("nieuw");
    setFout(null);
    try {
      const res = await fetch(`/api/decisions/${decisionId}/conditions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voorwaarde: voorwaarde.trim(),
          eigenaar_naam: eigenaar.trim() || null,
          kpi: kpi.trim() || null,
          drempelwaarde: drempel.trim() || null,
          monitorfrequentie: monitor.trim() || null,
          deadline: deadline || null,
          heroverwegingstrigger: trigger.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Toevoegen mislukt");
      setVoorwaarde("");
      setEigenaar("");
      setKpi("");
      setDrempel("");
      setMonitor("");
      setDeadline("");
      setTrigger("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBezig(null);
    }
  }

  async function patchStatus(c: DecisionCondition, nieuweStatus: ConditionStatus) {
    setBezig(c.id);
    setFout(null);
    try {
      const res = await fetch(
        `/api/decisions/${decisionId}/conditions/${c.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nieuweStatus }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Wijzigen mislukt");
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBezig(null);
    }
  }

  function cyclusStatus(c: DecisionCondition) {
    if (c.status === "overschreden") return; // klikken op overschreden doet niets
    const idx = STATUS_CYCLUS.indexOf(c.status as ConditionStatus);
    if (idx === -1) {
      void patchStatus(c, "open");
      return;
    }
    const volgende = STATUS_CYCLUS[(idx + 1) % STATUS_CYCLUS.length];
    void patchStatus(c, volgende);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#0F2744]">Voorwaarden</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Voorwaarden waaronder dit besluit van kracht is — met KPI,
            drempelwaarde en heroverwegingstrigger.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            setFout(null);
          }}
          className="text-xs text-[#0F2744] hover:underline whitespace-nowrap"
        >
          {open ? "Sluiten" : "+ Nieuwe voorwaarde"}
        </button>
      </div>

      {open && (
        <div className="mb-4 border border-gray-200 rounded-lg p-4 bg-gray-50/50 space-y-3">
          <Veldgroep label="Voorwaarde *">
            <textarea
              value={voorwaarde}
              onChange={(e) => setVoorwaarde(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Bijv. 'Allocatie naar zakelijke waarden blijft binnen mandaatbandbreedte 35-45%.'"
            />
          </Veldgroep>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Veldgroep label="KPI">
              <input
                type="text"
                value={kpi}
                onChange={(e) => setKpi(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
                placeholder="bijv. allocatie zakelijke waarden"
              />
            </Veldgroep>
            <Veldgroep label="Drempelwaarde">
              <input
                type="text"
                value={drempel}
                onChange={(e) => setDrempel(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
                placeholder="35–45%"
              />
            </Veldgroep>
            <Veldgroep label="Monitorfrequentie">
              <input
                type="text"
                value={monitor}
                onChange={(e) => setMonitor(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
                placeholder="maandelijks"
              />
            </Veldgroep>
            <Veldgroep label="Deadline">
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              />
            </Veldgroep>
          </div>
          <Veldgroep label="Eigenaar">
            <input
              type="text"
              value={eigenaar}
              onChange={(e) => setEigenaar(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Wie bewaakt deze voorwaarde?"
            />
          </Veldgroep>
          <Veldgroep label="Heroverwegingstrigger">
            <input
              type="text"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Wanneer moet dit besluit opnieuw besproken worden? Bijv. 'bij overschrijden 6 maanden'"
            />
          </Veldgroep>
          {fout && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {fout}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={nieuw}
              disabled={bezig === "nieuw"}
              className="bg-[#0F2744] text-white text-sm px-4 py-2 rounded-md hover:bg-[#1a3a5e] disabled:opacity-50"
            >
              {bezig === "nieuw" ? "Bezig…" : "Toevoegen"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setFout(null);
              }}
              className="text-sm text-gray-600 hover:text-gray-900 px-3 py-2"
            >
              Annuleer
            </button>
          </div>
        </div>
      )}

      {conditions.length === 0 ? (
        <div className="text-sm text-gray-400 italic">
          Nog geen voorwaarden vastgelegd. Bij voorwaardelijke besluiten zijn
          deze verplicht voor verantwoordingsrijp.
        </div>
      ) : (
        <ul className="space-y-3">
          {conditions.map((c) => (
            <li
              key={c.id}
              className="border border-gray-200 rounded-lg p-3 bg-white"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900 whitespace-pre-line">
                    {c.voorwaarde}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs">
                    {c.kpi && (
                      <div>
                        <span className="text-gray-500">KPI:</span>{" "}
                        <span className="text-gray-900">{c.kpi}</span>
                      </div>
                    )}
                    {c.drempelwaarde && (
                      <div>
                        <span className="text-gray-500">Drempel:</span>{" "}
                        <span className="text-gray-900">{c.drempelwaarde}</span>
                      </div>
                    )}
                    {c.monitorfrequentie && (
                      <div>
                        <span className="text-gray-500">Monitor:</span>{" "}
                        <span className="text-gray-900">
                          {c.monitorfrequentie}
                        </span>
                      </div>
                    )}
                    {c.deadline && (
                      <div>
                        <span className="text-gray-500">Deadline:</span>{" "}
                        <span className="text-gray-900">
                          {formatDatum(c.deadline)}
                        </span>
                      </div>
                    )}
                  </div>
                  {c.heroverwegingstrigger && (
                    <div className="text-xs text-gray-700 mt-2 italic">
                      Heroverweging: {c.heroverwegingstrigger}
                    </div>
                  )}
                  {c.eigenaar_naam && (
                    <div className="text-xs text-gray-500 mt-1">
                      Eigenaar: {c.eigenaar_naam}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 min-w-[110px]">
                  <button
                    type="button"
                    onClick={() => cyclusStatus(c)}
                    disabled={bezig === c.id}
                    title="Klik om volgende status te kiezen"
                    className={`text-[11px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded cursor-pointer hover:opacity-80 disabled:opacity-50 ${statusKleur(
                      c.status
                    )}`}
                  >
                    {CONDITION_STATUS_LABEL[c.status]}
                  </button>
                  {c.status !== "overschreden" && c.status !== "vervuld" && (
                    <button
                      type="button"
                      onClick={() => patchStatus(c, "overschreden")}
                      disabled={bezig === c.id}
                      className="text-[11px] text-rose-700 hover:underline disabled:opacity-50"
                    >
                      Overschreden
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {fout && !open && (
        <div className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {fout}
        </div>
      )}
    </div>
  );
}

function Veldgroep({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
