"use client";

// Client-component: status-overgang voor het Decision Object.
//
// §4.4-signalering i.p.v. de oude readiness-gate (besluit 0187/0193): een overgang
// wordt NIET geblokkeerd omdat er iets openstaat — een bestuur mag besluiten vóór de
// nazorg af is. Maar een besluit-transitie die doorgaat terwijl er vereisten open
// staan bóven optioneel vereist een MOTIVERING (I2, zelfde vorm als de afwijking bij
// afronden) en wordt append-only vastgelegd. Niet blokkeren, wél onthouden.
//
// De DB-trigger `fn_decision_status_check` (I4) valideert de overgang zelf;
// ongeldige combinaties (bv. concept → besloten) leveren een fout uit de API.

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type DecisionObject,
  type DecisionStatus,
  type EvidenceItem,
  DECISION_STATUS_LABEL,
} from "@/core/lib/decision-view";
import {
  openVoorBesluitmomenten,
  heeftOpenBovenOptioneel,
  type OpenPerZwaarte,
} from "@/core/lib/besluitmoment-telling";
import { MIN_MOTIVERING_LENGTE } from "@/core/lib/afwijking";

interface Props {
  decision: DecisionObject;
  /** Evidence-lijst; hieruit komt de openstaand-telling per zwaarte. */
  evidence: EvidenceItem[];
  /** Volgordes van de besluitmoment-stappen (`vereist_besluit`) — de eis is
   *  besluitmoment-scoped, niet dossierbreed (Q1, besluit 0193). */
  besluitmomentStappen: number[];
}

// Logische volgende statussen per huidige status. Eindstatussen staan niet in de
// map; de DB-trigger zou verdere overgangen daar sowieso weigeren.
const VOLGENDE_STATUSSEN: Partial<Record<DecisionStatus, DecisionStatus[]>> = {
  concept: ["in_onderbouwing", "geannuleerd"],
  in_onderbouwing: ["in_validatie", "teruggezet", "geannuleerd"],
  in_validatie: ["in_review", "geescaleerd", "teruggezet"],
  in_review: ["geagendeerd", "aangehouden", "teruggezet"],
  geagendeerd: ["in_bespreking", "aangehouden"],
  in_bespreking: ["besloten", "voorwaardelijk_besloten", "aangehouden", "teruggezet"],
  besloten: ["in_uitvoering", "afgewezen"],
  voorwaardelijk_besloten: ["in_uitvoering"],
  in_uitvoering: ["in_evaluatie"],
  in_evaluatie: ["afgesloten"],
  afgesloten: ["heropend"],
  heropend: ["in_validatie", "in_review", "aangehouden"],
  geescaleerd: ["in_validatie", "in_review", "aangehouden"],
};

// De transities die "een feit stellen" — hier geldt de motivering-eis bij iets open.
const BESLUIT_TRANSITIES: DecisionStatus[] = ["besloten", "voorwaardelijk_besloten"];

function statusKleur(s: DecisionStatus): string {
  if (
    s === "besloten" ||
    s === "voorwaardelijk_besloten" ||
    s === "in_uitvoering" ||
    s === "in_evaluatie" ||
    s === "afgesloten"
  ) {
    return "bg-ok-tint text-ok-ink border-ok/30";
  }
  if (s === "afgewezen" || s === "geannuleerd") {
    return "bg-err-tint text-err-ink border-err/30";
  }
  if (s === "aangehouden" || s === "teruggezet" || s === "geescaleerd") {
    return "bg-warn-tint text-warn-ink border-warn/30";
  }
  return "bg-accent-tint text-accent-ink border-accent/30";
}

export default function StatusOvergangPaneel({ decision, evidence, besluitmomentStappen }: Props) {
  const router = useRouter();
  const [target, setTarget] = useState<DecisionStatus | "">("");
  const [reden, setReden] = useState("");
  const [motivering, setMotivering] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const idBasis = useId();

  const vlgndOpties = useMemo(
    () => VOLGENDE_STATUSSEN[decision.status] ?? [],
    [decision.status]
  );

  const open = useMemo(
    () => openVoorBesluitmomenten(evidence, besluitmomentStappen),
    [evidence, besluitmomentStappen]
  );
  const isBesluit = Boolean(target && BESLUIT_TRANSITIES.includes(target as DecisionStatus));
  const motiveringNodig = isBesluit && heeftOpenBovenOptioneel(open);
  const motiveringOk =
    !motiveringNodig || motivering.trim().length >= MIN_MOTIVERING_LENGTE;

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
      if (motiveringNodig) body.motivering = motivering.trim();
      const res = await fetch(`/api/decisions/${decision.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Statusovergang mislukt");
      }
      setReden("");
      setMotivering("");
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
      <div className="bg-white border border-line rounded-xl p-5">
        <h3 className="text-sm font-semibold text-ink mb-2">Status-overgang</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted font-semibold">
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
        <p className="text-xs text-muted mt-2">
          Geen overgangen meer mogelijk vanuit deze status.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-line rounded-xl p-5">
      <h3 className="text-sm font-semibold text-ink mb-3">Status-overgang</h3>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs uppercase tracking-wide text-muted font-semibold">
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
        <Veldgroep label="Volgende status" htmlFor={`${idBasis}-doel`}>
          <select
            id={`${idBasis}-doel`}
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as DecisionStatus | "");
              setFout(null);
            }}
            className="w-full text-sm border border-app-line-strong rounded-md px-3 py-2 bg-white"
          >
            <option value="">— kies doelstatus —</option>
            {vlgndOpties.map((s) => (
              <option key={s} value={s}>
                {DECISION_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Veldgroep>

        {motiveringNodig && <OpenstaandHint open={open} />}

        <Veldgroep
          label="Reden voor overgang (optioneel)"
          htmlFor={`${idBasis}-reden`}
        >
          <input
            id={`${idBasis}-reden`}
            type="text"
            value={reden}
            onChange={(e) => setReden(e.target.value)}
            className="w-full text-sm border border-app-line-strong rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="Korte aanduiding voor het audit-spoor"
          />
        </Veldgroep>

        {motiveringNodig && (
          <Veldgroep
            label="Motivering (verplicht — besluit met openstaande vereisten)"
            htmlFor={`${idBasis}-motivering`}
          >
            <textarea
              id={`${idBasis}-motivering`}
              value={motivering}
              onChange={(e) => setMotivering(e.target.value)}
              rows={4}
              className="w-full text-sm border border-warn/30 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-warn/40 bg-warn-tint"
              placeholder={
                "Beschrijf twee dingen:\n" +
                "1. Waarom kan dit besluit nu worden genomen zonder wat nog ontbreekt?\n" +
                "2. Wat gebeurt er alsnog met de openstaande vereisten?"
              }
            />
            <p className="text-[11px] text-warn-ink mt-1">
              Minimaal {MIN_MOTIVERING_LENGTE} tekens. Benoem zowel waaróm het besluit
              nu kan als wat er nog met het openstaande gebeurt. Het besluit gaat door;
              wat openstond en jouw motivering worden append-only vastgelegd in het
              dossier — met je rol op dit moment.
            </p>
          </Veldgroep>
        )}

        {fout && (
          <div
            role="alert"
            className="text-xs text-err-ink bg-err-tint border border-err/30 rounded-md px-3 py-2 whitespace-pre-line"
          >
            {fout}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={uitvoeren}
            disabled={!target || bezig || !motiveringOk}
            className="bg-accent text-white text-sm px-4 py-2 rounded-md hover:bg-accent-ink disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bezig ? "Bezig…" : "Overgang doorvoeren"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OpenstaandHint({ open }: { open: OpenPerZwaarte }) {
  const items = [...open.kritiek, ...open.vereist];
  return (
    <div className="text-xs border rounded-md px-3 py-2 bg-warn-tint border-warn/30 text-warn-ink">
      <div className="font-semibold flex items-center gap-1.5">
        <span aria-hidden>⚠</span>
        Openstaande vereisten voor dit besluitmoment
        <span className="font-normal">
          ({open.kritiek.length} kritiek, {open.vereist.length} vereist)
        </span>
      </div>
      {items.length > 0 && (
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          {items.slice(0, 6).map((o, idx) => (
            <li key={idx}>{o.label}</li>
          ))}
          {items.length > 6 && (
            <li className="italic">… plus {items.length - 6} andere</li>
          )}
        </ul>
      )}
    </div>
  );
}

function Veldgroep({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="text-[11px] uppercase tracking-wide text-muted font-semibold block mb-1"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
