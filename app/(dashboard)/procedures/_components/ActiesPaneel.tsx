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
} from "@/core/lib/decision-view";

interface Props {
  decisionId: string;
  actions: ActionItem[];
  conditions: DecisionCondition[];
  actieEigenaren: { id: string; naam: string }[];
}

const STATUS_CYCLUS: ActionStatus[] = [
  "open",
  "in_behandeling",
  "afgerond",
];

function statusKleur(s: ActionStatus): string {
  switch (s) {
    case "afgerond":
      return "bg-ok-tint text-ok-ink border-ok/30";
    case "in_behandeling":
      return "bg-accent-tint text-accent-ink border-accent/30";
    case "vervallen":
      return "bg-app-bg text-muted border-line";
    case "escalatie":
      return "bg-err-tint text-err-ink border-err/30";
    default:
      return "bg-app-bg text-ink border-line";
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
  actieEigenaren,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bezig, setBezig] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const [actie, setActie] = useState("");
  const [eigenaarKeuze, setEigenaarKeuze] = useState("");
  const [externeEigenaar, setExterneEigenaar] = useState("");
  const [deadline, setDeadline] = useState("");
  const [voorwaardeId, setVoorwaardeId] = useState("");

  async function nieuw() {
    if (!actie.trim()) {
      setFout("Actie is verplicht");
      return;
    }
    if (eigenaarKeuze === "extern" && !externeEigenaar.trim()) {
      setFout("Vul de naam van de externe houder in");
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
          eigenaar_id:
            eigenaarKeuze && eigenaarKeuze !== "extern" ? eigenaarKeuze : null,
          eigenaar_naam:
            eigenaarKeuze === "extern" ? externeEigenaar.trim() || null : null,
          deadline: deadline || null,
          voorwaarde_id: voorwaardeId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Toevoegen mislukt");
      setActie("");
      setEigenaarKeuze("");
      setExterneEigenaar("");
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

  async function patchEigenaar(a: ActionItem, nieuweEigenaarId: string) {
    setBezig(a.id);
    setFout(null);
    try {
      const res = await fetch(`/api/decisions/${decisionId}/actions/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eigenaar_id: nieuweEigenaarId || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Eigenaar wijzigen mislukt");
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
  const eigenaarMap = new Map(
    actieEigenaren.map((eigenaar) => [eigenaar.id, eigenaar.naam])
  );

  return (
    <div className="bg-white border border-line rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-ink">Acties</h3>
          <p className="text-xs text-muted mt-0.5">
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
          className="text-xs text-ink hover:underline whitespace-nowrap"
        >
          {open ? "Sluiten" : "+ Nieuwe actie"}
        </button>
      </div>

      {open && (
        <div className="mb-4 border border-line rounded-lg p-4 bg-app-bg/50 space-y-3">
          <Veldgroep label="Actie *">
            <textarea
              value={actie}
              onChange={(e) => setActie(e.target.value)}
              rows={2}
              className="w-full text-sm border border-app-line-strong rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="Wat moet er concreet gebeuren?"
            />
          </Veldgroep>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Veldgroep label="Eigenaar">
              <select
                value={eigenaarKeuze}
                onChange={(e) => setEigenaarKeuze(e.target.value)}
                className="w-full text-sm border border-app-line-strong rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="">— geen eigenaar —</option>
                <option value="extern">Externe houder…</option>
                {actieEigenaren.map((eigenaar) => (
                  <option key={eigenaar.id} value={eigenaar.id}>
                    {eigenaar.naam}
                  </option>
                ))}
              </select>
              {eigenaarKeuze === "extern" && (
                <input
                  type="text"
                  value={externeEigenaar}
                  onChange={(e) => setExterneEigenaar(e.target.value)}
                  className="w-full mt-2 text-sm border border-app-line-strong rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/40"
                  placeholder="Naam externe houder"
                  aria-label="Naam externe actie-eigenaar"
                />
              )}
            </Veldgroep>
            <Veldgroep label="Deadline">
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full text-sm border border-app-line-strong rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </Veldgroep>
          </div>
          <Veldgroep label="Bewaakt voorwaarde (optioneel)">
            <select
              value={voorwaardeId}
              onChange={(e) => setVoorwaardeId(e.target.value)}
              className="w-full text-sm border border-app-line-strong rounded-md px-3 py-2 bg-white"
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
            <div className="text-xs text-err-ink bg-err-tint border border-err/30 rounded-md px-3 py-2">
              {fout}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={nieuw}
              disabled={bezig === "nieuw"}
              className="bg-accent text-white text-sm px-4 py-2 rounded-md hover:bg-accent-ink disabled:opacity-50"
            >
              {bezig === "nieuw" ? "Bezig…" : "Toevoegen"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setFout(null);
              }}
              className="text-sm text-muted hover:text-ink px-3 py-2"
            >
              Annuleer
            </button>
          </div>
        </div>
      )}

      {actions.length === 0 ? (
        <div className="text-sm text-muted italic">
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
                className="border border-line rounded-lg p-3 bg-white"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink whitespace-pre-line">
                      {a.actie}
                    </div>
                    <div className="flex items-center gap-3 mt-2 flex-wrap text-xs">
                      <label className="text-muted flex items-center gap-1.5">
                        Eigenaar:
                        <select
                          value={a.eigenaar_id ?? ""}
                          onChange={(e) => void patchEigenaar(a, e.target.value)}
                          disabled={bezig === a.id}
                          className="max-w-48 text-xs text-ink border border-app-line-strong rounded px-1.5 py-1 bg-white disabled:opacity-50"
                          aria-label={`Eigenaar van actie: ${a.actie}`}
                        >
                          <option value="">— geen eigenaar —</option>
                          {actieEigenaren.map((eigenaar) => (
                            <option key={eigenaar.id} value={eigenaar.id}>
                              {eigenaar.naam}
                            </option>
                          ))}
                        </select>
                        {!a.eigenaar_id && a.eigenaar_naam && (
                          <span className="text-ink">{a.eigenaar_naam}</span>
                        )}
                        {a.eigenaar_id && !eigenaarMap.has(a.eigenaar_id) && a.eigenaar_naam && (
                          <span className="text-ink">{a.eigenaar_naam}</span>
                        )}
                      </label>
                      {a.deadline && (
                        <span className="text-muted">
                          Deadline:{" "}
                          <span className="text-ink">
                            {formatDatum(a.deadline)}
                          </span>
                        </span>
                      )}
                      {voorw && (
                        <span className="text-muted">
                          Bewaakt:{" "}
                          <span className="text-ink italic">
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
                          className="text-[11px] text-muted hover:underline disabled:opacity-50"
                        >
                          Markeer vervallen
                        </button>
                        <button
                          type="button"
                          onClick={() => patchStatus(a, "escalatie")}
                          disabled={bezig === a.id}
                          className="text-[11px] text-err-ink hover:underline disabled:opacity-50"
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
                        className="text-[11px] text-muted hover:underline disabled:opacity-50 mt-1"
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
        <div className="mt-3 text-xs text-err-ink bg-err-tint border border-err/30 rounded-md px-3 py-2">
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
      <label className="text-[11px] uppercase tracking-wide text-muted font-semibold block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
