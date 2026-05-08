"use client";

// Client-component: acties-paneel voor het Decision Object.
//
// Acties die uit het besluit voortvloeien. Optionele koppeling aan een
// voorwaarde (KPI-bewaking). Status-cyclus open → in_behandeling →
// afgerond, met aparte knoppen voor 'vervallen' en 'escalatie'.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  type ActionItem,
  type ActionStatus,
  type DecisionCondition,
  ACTION_STATUS_LABEL,
} from "@/lib/decision-view";

interface Props {
  decisionId: string;
  actions: ActionItem[];
  conditions: DecisionCondition[];
}

const STATUS_CYCLUS: ActionStatus[] = [
  "open",
  "in_behandeling",
  "afgerond",
];

function statusKleur(s: ActionStatus): string {
  switch (s) {
    case "afgerond":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "in_behandeling":
      return "bg-blue-50 text-blue-800 border-blue-200";
    case "vervallen":
      return "bg-gray-100 text-gray-500 border-gray-200";
    case "escalatie":
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

export default function ActiesPaneel({
  decisionId,
  actions,
  conditions,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bezig, setBezig] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const [actie, setActie] = useState("");
  const [eigenaar, setEigenaar] = useState("");
  const [deadline, setDeadline] = useState("");
  const [voorwaardeId, setVoorwaardeId] = useState("");

  async function nieuw() {
    if (!actie.trim()) {
      setFout("Actie is verplicht");
      return;
    }
    setBezig("nieuw");
    setFout(null);
    try {
      const res = await fetch(`/api/decisions/${decisionId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actie: actie.trim(),
          eigenaar_naam: eigenaar.trim() || null,
          deadline: deadline || null,
          voorwaarde_id: voorwaardeId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Toevoegen mislukt");
      setActie("");
      setEigenaar("");
      setDeadline("");
      setVoorwaardeId("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBezig(null);
    }
  }

  async function patchStatus(a: ActionItem, nieuweStatus: ActionStatus) {
    setBezig(a.id);
    setFout(null);
    try {
      const res = await fetch(`/api/decisions/${decisionId}/actions/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nieuweStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Wijzigen mislukt");
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBezig(null);
    }
  }

  function cyclusStatus(a: ActionItem) {
    if (a.status === "vervallen" || a.status === "escalatie") return;
    const idx = STATUS_CYCLUS.indexOf(a.status as ActionStatus);
    if (idx === -1) {
      void patchStatus(a, "open");
      return;
    }
    const volgende = STATUS_CYCLUS[(idx + 1) % STATUS_CYCLUS.length];
    void patchStatus(a, volgende);
  }

  // Quick lookup van voorwaarde voor labelweergave
  const voorwaardeMap = new Map(conditions.map((c) => [c.id, c]));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#0F2744]">Acties</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Concrete acties die uit dit besluit voortvloeien — optioneel
            gekoppeld aan een voorwaarde die ze bewaken.
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
          {open ? "Sluiten" : "+ Nieuwe actie"}
        </button>
      </div>

      {open && (
        <div className="mb-4 border border-gray-200 rounded-lg p-4 bg-gray-50/50 space-y-3">
          <Veldgroep label="Actie *">
            <textarea
              value={actie}
              onChange={(e) => setActie(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Wat moet er concreet gebeuren?"
            />
          </Veldgroep>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Veldgroep label="Eigenaar">
              <input
                type="text"
                value={eigenaar}
                onChange={(e) => setEigenaar(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
                placeholder="Naam van eigenaar"
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
          <Veldgroep label="Bewaakt voorwaarde (optioneel)">
            <select
              value={voorwaardeId}
              onChange={(e) => setVoorwaardeId(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
              disabled={conditions.length === 0}
            >
              <option value="">— geen koppeling —</option>
              {conditions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.voorwaarde.length > 60
                    ? `${c.voorwaarde.slice(0, 60)}…`
                    : c.voorwaarde}
                </option>
              ))}
            </select>
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

      {actions.length === 0 ? (
        <div className="text-sm text-gray-400 italic">
          Nog geen acties vastgelegd.
        </div>
      ) : (
        <ul className="space-y-3">
          {actions.map((a) => {
            const voorw = a.voorwaarde_id
              ? voorwaardeMap.get(a.voorwaarde_id)
              : null;
            return (
              <li
                key={a.id}
                className="border border-gray-200 rounded-lg p-3 bg-white"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 whitespace-pre-line">
                      {a.actie}
                    </div>
                    <div className="flex items-center gap-3 mt-2 flex-wrap text-xs">
                      {a.eigenaar_naam && (
                        <span className="text-gray-500">
                          Eigenaar:{" "}
                          <span className="text-gray-900">
                            {a.eigenaar_naam}
                          </span>
                        </span>
                      )}
                      {a.deadline && (
                        <span className="text-gray-500">
                          Deadline:{" "}
                          <span className="text-gray-900">
                            {formatDatum(a.deadline)}
                          </span>
                        </span>
                      )}
                      {voorw && (
                        <span className="text-gray-500">
                          Bewaakt:{" "}
                          <span className="text-gray-900 italic">
                            {voorw.voorwaarde.length > 50
                              ? `${voorw.voorwaarde.slice(0, 50)}…`
                              : voorw.voorwaarde}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 min-w-[110px]">
                    <button
                      type="button"
                      onClick={() => cyclusStatus(a)}
                      disabled={
                        bezig === a.id ||
                        a.status === "vervallen" ||
                        a.status === "escalatie"
                      }
                      title={
                        a.status === "vervallen" || a.status === "escalatie"
                          ? "Eindstatus"
                          : "Klik om volgende status te kiezen"
                      }
                      className={`text-[11px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded ${statusKleur(
                        a.status
                      )} ${
                        a.status === "vervallen" || a.status === "escalatie"
                          ? "cursor-default"
                          : "cursor-pointer hover:opacity-80 disabled:opacity-50"
                      }`}
                    >
                      {ACTION_STATUS_LABEL[a.status]}
                    </button>
                    {a.status !== "vervallen" && a.status !== "escalatie" && (
                      <div className="flex flex-col items-end gap-0.5 mt-1">
                        <button
                          type="button"
                          onClick={() => patchStatus(a, "vervallen")}
                          disabled={bezig === a.id}
                          className="text-[11px] text-gray-500 hover:underline disabled:opacity-50"
                        >
                          Markeer vervallen
                        </button>
                        <button
                          type="button"
                          onClick={() => patchStatus(a, "escalatie")}
                          disabled={bezig === a.id}
                          className="text-[11px] text-rose-700 hover:underline disabled:opacity-50"
                        >
                          Escaleer
                        </button>
                      </div>
                    )}
                    {(a.status === "vervallen" || a.status === "escalatie") && (
                      <button
                        type="button"
                        onClick={() => patchStatus(a, "open")}
                        disabled={bezig === a.id}
                        className="text-[11px] text-gray-600 hover:underline disabled:opacity-50 mt-1"
                      >
                        Heropen
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
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
