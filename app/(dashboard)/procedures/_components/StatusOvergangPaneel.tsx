"use client";

// Client-component: status-overgang voor het Decision Object met
// readiness-gate. Per gekozen target tonen we de readiness-stand —
// bij niet-voldoen zien voorzitter/beheerder een override-veld dat
// een 'override_<readiness>'-event in `governance_events` legt.
//
// De DB-trigger `fn_decision_status_check` valideert de overgang
// zelf; ongeldige combinaties (bv. concept → besloten) leveren een
// fout uit de API die we 1-op-1 in de UI tonen.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type DecisionObject,
  type DecisionStatus,
  type ReadinessOverview,
  type ReadinessTarget,
  DECISION_STATUS_LABEL,
  READINESS_LABEL,
} from "@/lib/decision-view";

interface Props {
  decision: DecisionObject;
  readiness: ReadinessOverview;
  currentUserIsPrivileged: boolean;
}

// Logische volgende statussen per huidige status. Eindstatussen
// (afgewezen, geannuleerd) staan niet in deze map omdat verdere
// overgangen daar niet bestaan; de DB-trigger zou ze sowieso weigeren.
const VOLGENDE_STATUSSEN: Partial<Record<DecisionStatus, DecisionStatus[]>> = {
  concept: ["in_onderbouwing", "geannuleerd"],
  in_onderbouwing: ["in_validatie", "teruggezet", "geannuleerd"],
  in_validatie: ["in_review", "geescaleerd", "teruggezet"],
  in_review: ["geagendeerd", "aangehouden", "teruggezet"],
  geagendeerd: ["in_bespreking", "aangehouden"],
  in_bespreking: [
    "besloten",
    "voorwaardelijk_besloten",
    "aangehouden",
    "teruggezet",
  ],
  besloten: ["in_uitvoering", "afgewezen"],
  voorwaardelijk_besloten: ["in_uitvoering"],
  in_uitvoering: ["in_evaluatie"],
  in_evaluatie: ["afgesloten"],
  afgesloten: ["heropend"],
  heropend: ["in_validatie", "in_review", "aangehouden"],
  geescaleerd: ["in_validatie", "in_review", "aangehouden"],
};

// Mapping target → readiness-niveau (§9 ontwerpdoc).
const READINESS_VOOR_STATUS: Partial<Record<DecisionStatus, ReadinessTarget>> = {
  in_review: "reviewrijp",
  geagendeerd: "bespreekrijp",
  besloten: "besluitrijp",
  voorwaardelijk_besloten: "besluitrijp",
  afgesloten: "verantwoordingsrijp",
};

function statusKleur(s: DecisionStatus): string {
  if (
    s === "besloten" ||
    s === "voorwaardelijk_besloten" ||
    s === "in_uitvoering" ||
    s === "in_evaluatie" ||
    s === "afgesloten"
  ) {
    return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
  if (s === "afgewezen" || s === "geannuleerd") {
    return "bg-rose-50 text-rose-800 border-rose-200";
  }
  if (s === "aangehouden" || s === "teruggezet" || s === "geescaleerd") {
    return "bg-amber-50 text-amber-800 border-amber-200";
  }
  return "bg-blue-50 text-blue-800 border-blue-200";
}

export default function StatusOvergangPaneel({
  decision,
  readiness,
  currentUserIsPrivileged,
}: Props) {
  const router = useRouter();
  const [target, setTarget] = useState<DecisionStatus | "">("");
  const [reden, setReden] = useState("");
  const [overrideReden, setOverrideReden] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const vlgndOpties = useMemo(
    () => VOLGENDE_STATUSSEN[decision.status] ?? [],
    [decision.status]
  );

  // Readiness-stand voor het gekozen target; null als geen
  // readiness-gate bestaat voor deze overgang.
  const readinessVoorTarget = target
    ? READINESS_VOOR_STATUS[target as DecisionStatus]
    : undefined;
  const readinessResult = readinessVoorTarget
    ? readiness[readinessVoorTarget]
    : null;

  // Aanvullend: bij target=afgesloten + complex/hoog → ook evaluatierijp.
  const ookEvaluatierijp =
    target === "afgesloten" &&
    (decision.complexiteit === "complex" || decision.risiconiveau === "hoog");
  const evaluatieResult = ookEvaluatierijp ? readiness.evaluatierijp : null;

  const readinessVoldoet =
    (readinessResult ? readinessResult.voldoet : true) &&
    (evaluatieResult ? evaluatieResult.voldoet : true);

  const overrideNodig = !readinessVoldoet;
  const kanZonderOverride = !overrideNodig;
  const kanMetOverride =
    overrideNodig && currentUserIsPrivileged && overrideReden.trim().length > 0;

  async function uitvoeren() {
    if (!target) {
      setFout("Kies een doelstatus");
      return;
    }
    setBezig(true);
    setFout(null);
    try {
      const body: Record<string, unknown> = { status: target };
      if (reden.trim()) body.reden = reden.trim();
      if (overrideNodig && overrideReden.trim()) {
        body.override_reden = overrideReden.trim();
      }
      const res = await fetch(`/api/decisions/${decision.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        // Bij readiness-fout krijgen we readiness-payload terug;
        // die laten we de UI tonen door state te triggeren.
        const msg = json.error ?? "Statusovergang mislukt";
        const hint = json.hint ? ` ${json.hint}` : "";
        throw new Error(`${msg}${hint}`);
      }
      setReden("");
      setOverrideReden("");
      setTarget("");
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBezig(false);
    }
  }

  if (vlgndOpties.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[#0F2744] mb-2">
          Status-overgang
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Huidig:
          </span>
          <span
            className={`text-[11px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded ${statusKleur(
              decision.status
            )}`}
          >
            {DECISION_STATUS_LABEL[decision.status]}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Geen overgangen meer mogelijk vanuit deze status.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-[#0F2744] mb-3">
        Status-overgang
      </h3>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
          Huidig:
        </span>
        <span
          className={`text-[11px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded ${statusKleur(
            decision.status
          )}`}
        >
          {DECISION_STATUS_LABEL[decision.status]}
        </span>
      </div>

      <div className="space-y-3">
        <Veldgroep label="Volgende status">
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as DecisionStatus | "");
              setFout(null);
            }}
            className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
          >
            <option value="">— kies doelstatus —</option>
            {vlgndOpties.map((s) => (
              <option key={s} value={s}>
                {DECISION_STATUS_LABEL[s]}
                {READINESS_VOOR_STATUS[s]
                  ? ` (vereist ${READINESS_LABEL[READINESS_VOOR_STATUS[s]!]})`
                  : ""}
              </option>
            ))}
          </select>
        </Veldgroep>

        {target && readinessResult && (
          <ReadinessHint
            label={`Readiness: ${READINESS_LABEL[readinessResult.target]}`}
            voldoet={readinessResult.voldoet}
            ontbrekend={readinessResult.ontbrekend.map((o) => o.label)}
          />
        )}
        {target && evaluatieResult && (
          <ReadinessHint
            label={`Aanvullend bij complex/hoog: ${READINESS_LABEL.evaluatierijp}`}
            voldoet={evaluatieResult.voldoet}
            ontbrekend={evaluatieResult.ontbrekend.map((o) => o.label)}
          />
        )}

        <Veldgroep label="Reden voor overgang (optioneel)">
          <input
            type="text"
            value={reden}
            onChange={(e) => setReden(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
            placeholder="Korte aanduiding voor het audit-spoor"
          />
        </Veldgroep>

        {target && overrideNodig && currentUserIsPrivileged && (
          <Veldgroep label="Override-motivering (verplicht voor doorzetten)">
            <textarea
              value={overrideReden}
              onChange={(e) => setOverrideReden(e.target.value)}
              rows={3}
              className="w-full text-sm border border-amber-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/40 bg-amber-50/40"
              placeholder="Waarom mag deze overgang plaatsvinden ondanks ontbrekende readiness?"
            />
            <p className="text-[11px] text-amber-800 mt-1">
              Wordt apart gelogd als <code>override_…</code>-event in het
              auditdossier.
            </p>
          </Veldgroep>
        )}

        {target && overrideNodig && !currentUserIsPrivileged && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            Deze overgang vereist readiness die nog niet vervuld is. Alleen
            voorzitter of beheerder kan een onderbouwde override doorzetten.
          </div>
        )}

        {fout && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 whitespace-pre-line">
            {fout}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={uitvoeren}
            disabled={
              !target || bezig || (!kanZonderOverride && !kanMetOverride)
            }
            className="bg-[#0F2744] text-white text-sm px-4 py-2 rounded-md hover:bg-[#1a3a5e] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bezig ? "Bezig…" : kanMetOverride ? "Doorzetten via override" : "Overgang doorvoeren"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReadinessHint({
  label,
  voldoet,
  ontbrekend,
}: {
  label: string;
  voldoet: boolean;
  ontbrekend: string[];
}) {
  return (
    <div
      className={`text-xs border rounded-md px-3 py-2 ${
        voldoet
          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
          : "bg-amber-50 border-amber-200 text-amber-900"
      }`}
    >
      <div className="font-semibold flex items-center gap-1.5">
        <span aria-hidden>{voldoet ? "✓" : "⚠"}</span>
        {label}
      </div>
      {!voldoet && ontbrekend.length > 0 && (
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          {ontbrekend.slice(0, 6).map((label, idx) => (
            <li key={idx}>{label}</li>
          ))}
          {ontbrekend.length > 6 && (
            <li className="italic">
              … plus {ontbrekend.length - 6} andere ontbrekende vereisten
            </li>
          )}
        </ul>
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
