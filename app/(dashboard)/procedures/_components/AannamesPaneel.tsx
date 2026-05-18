"use client";

// Client-component: aannames-paneel voor het Decision Object.
//
// Verantwoordelijkheden:
//   • Lijst van gestructureerde aannames tonen met type, status, onzekerheid.
//   • Toevoegen via een collapsable form (POST /api/decisions/[id]/assumptions).
//   • Status cyclisch wijzigen via klikbare pill (concept → gevalideerd →
//     gewijzigd, en terug). Verwijderen via een aparte knop (soft-delete
//     via status='verwijderd').
//   • Verwijderde aannames worden default verborgen; toggle om ze grijs
//     terug te halen voor audit-blik.
//
// Mutaties roepen `router.refresh()` aan zodat de page-server-component
// opnieuw rendert (readiness, evidence, audit-trail blijven consistent).

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  type Assumption,
  type AssumptionStatus,
  type AssumptionType,
  type Risiconiveau,
  ASSUMPTION_STATUS_LABEL,
  ASSUMPTION_TYPE_LABEL,
  RISICONIVEAU_LABEL,
} from "@/lib/decision-view";

interface Props {
  decisionId: string;
  assumptions: Assumption[];
}

const TYPES: AssumptionType[] = [
  "macro",
  "beleggingsinhoudelijk",
  "risico",
  "kosten",
  "governance",
  "overig",
];

const ONZEKERHEID: Risiconiveau[] = ["laag", "middel", "hoog"];

// Cyclus voor status-pill — 'verwijderd' zit niet in de cyclus om
// per-ongeluk-verwijderen te voorkomen. Voor verwijderen is er een
// aparte knop met confirmation.
const STATUS_CYCLUS: AssumptionStatus[] = [
  "concept",
  "gevalideerd",
  "gewijzigd",
];

function statusKleur(s: AssumptionStatus): string {
  switch (s) {
    case "gevalideerd":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "gewijzigd":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "verwijderd":
      return "bg-gray-100 text-gray-500 border-gray-200 line-through";
    default:
      return "bg-gray-50 text-gray-700 border-gray-200";
  }
}

function onzekerheidKleur(n: Risiconiveau): string {
  switch (n) {
    case "hoog":
      return "bg-rose-50 text-rose-800 border-rose-200";
    case "middel":
      return "bg-amber-50 text-amber-800 border-amber-200";
    default:
      return "bg-blue-50 text-blue-800 border-blue-200";
  }
}

export default function AannamesPaneel({ decisionId, assumptions }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toonVerwijderde, setToonVerwijderde] = useState(false);
  const [bezig, setBezig] = useState<string | null>(null); // id of "nieuw"
  const [fout, setFout] = useState<string | null>(null);

  const [tekst, setTekst] = useState("");
  const [type, setType] = useState<AssumptionType>("overig");
  const [onzekerheid, setOnzekerheid] = useState<Risiconiveau | "">("");
  const [evaluatie, setEvaluatie] = useState("");

  // ── Inline-edit-state (Iteratie 3-C) ────────────────────────────
  // We houden één rij tegelijk in edit-mode. Klik op pen-icoon →
  // velden worden ingeladen in editTekst/editType/etc.; bij Bewaar
  // wordt een PATCH naar /api/decisions/[id]/assumptions/[aid] gedaan.
  const [editId, setEditId] = useState<string | null>(null);
  const [editTekst, setEditTekst] = useState("");
  const [editType, setEditType] = useState<AssumptionType>("overig");
  const [editOnzekerheid, setEditOnzekerheid] = useState<Risiconiveau | "">("");
  const [editEvaluatie, setEditEvaluatie] = useState("");

  function startBewerken(a: Assumption) {
    setEditId(a.id);
    setEditTekst(a.tekst);
    setEditType(a.type);
    setEditOnzekerheid(a.onzekerheid ?? "");
    setEditEvaluatie(a.evaluatiecriterium ?? "");
    setFout(null);
  }

  function annuleerBewerken() {
    setEditId(null);
    setFout(null);
  }

  async function bewaarBewerken(a: Assumption) {
    if (!editTekst.trim()) {
      setFout("Tekst is verplicht");
      return;
    }
    setBezig(a.id);
    setFout(null);
    try {
      // Alleen velden meesturen die echt veranderd zijn. Houdt
      // log-events schoon (de PATCH-route logt per veld).
      const payload: Record<string, unknown> = {};
      const nieuweTekst = editTekst.trim();
      if (nieuweTekst !== a.tekst) payload.tekst = nieuweTekst;
      if (editType !== a.type) payload.type = editType;
      const nieuweOnz: Risiconiveau | null = editOnzekerheid || null;
      if (nieuweOnz !== (a.onzekerheid ?? null)) payload.onzekerheid = nieuweOnz;
      const nieuweEval: string | null = editEvaluatie.trim() || null;
      if (nieuweEval !== (a.evaluatiecriterium ?? null))
        payload.evaluatiecriterium = nieuweEval;

      if (Object.keys(payload).length === 0) {
        annuleerBewerken();
        return;
      }

      const res = await fetch(
        `/api/decisions/${decisionId}/assumptions/${a.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Wijzigen mislukt");
      annuleerBewerken();
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBezig(null);
    }
  }

  const zichtbaar = assumptions.filter(
    (a) => toonVerwijderde || a.status !== "verwijderd"
  );
  const verwijderdAantal = assumptions.filter(
    (a) => a.status === "verwijderd"
  ).length;

  async function nieuw() {
    if (!tekst.trim()) {
      setFout("Tekst is verplicht");
      return;
    }
    setBezig("nieuw");
    setFout(null);
    try {
      const res = await fetch(`/api/decisions/${decisionId}/assumptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tekst: tekst.trim(),
          type,
          onzekerheid: onzekerheid || null,
          evaluatiecriterium: evaluatie.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Aanname toevoegen mislukt");
      // Reset form.
      setTekst("");
      setType("overig");
      setOnzekerheid("");
      setEvaluatie("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBezig(null);
    }
  }

  async function wijzigStatus(a: Assumption, nieuweStatus: AssumptionStatus) {
    setBezig(a.id);
    setFout(null);
    try {
      const res = await fetch(
        `/api/decisions/${decisionId}/assumptions/${a.id}`,
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

  function cyclusStatus(a: Assumption) {
    if (a.status === "verwijderd") return; // klik op verwijderd is no-op
    const idx = STATUS_CYCLUS.indexOf(a.status);
    const volgende = STATUS_CYCLUS[(idx + 1) % STATUS_CYCLUS.length];
    void wijzigStatus(a, volgende);
  }

  function verwijder(a: Assumption) {
    if (
      !confirm(
        `Aanname als verwijderd markeren? Het audit-spoor blijft behouden.\n\n"${a.tekst.slice(0, 80)}${a.tekst.length > 80 ? "…" : ""}"`
      )
    ) {
      return;
    }
    void wijzigStatus(a, "verwijderd");
  }

  function herstel(a: Assumption) {
    void wijzigStatus(a, "concept");
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#0F2744]">Aannames</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Gestructureerde aannames waarop dit besluit rust. Validatie maakt
            ze onderdeel van de readiness-check.
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
          {open ? "Sluiten" : "+ Nieuwe aanname"}
        </button>
      </div>

      {open && (
        <div className="mb-4 border border-gray-200 rounded-lg p-4 bg-gray-50/50 space-y-3">
          <Veldgroep label="Aanname *">
            <textarea
              value={tekst}
              onChange={(e) => setTekst(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Bijv. 'De rendementsverwachting voor zakelijke waarden bedraagt 6% per jaar over de planhorizon.'"
            />
          </Veldgroep>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Veldgroep label="Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AssumptionType)}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ASSUMPTION_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </Veldgroep>
            <Veldgroep label="Onzekerheid">
              <select
                value={onzekerheid}
                onChange={(e) =>
                  setOnzekerheid(e.target.value as Risiconiveau | "")
                }
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
              >
                <option value="">— niet ingevuld —</option>
                {ONZEKERHEID.map((o) => (
                  <option key={o} value={o}>
                    {RISICONIVEAU_LABEL[o]}
                  </option>
                ))}
              </select>
            </Veldgroep>
          </div>
          <Veldgroep label="Evaluatiecriterium (optioneel)">
            <input
              type="text"
              value={evaluatie}
              onChange={(e) => setEvaluatie(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Wanneer is deze aanname onhoudbaar? Bijv. 'rendement < 3% over 24 maanden'"
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

      {zichtbaar.length === 0 ? (
        <div className="text-sm text-gray-400 italic">
          {assumptions.length === 0
            ? "Nog geen aannames vastgelegd. Voeg er één toe om de onderbouwing van het besluit expliciet te maken."
            : "Geen actieve aannames. Klik 'Toon verwijderde' om het volledige spoor te zien."}
        </div>
      ) : (
        <ul className="space-y-3">
          {zichtbaar.map((a) => (
            <li
              key={a.id}
              className={`border rounded-lg p-3 ${
                a.status === "verwijderd"
                  ? "border-gray-200 bg-gray-50/50"
                  : editId === a.id
                    ? "border-[#C9A84C] bg-amber-50/30"
                    : "border-gray-200 bg-white"
              }`}
            >
              {editId === a.id ? (
                // ── Inline edit-form ─────────────────────────────────
                <div className="space-y-3">
                  <Veldgroep label="Aanname *">
                    <textarea
                      value={editTekst}
                      onChange={(e) => setEditTekst(e.target.value)}
                      rows={2}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
                    />
                  </Veldgroep>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Veldgroep label="Type">
                      <select
                        value={editType}
                        onChange={(e) =>
                          setEditType(e.target.value as AssumptionType)
                        }
                        className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
                      >
                        {TYPES.map((t) => (
                          <option key={t} value={t}>
                            {ASSUMPTION_TYPE_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </Veldgroep>
                    <Veldgroep label="Onzekerheid">
                      <select
                        value={editOnzekerheid}
                        onChange={(e) =>
                          setEditOnzekerheid(e.target.value as Risiconiveau | "")
                        }
                        className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
                      >
                        <option value="">— niet ingevuld —</option>
                        {ONZEKERHEID.map((o) => (
                          <option key={o} value={o}>
                            {RISICONIVEAU_LABEL[o]}
                          </option>
                        ))}
                      </select>
                    </Veldgroep>
                  </div>
                  <Veldgroep label="Evaluatiecriterium (optioneel)">
                    <input
                      type="text"
                      value={editEvaluatie}
                      onChange={(e) => setEditEvaluatie(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
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
                      onClick={() => bewaarBewerken(a)}
                      disabled={bezig === a.id}
                      className="bg-[#0F2744] text-white text-sm px-4 py-2 rounded-md hover:bg-[#1a3a5e] disabled:opacity-50"
                    >
                      {bezig === a.id ? "Bezig…" : "Bewaar"}
                    </button>
                    <button
                      type="button"
                      onClick={annuleerBewerken}
                      disabled={bezig === a.id}
                      className="text-sm text-gray-600 hover:text-gray-900 px-3 py-2"
                    >
                      Annuleer
                    </button>
                  </div>
                </div>
              ) : (
                // ── Read-only weergave ───────────────────────────────
                <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm ${
                      a.status === "verwijderd"
                        ? "text-gray-500 line-through"
                        : "text-gray-900"
                    } whitespace-pre-line`}
                  >
                    {a.tekst}
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded">
                      {ASSUMPTION_TYPE_LABEL[a.type]}
                    </span>
                    {a.onzekerheid && (
                      <span
                        className={`text-[11px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded ${onzekerheidKleur(
                          a.onzekerheid
                        )}`}
                      >
                        Onzekerheid: {RISICONIVEAU_LABEL[a.onzekerheid]}
                      </span>
                    )}
                    {a.ai_gedetecteerd && (
                      <span className="text-[11px] font-medium uppercase tracking-wide text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded">
                        AI-gedetecteerd
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => cyclusStatus(a)}
                      disabled={
                        bezig === a.id || a.status === "verwijderd"
                      }
                      title={
                        a.status === "verwijderd"
                          ? "Verwijderd"
                          : "Klik om status te wijzigen"
                      }
                      className={`text-[11px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded ${statusKleur(
                        a.status
                      )} ${
                        a.status === "verwijderd"
                          ? "cursor-default"
                          : "cursor-pointer hover:opacity-80 disabled:opacity-50"
                      }`}
                    >
                      {ASSUMPTION_STATUS_LABEL[a.status]}
                    </button>
                  </div>
                  {a.evaluatiecriterium && (
                    <div className="text-xs text-gray-600 mt-2 italic">
                      Evaluatiecriterium: {a.evaluatiecriterium}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {a.status === "verwijderd" ? (
                    <button
                      type="button"
                      onClick={() => herstel(a)}
                      disabled={bezig === a.id}
                      className="text-xs text-[#0F2744] hover:underline disabled:opacity-50"
                    >
                      Herstellen
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => startBewerken(a)}
                        disabled={bezig === a.id}
                        className="text-xs text-[#0F2744] hover:underline disabled:opacity-50"
                        title="Aanname bewerken"
                      >
                        Bewerk
                      </button>
                      <button
                        type="button"
                        onClick={() => verwijder(a)}
                        disabled={bezig === a.id}
                        className="text-xs text-rose-700 hover:underline disabled:opacity-50"
                      >
                        Verwijder
                      </button>
                    </>
                  )}
                </div>
              </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {verwijderdAantal > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setToonVerwijderde((v) => !v)}
            className="text-xs text-gray-500 hover:text-[#0F2744]"
          >
            {toonVerwijderde
              ? `Verberg verwijderde (${verwijderdAantal})`
              : `Toon verwijderde (${verwijderdAantal})`}
          </button>
        </div>
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
