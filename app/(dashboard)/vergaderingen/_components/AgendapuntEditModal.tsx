"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TOEGESTANE_CATEGORIEEN: { code: Categorie; label: string }[] = [
  { code: "beeldvorming", label: "Beeldvorming" },
  { code: "oordeelsvorming", label: "Oordeelsvorming" },
  { code: "besluitvorming", label: "Besluitvorming" },
  { code: "informatie", label: "Informatie" },
];

type Categorie = "beeldvorming" | "oordeelsvorming" | "besluitvorming" | "informatie";

const MOTIVERING_MIN = 10;

export interface KomendeVergadering {
  id: string;
  titel: string;
  datum: string;
}

export interface AgendapuntEditData {
  id: string;
  vergadering_id: string;
  titel: string;
  beschrijving: string | null;
  categorie: Categorie;
  tijdsduur_minuten: number | null;
  verantwoordelijke: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  punt: AgendapuntEditData;
  aantalBijdragers: number; // som van inbreng + voorbereidingen
  komendeVergaderingen: KomendeVergadering[]; // exclusief huidige
}

export default function AgendapuntEditModal({
  open,
  onClose,
  punt,
  aantalBijdragers,
  komendeVergaderingen,
}: Props) {
  const router = useRouter();

  // Edit-state
  const [titel, setTitel] = useState(punt.titel);
  const [beschrijving, setBeschrijving] = useState(punt.beschrijving ?? "");
  const [categorie, setCategorie] = useState<Categorie>(punt.categorie);
  const [tijdsduur, setTijdsduur] = useState<string>(
    punt.tijdsduur_minuten?.toString() ?? ""
  );
  const [verantwoordelijke, setVerantwoordelijke] = useState(
    punt.verantwoordelijke ?? ""
  );
  const [vergaderingId, setVergaderingId] = useState(punt.vergadering_id);
  const [motivering, setMotivering] = useState("");

  // Delete-state
  const [toonVerwijderen, setToonVerwijderen] = useState(false);
  const [verwijderReden, setVerwijderReden] = useState("");

  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  if (!open) return null;

  // Detect wijzigingen vs originele waarden
  const huidigeTitel = titel.trim();
  const huidigeBeschr = beschrijving.trim() || null;
  const huidigeTijd = tijdsduur === "" ? null : Number(tijdsduur);
  const huidigeVerant = verantwoordelijke.trim() || null;

  const heeftWijziging =
    huidigeTitel !== punt.titel ||
    huidigeBeschr !== (punt.beschrijving ?? null) ||
    categorie !== punt.categorie ||
    huidigeTijd !== punt.tijdsduur_minuten ||
    huidigeVerant !== (punt.verantwoordelijke ?? null) ||
    vergaderingId !== punt.vergadering_id;

  const motiveringVereist = aantalBijdragers > 0;
  const motiveringOk = !motiveringVereist || motivering.trim().length >= MOTIVERING_MIN;

  async function opslaan() {
    if (!heeftWijziging || bezig) return;
    if (!huidigeTitel) {
      setFout("Titel mag niet leeg zijn");
      return;
    }
    setFout(null);
    setBezig(true);
    try {
      const body: Record<string, unknown> = {};
      if (huidigeTitel !== punt.titel) body.titel = huidigeTitel;
      if (huidigeBeschr !== (punt.beschrijving ?? null)) body.beschrijving = huidigeBeschr;
      if (categorie !== punt.categorie) body.categorie = categorie;
      if (huidigeTijd !== punt.tijdsduur_minuten) body.tijdsduur_minuten = huidigeTijd;
      if (huidigeVerant !== (punt.verantwoordelijke ?? null)) body.verantwoordelijke = huidigeVerant;
      if (vergaderingId !== punt.vergadering_id) body.vergadering_id = vergaderingId;
      if (motiveringVereist) body.motivering = motivering.trim();

      const res = await fetch(`/api/agendapunten/${punt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Wijzigen mislukt");
      }
      onClose();
      router.refresh();
    } catch (e: unknown) {
      setFout(e instanceof Error ? e.message : "Wijzigen mislukt");
    } finally {
      setBezig(false);
    }
  }

  async function verwijderen() {
    if (bezig) return;
    if (verwijderReden.trim().length < MOTIVERING_MIN) {
      setFout(`Reden verplicht (minimaal ${MOTIVERING_MIN} tekens)`);
      return;
    }
    setFout(null);
    setBezig(true);
    try {
      const res = await fetch(`/api/agendapunten/${punt.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reden: verwijderReden.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Verwijderen mislukt");
      }
      onClose();
      router.refresh();
    } catch (e: unknown) {
      setFout(e instanceof Error ? e.message : "Verwijderen mislukt");
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-4 my-8">
        {!toonVerwijderen ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[#0F2744]">
                  Agendapunt bewerken
                </div>
                {aantalBijdragers > 0 && (
                  <div className="text-[11px] text-amber-700 mt-0.5">
                    Let op: er staan al {aantalBijdragers}{" "}
                    {aantalBijdragers === 1 ? "bijdrage" : "bijdragen"} op dit punt.
                    Een motivering is verplicht — bijdragers ontvangen een notificatie.
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 text-sm hover:text-[#0F2744]"
                aria-label="Sluiten"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <Veld label="Titel">
                <input
                  type="text"
                  value={titel}
                  onChange={(e) => setTitel(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-[#C9A84C] outline-none"
                />
              </Veld>

              <Veld label="Beschrijving">
                <textarea
                  rows={3}
                  value={beschrijving}
                  onChange={(e) => setBeschrijving(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-[#C9A84C] outline-none resize-none"
                />
              </Veld>

              <div className="grid grid-cols-2 gap-3">
                <Veld label="Categorie">
                  <select
                    value={categorie}
                    onChange={(e) => setCategorie(e.target.value as Categorie)}
                    className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-[#C9A84C] outline-none bg-white"
                  >
                    {TOEGESTANE_CATEGORIEEN.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Veld>

                <Veld label="Tijd (min)">
                  <input
                    type="number"
                    min={0}
                    value={tijdsduur}
                    onChange={(e) => setTijdsduur(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-[#C9A84C] outline-none"
                  />
                </Veld>
              </div>

              <Veld label="Verantwoordelijke">
                <input
                  type="text"
                  value={verantwoordelijke}
                  onChange={(e) => setVerantwoordelijke(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-[#C9A84C] outline-none"
                />
              </Veld>

              <Veld
                label={`Verplaatsen naar andere vergadering${
                  komendeVergaderingen.length === 0 ? " (geen komende beschikbaar)" : ""
                }`}
              >
                <select
                  value={vergaderingId}
                  onChange={(e) => setVergaderingId(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-[#C9A84C] outline-none bg-white"
                  disabled={komendeVergaderingen.length === 0}
                >
                  <option value={punt.vergadering_id}>— huidige vergadering —</option>
                  {komendeVergaderingen.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.titel} ({new Date(v.datum).toLocaleDateString("nl-NL")})
                    </option>
                  ))}
                </select>
              </Veld>

              {motiveringVereist && (
                <Veld
                  label={`Motivering (verplicht, minimaal ${MOTIVERING_MIN} tekens)`}
                >
                  <textarea
                    rows={2}
                    value={motivering}
                    onChange={(e) => setMotivering(e.target.value)}
                    placeholder="Waarom past u dit punt aan?"
                    className={`w-full text-sm border rounded px-3 py-2 focus:border-[#C9A84C] outline-none resize-none ${
                      motivering.length > 0 && motivering.length < MOTIVERING_MIN
                        ? "border-amber-300 bg-amber-50/50"
                        : "border-gray-200"
                    }`}
                  />
                  <div className="text-[11px] text-gray-500 mt-1">
                    {motivering.trim().length}/{MOTIVERING_MIN} tekens
                  </div>
                </Veld>
              )}

              {fout && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {fout}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
              <button
                onClick={() => {
                  setFout(null);
                  setToonVerwijderen(true);
                }}
                className="text-xs text-red-600 hover:text-red-800 font-medium"
              >
                Verwijderen…
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="text-xs text-gray-600 hover:text-[#0F2744] px-3 py-1.5"
                >
                  Annuleren
                </button>
                <button
                  onClick={opslaan}
                  disabled={!heeftWijziging || !motiveringOk || bezig}
                  className="bg-[#0F2744] text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-[#1a3858] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {bezig ? "Opslaan…" : "Opslaan"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold text-red-700">
                Agendapunt verwijderen
              </div>
              <button
                onClick={() => {
                  setToonVerwijderen(false);
                  setFout(null);
                }}
                className="text-gray-400 text-sm hover:text-[#0F2744]"
                aria-label="Terug"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-700 leading-relaxed">
              U gaat dit agendapunt verwijderen.{" "}
              {aantalBijdragers > 0
                ? `Er staan ${aantalBijdragers} ${
                    aantalBijdragers === 1 ? "bijdrage" : "bijdragen"
                  } op dit punt — die blijven bewaard maar zijn niet meer zichtbaar in de agenda. Bijdragers ontvangen een notificatie. `
                : ""}
              Verwijderen kan worden teruggedraaid door voorzitter of beheerder.
            </p>

            <Veld label={`Reden (verplicht, minimaal ${MOTIVERING_MIN} tekens)`}>
              <textarea
                rows={3}
                value={verwijderReden}
                onChange={(e) => setVerwijderReden(e.target.value)}
                placeholder="Waarom wordt dit punt verwijderd?"
                className={`w-full text-sm border rounded px-3 py-2 focus:border-[#C9A84C] outline-none resize-none ${
                  verwijderReden.length > 0 && verwijderReden.length < MOTIVERING_MIN
                    ? "border-amber-300 bg-amber-50/50"
                    : "border-gray-200"
                }`}
              />
              <div className="text-[11px] text-gray-500 mt-1">
                {verwijderReden.trim().length}/{MOTIVERING_MIN} tekens
              </div>
            </Veld>

            {fout && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {fout}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setToonVerwijderen(false);
                  setFout(null);
                }}
                className="text-xs text-gray-600 hover:text-[#0F2744] px-3 py-1.5"
              >
                Annuleren
              </button>
              <button
                onClick={verwijderen}
                disabled={verwijderReden.trim().length < MOTIVERING_MIN || bezig}
                className="bg-red-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {bezig ? "Verwijderen…" : "Definitief verwijderen"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Veld({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
