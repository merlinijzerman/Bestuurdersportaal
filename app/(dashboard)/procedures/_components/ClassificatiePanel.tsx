"use client";

// Client-component: classificatie-panel met edit-mode voor de zes
// dimensies. Roept PATCH /api/decisions/[id] aan en doet vervolgens
// router.refresh() zodat de page-server-component opnieuw rendert.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  type Complexiteit,
  type DecisionObject,
  type Risiconiveau,
  COMPLEXITEIT_LABEL,
  RISICONIVEAU_LABEL,
} from "@/lib/decision-view";

interface Props {
  decision: DecisionObject;
}

const COMPLEXITEIT: Complexiteit[] = ["routine", "complicated", "complex"];
const RISICONIVEAU: Risiconiveau[] = ["laag", "middel", "hoog"];

export default function ClassificatiePanel({ decision }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const [complexiteit, setComplexiteit] = useState<Complexiteit>(
    decision.complexiteit
  );
  const [risiconiveau, setRisiconiveau] = useState<Risiconiveau>(
    decision.risiconiveau
  );
  const [mandaat, setMandaat] = useState(decision.mandaatgevoelig);
  const [toezicht, setToezicht] = useState(decision.toezichtgevoelig);
  const [afwijking, setAfwijking] = useState(decision.beleidsafwijking);
  const [aiRisico, setAiRisico] = useState<Risiconiveau>(decision.ai_risicoklasse);
  const [besluitvraag, setBesluitvraag] = useState(
    decision.besluitvraag.startsWith("Aanvullen na auto-upgrade")
      ? ""
      : decision.besluitvraag
  );
  const [scope, setScope] = useState(decision.scope ?? "");

  async function bewaar() {
    setBezig(true);
    setFout(null);
    try {
      const body: Record<string, unknown> = {
        complexiteit,
        risiconiveau,
        mandaatgevoelig: mandaat,
        toezichtgevoelig: toezicht,
        beleidsafwijking: afwijking,
        ai_risicoklasse: aiRisico,
        classificatie_bevestigd: true,
      };
      if (besluitvraag.trim()) body.besluitvraag = besluitvraag.trim();
      if (scope.trim() !== (decision.scope ?? "")) body.scope = scope.trim() || null;

      const res = await fetch(`/api/decisions/${decision.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Bewaren mislukt");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#0F2744]">
          Classificatie & besluitvraag
        </h3>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs text-[#0F2744] hover:underline"
        >
          {open ? "Sluiten" : "Bewerken"}
        </button>
      </div>

      {!open ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <Veld label="Complexiteit" waarde={COMPLEXITEIT_LABEL[decision.complexiteit]} />
          <Veld label="Risiconiveau" waarde={RISICONIVEAU_LABEL[decision.risiconiveau]} />
          <Veld
            label="Mandaatgevoelig"
            waarde={decision.mandaatgevoelig ? "Ja" : "Nee"}
          />
          <Veld
            label="Toezichtgevoelig"
            waarde={decision.toezichtgevoelig ? "Ja" : "Nee"}
          />
          <Veld
            label="Beleidsafwijking"
            waarde={decision.beleidsafwijking ? "Ja" : "Nee"}
          />
          <Veld
            label="AI-risicoklasse"
            waarde={RISICONIVEAU_LABEL[decision.ai_risicoklasse]}
          />
          <div className="col-span-2 md:col-span-3 mt-2 pt-3 border-t border-gray-100 space-y-2">
            <Veld
              label="Besluitvraag"
              waarde={
                decision.besluitvraag.startsWith("Aanvullen")
                  ? "Nog niet ingevuld"
                  : decision.besluitvraag
              }
              vol
            />
            <Veld label="Scope" waarde={decision.scope ?? "—"} vol />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Veldgroep label="Besluitvraag *">
            <textarea
              value={besluitvraag}
              onChange={(e) => setBesluitvraag(e.target.value)}
              rows={3}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Wat is de centrale vraag waarover een besluit moet worden genomen?"
            />
          </Veldgroep>
          <Veldgroep label="Scope">
            <textarea
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Welke deelnemers, welke beleggingscategorie, welke periode raakt dit besluit?"
            />
          </Veldgroep>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
            <Veldgroep label="Complexiteit">
              <SegmentRadio<Complexiteit>
                opties={COMPLEXITEIT}
                waarde={complexiteit}
                opWijzig={setComplexiteit}
                label={COMPLEXITEIT_LABEL}
              />
            </Veldgroep>
            <Veldgroep label="Risiconiveau">
              <SegmentRadio<Risiconiveau>
                opties={RISICONIVEAU}
                waarde={risiconiveau}
                opWijzig={setRisiconiveau}
                label={RISICONIVEAU_LABEL}
              />
            </Veldgroep>
            <Veldgroep label="AI-risicoklasse">
              <SegmentRadio<Risiconiveau>
                opties={RISICONIVEAU}
                waarde={aiRisico}
                opWijzig={setAiRisico}
                label={RISICONIVEAU_LABEL}
              />
            </Veldgroep>
            <div className="space-y-2">
              <Checkbox
                label="Mandaatgevoelig"
                checked={mandaat}
                onChange={setMandaat}
              />
              <Checkbox
                label="Toezichtgevoelig"
                checked={toezicht}
                onChange={setToezicht}
              />
              <Checkbox
                label="Beleidsafwijking"
                checked={afwijking}
                onChange={setAfwijking}
              />
            </div>
          </div>

          {fout && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {fout}
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={bewaar}
              disabled={bezig}
              className="bg-[#0F2744] text-white text-sm px-4 py-2 rounded-md hover:bg-[#1a3a5e] disabled:opacity-50"
            >
              {bezig ? "Bezig…" : "Bewaren"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-gray-600 hover:text-gray-900 px-3 py-2"
            >
              Annuleer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Veld({
  label,
  waarde,
  vol,
}: {
  label: string;
  waarde: string;
  vol?: boolean;
}) {
  return (
    <div className={vol ? "col-span-full" : ""}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
        {label}
      </div>
      <div className="text-sm text-gray-900 mt-0.5 whitespace-pre-line">
        {waarde}
      </div>
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

function SegmentRadio<T extends string>({
  opties,
  waarde,
  opWijzig,
  label,
}: {
  opties: readonly T[];
  waarde: T;
  opWijzig: (v: T) => void;
  label: Record<T, string>;
}) {
  return (
    <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
      {opties.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => opWijzig(o)}
          className={`text-sm px-3 py-1.5 ${
            o === waarde
              ? "bg-[#0F2744] text-white"
              : "bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          {label[o]}
        </button>
      ))}
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-gray-300 text-[#0F2744] focus:ring-[#C9A84C]/40"
      />
      <span className="text-gray-900">{label}</span>
    </label>
  );
}
