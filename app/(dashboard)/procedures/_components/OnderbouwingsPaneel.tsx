"use client";

// MVP-2A — Onderbouwingspaneel met vijf tabs.
//
// Vervangt de zes uitklapbare blokken (aannames, risico's, voorwaarden,
// acties, dissent + statusovergang) op de procedure-detailpagina door
// één paneel met vijf tabs. Statusovergang blijft een apart blok in
// page.tsx — dit paneel gaat alleen over de inhoudelijke onderbouwing
// van het besluit.
//
// Iconografie volgens ontwerpdoc v0.3 §4.2: vier kleuren, één symbool.
//   ●  groen (emerald)  — geen aandacht nodig
//   ●  oranje (amber)   — aandacht nodig
//   ○  grijs            — leeg
//   ●  rood (rose)      — blokkerend (spaarzaam, alleen echte blokkades)
//
// Geen schema-wijziging. Hergebruikt bestaande blok-componenten als
// tab-content.

import { useState } from "react";
import type {
  Assumption,
  RiskItem,
  DecisionCondition,
  ActionItem,
  DissentItem,
} from "@/lib/decision-view";
import AannamesPaneel from "./AannamesPaneel";
import RisicosPaneel from "./RisicosPaneel";
import VoorwaardenPaneel from "./VoorwaardenPaneel";
import ActiesPaneel from "./ActiesPaneel";
import DissentPaneel from "./DissentPaneel";

type TabId = "aannames" | "risicos" | "voorwaarden" | "acties" | "dissent";
type Indicator = "groen" | "oranje" | "grijs" | "rood";

interface Props {
  decisionId: string;
  assumptions: Assumption[];
  risks: RiskItem[];
  conditions: DecisionCondition[];
  actions: ActionItem[];
  dissents: DissentItem[];
  currentUserId: string;
  currentUserIsPrivileged: boolean;
}

// ----------------------------------------------------------
// Status-bepaling per tab. De logica volgt 1:1 wat eerder in
// page.tsx bij de UitklapbaarPaneel-aanroepen stond, maar nu
// gedistilleerd naar één van vier indicator-waarden.
// ----------------------------------------------------------

function indicatorAannames(items: Assumption[]): Indicator {
  const actief = items.filter((a) => a.status !== "verwijderd");
  if (actief.length === 0) return "grijs";
  const allGevalideerd = actief.every((a) =>
    ["gevalideerd", "gewijzigd"].includes(a.status)
  );
  return allGevalideerd ? "groen" : "oranje";
}

function indicatorRisicos(items: RiskItem[]): Indicator {
  if (items.length === 0) return "oranje"; // bij een procedure zonder risico's: aandacht (eerst vastleggen)
  const heeftBlokkerendeOpenHoog = items.some((r) => {
    if (r.status !== "open") return false;
    const kans = r.kans ?? 0;
    const impact = r.impact ?? 0;
    return kans * impact >= 12;
  });
  if (heeftBlokkerendeOpenHoog) return "oranje";
  return items.every((r) => r.status !== "open") ? "groen" : "oranje";
}

function indicatorVoorwaarden(items: DecisionCondition[]): Indicator {
  if (items.length === 0) return "grijs";
  if (items.some((c) => c.status === "overschreden")) return "rood";
  return items.every((c) => c.status === "vervuld") ? "groen" : "oranje";
}

function indicatorActies(items: ActionItem[]): Indicator {
  if (items.length === 0) return "grijs";
  if (items.some((a) => a.status === "escalatie")) return "rood";
  return items.every((a) => a.status === "afgerond") ? "groen" : "oranje";
}

function indicatorDissent(items: DissentItem[]): Indicator {
  if (items.length === 0) return "grijs";
  // Een formele dissent zonder vastlegging is een blokkade voor
  // doorzetten naar besluitrijp — markeren als rood om expliciet
  // te zijn. Anders aandacht (niet-formele dissent of nog ongezien).
  const heeftOnvastgesteldeFormele = items.some(
    (d) =>
      ["formele_dissent", "minderheidsnotitie"].includes(d.zichtbaarheid) &&
      !d.formeel_vastgesteld
  );
  if (heeftOnvastgesteldeFormele) return "rood";
  return "groen";
}

// ----------------------------------------------------------
// Tab-knop subcomponent
// ----------------------------------------------------------

const INDICATOR_KLASSE: Record<Indicator, string> = {
  groen: "bg-emerald-500",
  oranje: "bg-amber-500",
  grijs: "bg-gray-300",
  rood: "bg-rose-500",
};

const INDICATOR_TITEL: Record<Indicator, string> = {
  groen: "geen aandacht nodig",
  oranje: "aandacht nodig",
  grijs: "leeg",
  rood: "blokkerend",
};

function TabKnop({
  label,
  count,
  indicator,
  active,
  onClick,
}: {
  label: string;
  count: number;
  indicator: Indicator;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`px-4 py-2.5 border-b-2 text-sm font-medium flex items-center gap-1.5 whitespace-nowrap transition ${
        active
          ? "border-[#C9A84C] text-[#0F2744]"
          : "border-transparent text-gray-500 hover:text-[#0F2744] hover:bg-gray-50"
      }`}
    >
      <span>{label}</span>
      <span
        className={`text-[11px] rounded-full px-1.5 font-medium ${
          active
            ? "bg-[#C9A84C]/15 text-[#0F2744]"
            : "bg-gray-100 text-gray-700"
        }`}
      >
        {count}
      </span>
      <span
        aria-hidden
        title={INDICATOR_TITEL[indicator]}
        className={`w-2 h-2 rounded-full ${INDICATOR_KLASSE[indicator]}`}
      />
    </button>
  );
}

// ----------------------------------------------------------
// Hoofd-component
// ----------------------------------------------------------

export default function OnderbouwingsPaneel({
  decisionId,
  assumptions,
  risks,
  conditions,
  actions,
  dissents,
  currentUserId,
  currentUserIsPrivileged,
}: Props) {
  const [actief, setActief] = useState<TabId>("aannames");

  const aantalAannames = assumptions.filter((a) => a.status !== "verwijderd").length;
  const aantalRisicos = risks.length;
  const aantalVoorwaarden = conditions.length;
  const aantalActies = actions.length;
  const aantalDissent = dissents.length;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Paneel-header */}
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#0F2744]">Onderbouwing</h3>
        <span className="text-xs text-gray-500 hidden sm:inline">
          Wat staat er onder dit besluit
        </span>
      </div>

      {/* Tab-balk */}
      <div
        role="tablist"
        className="flex flex-wrap gap-1 px-3 border-b border-gray-200 overflow-x-auto"
      >
        <TabKnop
          label="Aannames"
          count={aantalAannames}
          indicator={indicatorAannames(assumptions)}
          active={actief === "aannames"}
          onClick={() => setActief("aannames")}
        />
        <TabKnop
          label="Risico's"
          count={aantalRisicos}
          indicator={indicatorRisicos(risks)}
          active={actief === "risicos"}
          onClick={() => setActief("risicos")}
        />
        <TabKnop
          label="Voorwaarden"
          count={aantalVoorwaarden}
          indicator={indicatorVoorwaarden(conditions)}
          active={actief === "voorwaarden"}
          onClick={() => setActief("voorwaarden")}
        />
        <TabKnop
          label="Acties"
          count={aantalActies}
          indicator={indicatorActies(actions)}
          active={actief === "acties"}
          onClick={() => setActief("acties")}
        />
        <TabKnop
          label="Dissent"
          count={aantalDissent}
          indicator={indicatorDissent(dissents)}
          active={actief === "dissent"}
          onClick={() => setActief("dissent")}
        />
      </div>

      {/* Tab-content. We laten de bestaande paneel-componenten hun
          eigen styling meebrengen, en strippen alleen hun outer
          rounded/border zodat ze schoon binnen het tab-paneel zitten. */}
      <div className="p-0 [&>*]:!rounded-none [&>*]:!border-0">
        {actief === "aannames" && (
          <AannamesPaneel decisionId={decisionId} assumptions={assumptions} />
        )}
        {actief === "risicos" && (
          <RisicosPaneel decisionId={decisionId} risks={risks} />
        )}
        {actief === "voorwaarden" && (
          <VoorwaardenPaneel
            decisionId={decisionId}
            conditions={conditions}
          />
        )}
        {actief === "acties" && (
          <ActiesPaneel
            decisionId={decisionId}
            actions={actions}
            conditions={conditions}
          />
        )}
        {actief === "dissent" && (
          <DissentPaneel
            decisionId={decisionId}
            dissents={dissents}
            currentUserId={currentUserId}
            currentUserIsPrivileged={currentUserIsPrivileged}
          />
        )}
      </div>
    </div>
  );
}
