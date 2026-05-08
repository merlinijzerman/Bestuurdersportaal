"use client";

// Client-component: dissent-paneel voor het Decision Object.
//
// Toont alleen dissent-notities die de huidige gebruiker mag zien
// (RLS doet primaire filtering, lib/decision.ts:filterDissentOpRol
// is defense-in-depth). Per rij actions afhankelijk van rol:
//   • auteur          : zichtbaarheid wijzigen (excl. minderheidsnotitie),
//                       intrekken
//   • voorzitter/      : alle bovenstaande + opwaarderen naar
//     beheerder         minderheidsnotitie + formeel vastleggen
//
// Vorm bewust sober — dit is governance-context, geen social feed.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  type DissentItem,
  type DissentZichtbaarheid,
  DISSENT_ZICHTBAARHEID_HINT,
  DISSENT_ZICHTBAARHEID_LABEL,
} from "@/lib/decision-view";

interface Props {
  decisionId: string;
  dissents: DissentItem[];
  currentUserId: string | null;
  currentUserIsPrivileged: boolean;
}

const ZICHTBAARHEID_VOOR_BESTUURDER: DissentZichtbaarheid[] = [
  "prive",
  "gedeelde_zorg",
  "formele_dissent",
];
const ZICHTBAARHEID_VOLLEDIG: DissentZichtbaarheid[] = [
  "prive",
  "gedeelde_zorg",
  "formele_dissent",
  "minderheidsnotitie",
];

function zichtbaarheidKleur(z: DissentZichtbaarheid): string {
  switch (z) {
    case "minderheidsnotitie":
      return "bg-purple-50 text-purple-800 border-purple-200";
    case "formele_dissent":
      return "bg-rose-50 text-rose-800 border-rose-200";
    case "gedeelde_zorg":
      return "bg-amber-50 text-amber-800 border-amber-200";
    default:
      return "bg-gray-50 text-gray-700 border-gray-200";
  }
}

export default function DissentPaneel({
  decisionId,
  dissents,
  currentUserId,
  currentUserIsPrivileged,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bezig, setBezig] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [zichtbaarheidEditId, setZichtbaarheidEditId] = useState<string | null>(
    null
  );

  const [standpunt, setStandpunt] = useState("");
  const [argument, setArgument] = useState("");
  const [zichtbaarheid, setZichtbaarheid] = useState<DissentZichtbaarheid>(
    "gedeelde_zorg"
  );

  const opties = currentUserIsPrivileged
    ? ZICHTBAARHEID_VOLLEDIG
    : ZICHTBAARHEID_VOOR_BESTUURDER;

  async function nieuw() {
    if (!standpunt.trim()) {
      setFout("Standpunt is verplicht");
      return;
    }
    setBezig("nieuw");
    setFout(null);
    try {
      const res = await fetch(`/api/decisions/${decisionId}/dissent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          standpunt: standpunt.trim(),
          argument: argument.trim() || null,
          zichtbaarheid,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Vastleggen mislukt");
      setStandpunt("");
      setArgument("");
      setZichtbaarheid("gedeelde_zorg");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBezig(null);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBezig(id);
    setFout(null);
    try {
      const res = await fetch(`/api/decisions/${decisionId}/dissent/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Wijzigen mislukt");
      setZichtbaarheidEditId(null);
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setBezig(null);
    }
  }

  async function intrekken(d: DissentItem) {
    if (
      !confirm(
        `Dissent-notitie intrekken? De inhoud wordt verwijderd; in het audit-spoor blijft alleen het feit dát ze ingetrokken is, door wie en wanneer.`
      )
    ) {
      return;
    }
    setBezig(d.id);
    setFout(null);
    try {
      const res = await fetch(`/api/decisions/${decisionId}/dissent/${d.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Intrekken mislukt");
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
          <h3 className="text-sm font-semibold text-[#0F2744]">Dissent</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Afwijkende standpunten, met expliciete keuze hoe formeel ze in het
            dossier landen.
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
          {open ? "Sluiten" : "+ Nieuwe notitie"}
        </button>
      </div>

      {open && (
        <div className="mb-4 border border-gray-200 rounded-lg p-4 bg-gray-50/50 space-y-3">
          <Veldgroep label="Standpunt *">
            <textarea
              value={standpunt}
              onChange={(e) => setStandpunt(e.target.value)}
              rows={2}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Wat is het afwijkende standpunt? Eén zin volstaat."
            />
          </Veldgroep>
          <Veldgroep label="Argument (optioneel)">
            <textarea
              value={argument}
              onChange={(e) => setArgument(e.target.value)}
              rows={3}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              placeholder="Onderbouwing: welke informatie of overweging weegt zwaarder dan in het hoofdstandpunt?"
            />
          </Veldgroep>
          <Veldgroep label="Zichtbaarheid">
            <div className="space-y-2">
              {opties.map((z) => (
                <label
                  key={z}
                  className={`flex items-start gap-2 cursor-pointer p-2 rounded border ${
                    zichtbaarheid === z
                      ? "border-[#0F2744] bg-white"
                      : "border-gray-200 bg-white hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    checked={zichtbaarheid === z}
                    onChange={() => setZichtbaarheid(z)}
                    className="mt-0.5 text-[#0F2744] focus:ring-[#C9A84C]/40"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">
                      {DISSENT_ZICHTBAARHEID_LABEL[z]}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {DISSENT_ZICHTBAARHEID_HINT[z]}
                    </div>
                  </div>
                </label>
              ))}
            </div>
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
              {bezig === "nieuw" ? "Bezig…" : "Vastleggen"}
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

      {dissents.length === 0 ? (
        <div className="text-sm text-gray-400 italic">
          Nog geen dissent vastgelegd. Een leeg dissent-blok kan ook
          betekenen dat afwijkende standpunten als &lsquo;privé&rsquo;
          zijn vastgelegd door anderen — die zijn voor jou niet
          zichtbaar.
        </div>
      ) : (
        <ul className="space-y-3">
          {dissents.map((d) => {
            const isEigen = d.bestuurder_id === currentUserId;
            const magWijzigen = isEigen || currentUserIsPrivileged;
            return (
              <li
                key={d.id}
                className="border border-gray-200 rounded-lg p-3 bg-white"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 whitespace-pre-line font-medium">
                      {d.standpunt}
                    </div>
                    {d.argument && (
                      <div className="text-xs text-gray-700 mt-1.5 whitespace-pre-line border-l-2 border-gray-200 pl-3">
                        {d.argument}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {zichtbaarheidEditId === d.id ? (
                        <select
                          value={d.zichtbaarheid}
                          onChange={(e) =>
                            patch(d.id, {
                              zichtbaarheid: e.target.value as DissentZichtbaarheid,
                            })
                          }
                          className="text-xs border border-gray-300 rounded px-2 py-0.5 bg-white"
                          disabled={bezig === d.id}
                        >
                          {(currentUserIsPrivileged
                            ? ZICHTBAARHEID_VOLLEDIG
                            : ZICHTBAARHEID_VOOR_BESTUURDER
                          ).map((z) => (
                            <option key={z} value={z}>
                              {DISSENT_ZICHTBAARHEID_LABEL[z]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            magWijzigen && setZichtbaarheidEditId(d.id)
                          }
                          disabled={!magWijzigen}
                          title={
                            magWijzigen
                              ? "Klik om zichtbaarheid te wijzigen"
                              : DISSENT_ZICHTBAARHEID_HINT[d.zichtbaarheid]
                          }
                          className={`text-[11px] font-medium uppercase tracking-wide border px-2 py-0.5 rounded ${zichtbaarheidKleur(
                            d.zichtbaarheid
                          )} ${magWijzigen ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                        >
                          {DISSENT_ZICHTBAARHEID_LABEL[d.zichtbaarheid]}
                        </button>
                      )}
                      {d.formeel_vastgesteld && (
                        <span className="text-[11px] font-medium uppercase tracking-wide text-purple-800 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded">
                          Formeel vastgesteld
                        </span>
                      )}
                      <span className="text-[11px] text-gray-500">
                        {d.bestuurder_naam}
                        {isEigen ? " (jij)" : ""}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 min-w-[100px]">
                    {currentUserIsPrivileged && !d.formeel_vastgesteld && (
                      <button
                        type="button"
                        onClick={() =>
                          patch(d.id, { formeel_vastgesteld: true })
                        }
                        disabled={bezig === d.id}
                        className="text-[11px] text-purple-800 hover:underline disabled:opacity-50"
                      >
                        Formeel vastleggen
                      </button>
                    )}
                    {magWijzigen && (
                      <button
                        type="button"
                        onClick={() => intrekken(d)}
                        disabled={bezig === d.id}
                        className="text-[11px] text-rose-700 hover:underline disabled:opacity-50"
                      >
                        Intrekken
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
