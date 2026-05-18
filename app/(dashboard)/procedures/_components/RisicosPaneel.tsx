"use client";

// Client-component: risico's-paneel voor het Decision Object.
//
// Beslissingsgebonden risico's (los van de fonds-brede risicomatrix,
// optionele koppeling via `risicomatrix_id` is in MVP-1 nog niet via
// de UI bewerkbaar — komt in iteratie 2).
//
// Toont per risico: beschrijving, categorie, K×I-cijfer, eigenaar,
// mitigatie, residual risk, status (open / gemitigeerd / geaccepteerd).
// Status-pill is klikbaar met confirm bij overgang naar
// gemitigeerd/geaccepteerd. Verwijderen is bewust uitgesloten — een
// onnodig risico wordt 'geaccepteerd' (audit-spoor blijft).

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  type RiskCategorie,
  type RiskItem,
  type RiskStatus,
  RISK_CATEGORIE_LABEL,
  RISK_STATUS_LABEL,
} from "@/lib/decision-view";

interface Props {
  decisionId: string;
  risks: RiskItem[];
}

const CATEGORIEEN: RiskCategorie[] = [
  "financieel",
  "operationeel",
  "juridisch",
  "reputatie",
  "liquiditeit",
  "compliance",
  "overig",
];

const KI_OPTIES = [1, 2, 3, 4, 5] as const;
type Ki = (typeof KI_OPTIES)[number];

function statusKleur(s: RiskStatus): string {
  switch (s) {
    case "gemitigeerd":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "geaccepteerd":
      return "bg-blue-50 text-blue-800 border-blue-200";
    default:
      return "bg-rose-50 text-rose-800 border-rose-200";
  }
}

// Kleur voor K×I-product — afgeleid uit de risicomatrix-conventie
// in `lib/risico-config.ts` (laag/middel/hoog op basis van K+I, hier
// als K×I voor compactheid: ≤4 groen, 5-9 amber, ≥10 rood).
function kiKleur(impact: number | null, kans: number | null): string {
  if (impact === null || kans === null) return "bg-gray-100 text-gray-600";
  const score = impact * kans;
  if (score >= 10) return "bg-rose-100 text-rose-900";
  if (score >= 5) return "bg-amber-100 text-amber-900";
  return "bg-emerald-100 text-emerald-900";
}

export default function RisicosPaneel({ decisionId, risks }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bezig, setBezig] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const [beschrijving, setBeschrijving] = useState("");
  const [categorie, setCategorie] = useState<RiskCategorie | "">("");
  const [impact, setImpact] = useState<Ki | "">("");
  const [kans, setKans] = useState<Ki | "">("");
  const [eigenaar, setEigenaar] = useState("");
  const [mitigatie, setMitigatie] = useState("");
  const [residual, setResidual] = useState("");

  // ── Inline-edit-state (Iteratie 3-C) ─────────────────────────
  const [editId, setEditId] = useState<string | null>(null);
  const [editBeschrijving, setEditBeschrijving] = useState("");
  const [editCategorie, setEditCategorie] = useState<RiskCategorie | "">("");
  const [editImpact, setEditImpact] = useState<Ki | "">("");
  const [editKans, setEditKans] = useState<Ki | "">("");
  const [editEigenaar, setEditEigenaar] = useState("");
  const [editMitigatie, setEditMitigatie] = useState("");
  const [editResidual, setEditResidual] = useState("");

  function startBewerken(r: RiskItem) {
    setEditId(r.id);
    setEditBeschrijving(r.beschrijving);
    setEditCategorie(r.categorie ?? "");
    setEditImpact((r.impact as Ki | null) ?? "");
    setEditKans((r.kans as Ki | null) ?? "");
    setEditEigenaar(r.eigenaar_naam ?? "");
    setEditMitigatie(r.mitigatie ?? "");
    setEditResidual(r.residual_risk ?? "");
    setFout(null);
  }

  function annuleerBewerken() {
    setEditId(null);
    setFout(null);
  }

  async function bewaarBewerken(r: RiskItem) {
    if (!editBeschrijving.trim()) {
      setFout("Beschrijving is verplicht");
      return;
    }
    setBezig(r.id);
    setFout(null);
    try {
      const payload: Record<string, unknown> = {};
      const nieuw = editBeschrijving.trim();
      if (nieuw !== r.beschrijving) payload.beschrijving = nieuw;
      const nieuweCat = editCategorie || null;
      if (nieuweCat !== (r.categorie ?? null)) payload.categorie = nieuweCat;
      const nieuwImpact: number | null = editImpact === "" ? null : editImpact;
      if (nieuwImpact !== (r.impact ?? null)) payload.impact = nieuwImpact;
      const nieuwKans: number | null = editKans === "" ? null : editKans;
      if (nieuwKans !== (r.kans ?? null)) payload.kans = nieuwKans;
      const nieuwEigenaar: string | null = editEigenaar.trim() || null;
      if (nieuwEigenaar !== (r.eigenaar_naam ?? null))
        payload.eigenaar_naam = nieuwEigenaar;
      const nieuwMitig: string | null = editMitigatie.trim() || null;
      if (nieuwMitig !== (r.mitigatie ?? null)) payload.mitigatie = nieuwMitig;
      const nieuwResid: string | null = editResidual.trim() || null;
      if (nieuwResid !== (r.residual_risk ?? null))
        payload.residual_risk = nieuwResid;

      if (Object.keys(payload).length === 0) {
        annuleerBewerken();
        return;
      }

      const res = await fetch(`/api/decisions/${decisionId}/risks/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
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

  async function nieuw() {
    if (!beschrijving.trim()) {
      setFout("Beschrijving is verplicht");
      return;
    }
    setBezig("nieuw");
    setFout(null);
    try {
      const res = await fetch(`/api/decisions/${decisionId}/risks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beschrijving: beschrijving.trim(),
          categorie: categorie || undefined,
          impact: impact === "" ? null : impact,
          kans: kans === "" ? null : kans,
          eigenaar_naam: eigenaar.trim() || null,
          mitigatie: mitigatie.trim() || null,
          residual_risk: residual.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Risico toevoegen mislukt");
      // Reset.
      setBeschrijving("");
      setCategorie("");
      setImpact("");
      setKans("");
      setEigenaar("");
      setMitigatie("");
      setResidual("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBezig(null);
    }
  }

  async function wijzigStatus(r: RiskItem, nieuweStatus: RiskStatus) {
    if (
      (nieuweStatus === "gemitigeerd" || nieuweStatus === "geaccepteerd") &&
      r.status === "open"
    ) {
      const label = nieuweStatus === "gemitigeerd" ? "Gemitigeerd" : "Geaccepteerd";
      const veldNaam = nieuweStatus === "gemitigeerd" ? "mitigatie" : "rationale";
      const heeftVeld =
        nieuweStatus === "gemitigeerd" ? r.mitigatie : r.residual_risk;
      if (
        !heeftVeld &&
        !confirm(
          `Risico naar status '${label}'? Er is nog geen ${veldNaam} ingevuld — vul die eerst in voor een volledig dossier, of bevestig om door te zetten.`
        )
      ) {
        return;
      }
    }
    setBezig(r.id);
    setFout(null);
    try {
      const res = await fetch(`/api/decisions/${decisionId}/risks/${r.id}`, {
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

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#0F2744]">
            Risico&apos;s (besluitgebonden)
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Risico&apos;s die specifiek bij dit besluit horen, met optionele
            koppeling aan de fondsbrede risicomatrix.
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
          {open ? "Sluiten" : "+ Nieuw risico"}
        </button>
      </div>

      {open && (
        <div className="mb-4 border border-gray-200 rounded-lg p-4 bg-gray-50/50 space-y-3">
          <Veldgroep label="Beschrijving *">
            <textarea
              value={beschrijving}
              onChange={(e) => setBeschrijving(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Bijv. 'Liquiditeitsdruk in onderpand bij snelle rentestijging.'"
            />
          </Veldgroep>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Veldgroep label="Categorie">
              <select
                value={categorie}
                onChange={(e) => setCategorie(e.target.value as RiskCategorie | "")}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
              >
                <option value="">— niet ingevuld —</option>
                {CATEGORIEEN.map((c) => (
                  <option key={c} value={c}>
                    {RISK_CATEGORIE_LABEL[c]}
                  </option>
                ))}
              </select>
            </Veldgroep>
            <Veldgroep label="Impact (1-5)">
              <select
                value={impact}
                onChange={(e) =>
                  setImpact(e.target.value === "" ? "" : (Number(e.target.value) as Ki))
                }
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
              >
                <option value="">—</option>
                {KI_OPTIES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Veldgroep>
            <Veldgroep label="Kans (1-5)">
              <select
                value={kans}
                onChange={(e) =>
                  setKans(e.target.value === "" ? "" : (Number(e.target.value) as Ki))
                }
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
              >
                <option value="">—</option>
                {KI_OPTIES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Veldgroep>
          </div>
          <Veldgroep label="Eigenaar (optioneel)">
            <input
              type="text"
              value={eigenaar}
              onChange={(e) => setEigenaar(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Naam van eigenaar"
            />
          </Veldgroep>
          <Veldgroep label="Mitigatie (optioneel)">
            <textarea
              value={mitigatie}
              onChange={(e) => setMitigatie(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Welke maatregelen verlagen de impact of de kans?"
            />
          </Veldgroep>
          <Veldgroep label="Restrisico / rationale (optioneel)">
            <textarea
              value={residual}
              onChange={(e) => setResidual(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Wat blijft er over na mitigatie? Of: waarom accepteren we dit risico?"
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

      {risks.length === 0 ? (
        <div className="text-sm text-gray-400 italic">
          Nog geen risico&apos;s vastgelegd. Voeg er minimaal één toe; de
          readiness-check vraagt expliciete risicoregistratie voordat het
          dossier reviewrijp is.
        </div>
      ) : (
        <ul className="space-y-3">
          {risks.map((r) => (
            <li
              key={r.id}
              className={`border rounded-lg p-3 ${
                editId === r.id
                  ? "border-[#C9A84C] bg-amber-50/30"
                  : "border-gray-200 bg-white"
              }`}
            >
              {editId === r.id ? (
                // ── Inline edit-form ───────────────────────────
                <div className="space-y-3">
                  <Veldgroep label="Beschrijving *">
                    <textarea
                      value={editBeschrijving}
                      onChange={(e) => setEditBeschrijving(e.target.value)}
                      rows={2}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
                    />
                  </Veldgroep>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Veldgroep label="Categorie">
                      <select
                        value={editCategorie}
                        onChange={(e) =>
                          setEditCategorie(e.target.value as RiskCategorie | "")
                        }
                        className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
                      >
                        <option value="">— niet ingevuld —</option>
                        {CATEGORIEEN.map((c) => (
                          <option key={c} value={c}>
                            {RISK_CATEGORIE_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </Veldgroep>
                    <Veldgroep label="Impact (1-5)">
                      <select
                        value={editImpact}
                        onChange={(e) =>
                          setEditImpact(
                            e.target.value === ""
                              ? ""
                              : (Number(e.target.value) as Ki)
                          )
                        }
                        className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
                      >
                        <option value="">—</option>
                        {KI_OPTIES.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </Veldgroep>
                    <Veldgroep label="Kans (1-5)">
                      <select
                        value={editKans}
                        onChange={(e) =>
                          setEditKans(
                            e.target.value === ""
                              ? ""
                              : (Number(e.target.value) as Ki)
                          )
                        }
                        className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
                      >
                        <option value="">—</option>
                        {KI_OPTIES.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </Veldgroep>
                  </div>
                  <Veldgroep label="Eigenaar (optioneel)">
                    <input
                      type="text"
                      value={editEigenaar}
                      onChange={(e) => setEditEigenaar(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
                    />
                  </Veldgroep>
                  <Veldgroep label="Mitigatie (optioneel)">
                    <textarea
                      value={editMitigatie}
                      onChange={(e) => setEditMitigatie(e.target.value)}
                      rows={2}
                      className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
                    />
                  </Veldgroep>
                  <Veldgroep label="Restrisico / rationale (optioneel)">
                    <textarea
                      value={editResidual}
                      onChange={(e) => setEditResidual(e.target.value)}
                      rows={2}
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
                      onClick={() => bewaarBewerken(r)}
                      disabled={bezig === r.id}
                      className="bg-[#0F2744] text-white text-sm px-4 py-2 rounded-md hover:bg-[#1a3a5e] disabled:opacity-50"
                    >
                      {bezig === r.id ? "Bezig…" : "Bewaar"}
                    </button>
                    <button
                      type="button"
                      onClick={annuleerBewerken}
                      disabled={bezig === r.id}
                      className="text-sm text-gray-600 hover:text-gray-900 px-3 py-2"
                    >
                      Annuleer
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900 whitespace-pre-line">
                    {r.beschrijving}
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {r.categorie && (
                      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded">
                        {RISK_CATEGORIE_LABEL[r.categorie]}
                      </span>
                    )}
                    {(r.impact !== null || r.kans !== null) && (
                      <span
                        className={`text-[11px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${kiKleur(
                          r.impact,
                          r.kans
                        )}`}
                        title="Impact × Kans"
                      >
                        I {r.impact ?? "—"} · K {r.kans ?? "—"}
                      </span>
                    )}
                    {r.eigenaar_naam && (
                      <span className="text-[11px] text-gray-500">
                        Eigenaar: {r.eigenaar_naam}
                      </span>
                    )}
                  </div>
                  {r.mitigatie && (
                    <div className="mt-2 text-xs text-gray-700 border-l-2 border-emerald-200 pl-3 whitespace-pre-line">
                      <span className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold block mb-0.5">
                        Mitigatie
                      </span>
                      {r.mitigatie}
                    </div>
                  )}
                  {r.residual_risk && (
                    <div className="mt-2 text-xs text-gray-700 border-l-2 border-amber-200 pl-3 whitespace-pre-line">
                      <span className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold block mb-0.5">
                        Restrisico
                      </span>
                      {r.residual_risk}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 min-w-[110px]">
                  <span
                    className={`text-[11px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded ${statusKleur(
                      r.status
                    )}`}
                  >
                    {RISK_STATUS_LABEL[r.status]}
                  </span>
                  {r.status === "open" ? (
                    <div className="flex flex-col items-end gap-0.5 mt-1">
                      <button
                        type="button"
                        onClick={() => wijzigStatus(r, "gemitigeerd")}
                        disabled={bezig === r.id}
                        className="text-[11px] text-emerald-800 hover:underline disabled:opacity-50"
                      >
                        Markeer gemitigeerd
                      </button>
                      <button
                        type="button"
                        onClick={() => wijzigStatus(r, "geaccepteerd")}
                        disabled={bezig === r.id}
                        className="text-[11px] text-blue-800 hover:underline disabled:opacity-50"
                      >
                        Accepteren
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => wijzigStatus(r, "open")}
                      disabled={bezig === r.id}
                      className="text-[11px] text-gray-600 hover:underline disabled:opacity-50 mt-1"
                    >
                      Heropen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => startBewerken(r)}
                    disabled={bezig === r.id}
                    className="text-[11px] text-[#0F2744] hover:underline disabled:opacity-50 mt-1"
                    title="Risico bewerken"
                  >
                    Bewerk
                  </button>
                </div>
              </div>
              )}
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
