"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  Stap,
  ChecklistItem,
  Bewijs,
  Besluit,
  KomendeVergadering,
  GekoppeldAgendapunt,
} from "../[id]/page";

interface Props {
  procedureId: string;
  stap: Stap;
  checklist: ChecklistItem[];
  bewijs: Bewijs[];
  besluit: Besluit | null;
  komendeVergaderingen: KomendeVergadering[];
  gekoppeldeAgendapunten: GekoppeldAgendapunt[];
}

function formatDatumKort(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ActieveStapPaneel({
  procedureId,
  stap,
  checklist: initieelChecklist,
  bewijs: initieelBewijs,
  besluit,
  komendeVergaderingen,
  gekoppeldeAgendapunten,
}: Props) {
  const router = useRouter();
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initieelChecklist);
  const [bewijs, setBewijs] = useState<Bewijs[]>(initieelBewijs);
  const [bewijsForm, setBewijsForm] = useState(false);
  const [bewijsTitel, setBewijsTitel] = useState("");
  const [bewijsBeschrijving, setBewijsBeschrijving] = useState("");
  const [besluitForm, setBesluitForm] = useState(false);
  const [besluitFormulering, setBesluitFormulering] = useState("");
  const [besluitMotivering, setBesluitMotivering] = useState("");
  const [besluitDatum, setBesluitDatum] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [vergaderingForm, setVergaderingForm] = useState(false);
  const [vergaderingKeuze, setVergaderingKeuze] = useState<string>("");
  const [conceptHint, setConceptHint] = useState<string | null>(null);
  const [bezig, setBezig] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const voldaanCount = checklist.filter((c) => c.voldaan).length;
  const totaalCount = checklist.length;
  const allesVoldaan = totaalCount > 0 && voldaanCount === totaalCount;
  const bewijsVereist = checklist.filter((c) => c.bewijs_vereist).length;
  const heeftBewijs = bewijs.length > 0;
  const kanVoltooien =
    allesVoldaan &&
    (bewijsVereist === 0 || heeftBewijs) &&
    (!stap.vereist_besluit || besluit !== null);

  async function checklistToggle(item: ChecklistItem) {
    setFout(null);
    const nieuw = !item.voldaan;
    // Optimistic
    setChecklist((huidig) =>
      huidig.map((c) =>
        c.id === item.id
          ? {
              ...c,
              voldaan: nieuw,
              voldaan_op: nieuw ? new Date().toISOString() : null,
            }
          : c
      )
    );
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/checklist/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voldaan: nieuw }),
        }
      );
      if (!res.ok) throw new Error("Wijzigen mislukt");
      router.refresh();
    } catch {
      // Rollback
      setChecklist((huidig) =>
        huidig.map((c) => (c.id === item.id ? item : c))
      );
      setFout("Kon checklist-item niet bijwerken.");
    }
  }

  async function bewijsToevoegen(e: React.FormEvent) {
    e.preventDefault();
    setFout(null);
    const titel = bewijsTitel.trim();
    if (!titel) {
      setFout("Titel is verplicht.");
      return;
    }
    setBezig("bewijs");
    try {
      const res = await fetch(`/api/procedures/${procedureId}/bewijs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stap_id: stap.id,
          titel,
          beschrijving: bewijsBeschrijving.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Toevoegen mislukt");
      }
      const data = await res.json();
      setBewijs([data.bewijs as Bewijs, ...bewijs]);
      setBewijsTitel("");
      setBewijsBeschrijving("");
      setBewijsForm(false);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Toevoegen mislukt");
    } finally {
      setBezig(null);
    }
  }

  async function besluitVastleggen(e: React.FormEvent) {
    e.preventDefault();
    setFout(null);
    const formulering = besluitFormulering.trim();
    if (!formulering) {
      setFout("Formulering is verplicht.");
      return;
    }
    setBezig("besluit");
    try {
      const res = await fetch(`/api/procedures/${procedureId}/besluiten`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stap_id: stap.id,
          formulering,
          motivering: besluitMotivering.trim() || null,
          datum: besluitDatum,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Vastleggen mislukt");
      }
      setBesluitForm(false);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Vastleggen mislukt");
    } finally {
      setBezig(null);
    }
  }

  async function vergaderingKoppelen(e: React.FormEvent) {
    e.preventDefault();
    setFout(null);
    if (!vergaderingKeuze) {
      setFout("Kies een vergadering.");
      return;
    }
    setBezig("vergadering");
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/stappen/${stap.id}/agendapunt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vergadering_id: vergaderingKeuze }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Koppelen mislukt");
      }
      setVergaderingKeuze("");
      setVergaderingForm(false);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Koppelen mislukt");
    } finally {
      setBezig(null);
    }
  }

  async function besluitConceptOphalen() {
    setFout(null);
    setConceptHint(null);
    setBezig("concept");
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/stappen/${stap.id}/besluit-concept`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Concept ophalen mislukt");
      }
      const data = (await res.json()) as {
        formulering: string;
        motivering: string;
        onvoldoende_context: boolean;
      };
      if (data.onvoldoende_context) {
        setConceptHint(
          "De AI vond te weinig context om een gefundeerd concept op te stellen — vul eerst de checklist en bewijsstukken aan."
        );
      } else {
        setBesluitForm(true);
        setBesluitFormulering(data.formulering);
        setBesluitMotivering(data.motivering);
        setConceptHint(
          "AI-concept ingevuld — review en pas aan voor je vastlegt."
        );
      }
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Concept ophalen mislukt");
    } finally {
      setBezig(null);
    }
  }

  async function stapVoltooien() {
    setFout(null);
    setBezig("voltooien");
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/stappen/${stap.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "afgerond" }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Voltooien mislukt");
      }
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Voltooien mislukt");
    } finally {
      setBezig(null);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-amber-700 font-semibold">
            Actieve stap
          </div>
          <h2 className="text-lg font-semibold text-[#0F2744] mt-1">
            {stap.volgorde} — {stap.naam}
          </h2>
          {stap.beschrijving && (
            <p className="text-sm text-gray-600 mt-1.5">{stap.beschrijving}</p>
          )}
        </div>
        <div className="text-right text-xs text-gray-500 flex-shrink-0">
          {stap.deadline && (
            <div className="text-amber-700 font-medium">
              Deadline {formatDatumKort(stap.deadline)}
            </div>
          )}
          {stap.eigenaar_naam && <div className="mt-1">{stap.eigenaar_naam}</div>}
        </div>
      </div>

      {/* Checklist */}
      <div className="mt-6">
        <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">
          Checklist
        </div>
        {checklist.length === 0 ? (
          <div className="text-sm text-gray-400 italic">
            Geen checklist-items.
          </div>
        ) : (
          <div className="space-y-2">
            {checklist.map((c) => (
              <label
                key={c.id}
                className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer ${
                  c.voldaan
                    ? "bg-gray-50"
                    : "bg-white border border-gray-200 hover:border-[#C9A84C]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={c.voldaan}
                  onChange={() => checklistToggle(c)}
                  className="mt-0.5 accent-[#C9A84C] w-4 h-4 rounded"
                />
                <div className="flex-1">
                  <div
                    className={`text-sm ${
                      c.voldaan ? "text-gray-500 line-through" : "text-gray-900"
                    }`}
                  >
                    {c.label}
                  </div>
                  {c.voldaan && c.voldaan_op && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      Afgevinkt {formatDatumKort(c.voldaan_op)}
                      {c.voldaan_door_naam ? ` · ${c.voldaan_door_naam}` : ""}
                    </div>
                  )}
                </div>
                {c.bewijs_vereist && !c.voldaan && (
                  <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-medium">
                    Bewijs vereist
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Vergaderingen */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Vergaderingen
          </div>
          {!vergaderingForm && komendeVergaderingen.length > 0 && (
            <button
              onClick={() => setVergaderingForm(true)}
              className="text-xs text-[#0F2744] hover:underline"
            >
              + Voeg toe aan vergadering
            </button>
          )}
        </div>

        {gekoppeldeAgendapunten.length === 0 && !vergaderingForm && (
          <div className="text-sm text-gray-400 italic">
            Deze stap staat (nog) niet op een vergader-agenda.
          </div>
        )}

        {gekoppeldeAgendapunten.length > 0 && (
          <div className="space-y-2 mb-3">
            {gekoppeldeAgendapunten.map((a) => (
              <Link
                key={a.id}
                href={`/vergaderingen/${a.vergadering_id}`}
                className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-[#C9A84C]"
              >
                <div className="w-9 h-10 bg-blue-50 text-blue-700 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                  AGENDA
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {a.titel}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {a.vergadering_titel}
                    {a.vergadering_datum
                      ? ` · ${formatDatumKort(a.vergadering_datum)}`
                      : ""}
                  </div>
                </div>
                <span className="text-xs text-[#0F2744] hover:underline">
                  Open →
                </span>
              </Link>
            ))}
          </div>
        )}

        {vergaderingForm && (
          <form
            onSubmit={vergaderingKoppelen}
            className="p-3 border border-gray-200 rounded-lg bg-gray-50 space-y-2"
          >
            <select
              value={vergaderingKeuze}
              onChange={(e) => setVergaderingKeuze(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:border-[#C9A84C] outline-none bg-white"
            >
              <option value="">— Kies een komende vergadering —</option>
              {komendeVergaderingen.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.titel} — {formatDatumKort(v.datum)}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500">
              Er wordt automatisch een agendapunt aangemaakt met de stap-titel
              als onderwerp en categorie {stap.vereist_besluit ? "Besluitvorming" : "Oordeelsvorming"}.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setVergaderingForm(false);
                  setVergaderingKeuze("");
                }}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:border-[#0F2744]"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={bezig === "vergadering"}
                className="text-xs px-3 py-1.5 bg-[#0F2744] text-white rounded hover:bg-[#1a3858] disabled:opacity-50"
              >
                {bezig === "vergadering" ? "Bezig…" : "Koppelen"}
              </button>
            </div>
          </form>
        )}

        {komendeVergaderingen.length === 0 && (
          <p className="text-xs text-gray-500 mt-1">
            Geen komende vergaderingen om aan te koppelen.{" "}
            <Link href="/vergaderingen" className="text-[#0F2744] underline">
              Plan eerst een vergadering →
            </Link>
          </p>
        )}
      </div>

      {/* Bewijs */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Bewijsstukken
          </div>
          <button
            onClick={() => setBewijsForm(!bewijsForm)}
            className="text-xs text-[#0F2744] hover:underline"
          >
            {bewijsForm ? "Annuleren" : "+ Toevoegen"}
          </button>
        </div>

        {bewijsForm && (
          <form
            onSubmit={bewijsToevoegen}
            className="mb-3 p-3 border border-gray-200 rounded-lg bg-gray-50 space-y-2"
          >
            <input
              type="text"
              value={bewijsTitel}
              onChange={(e) => setBewijsTitel(e.target.value)}
              placeholder="Titel of bestandsnaam"
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:border-[#C9A84C] outline-none"
            />
            <textarea
              rows={2}
              value={bewijsBeschrijving}
              onChange={(e) => setBewijsBeschrijving(e.target.value)}
              placeholder="Korte beschrijving (optioneel)"
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:border-[#C9A84C] outline-none resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBewijsForm(false)}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:border-[#0F2744]"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={bezig === "bewijs"}
                className="text-xs px-3 py-1.5 bg-[#0F2744] text-white rounded hover:bg-[#1a3858] disabled:opacity-50"
              >
                {bezig === "bewijs" ? "Bezig…" : "Toevoegen"}
              </button>
            </div>
          </form>
        )}

        {bewijs.length === 0 ? (
          <div className="text-sm text-gray-400 italic">
            Nog geen bewijsstukken bij deze stap.
          </div>
        ) : (
          <div className="space-y-2">
            {bewijs.map((b) => (
              <div
                key={b.id}
                className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg"
              >
                <div className="w-9 h-10 bg-red-50 text-red-700 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                  PDF
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {b.titel}
                  </div>
                  {b.beschrijving && (
                    <div className="text-xs text-gray-600 mt-0.5 whitespace-pre-line">
                      {b.beschrijving}
                    </div>
                  )}
                  <div className="text-xs text-gray-500 mt-1">
                    {b.toegevoegd_door_naam
                      ? `Toegevoegd door ${b.toegevoegd_door_naam}`
                      : "Toegevoegd"}{" "}
                    · {formatDatumKort(b.toegevoegd_op)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Besluit (alleen op stappen die dat vereisen) */}
      {stap.vereist_besluit && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
              Besluit
            </div>
            {!besluit && (
              <div className="flex items-center gap-3">
                <button
                  onClick={besluitConceptOphalen}
                  disabled={bezig === "concept"}
                  className="text-xs text-[#C9A84C] hover:underline disabled:opacity-50 inline-flex items-center gap-1"
                  title="Laat Claude een conceptformulering opstellen op basis van bewijs en eerdere stappen"
                >
                  {bezig === "concept" ? "Concept aan het schrijven…" : "↗ Concept met AI"}
                </button>
                {!besluitForm && (
                  <button
                    onClick={() => setBesluitForm(true)}
                    className="text-xs text-[#0F2744] hover:underline"
                  >
                    + Besluit vastleggen
                  </button>
                )}
              </div>
            )}
          </div>
          {conceptHint && (
            <div className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {conceptHint}
            </div>
          )}
          {besluit ? (
            <div className="border border-emerald-200 bg-emerald-50/30 rounded-lg p-3">
              <div className="text-sm text-gray-900 font-medium">
                {besluit.formulering}
              </div>
              {besluit.motivering && (
                <p className="text-xs text-gray-600 mt-1 whitespace-pre-line">
                  {besluit.motivering}
                </p>
              )}
              <div className="text-xs text-gray-500 mt-2">
                {new Date(besluit.datum).toLocaleDateString("nl-NL", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                {besluit.vastgelegd_door_naam
                  ? ` · ${besluit.vastgelegd_door_naam}`
                  : ""}
              </div>
            </div>
          ) : besluitForm ? (
            <form
              onSubmit={besluitVastleggen}
              className="p-3 border border-gray-200 rounded-lg bg-gray-50 space-y-2"
            >
              <textarea
                rows={2}
                value={besluitFormulering}
                onChange={(e) => setBesluitFormulering(e.target.value)}
                placeholder="Bv.: Akkoord met verhoging hedge-ratio naar 70%, conform voorstel."
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:border-[#C9A84C] outline-none resize-none"
              />
              <textarea
                rows={3}
                value={besluitMotivering}
                onChange={(e) => setBesluitMotivering(e.target.value)}
                placeholder="Motivering (optioneel)"
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:border-[#C9A84C] outline-none resize-none"
              />
              <input
                type="date"
                value={besluitDatum}
                onChange={(e) => setBesluitDatum(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1.5 text-sm focus:border-[#C9A84C] outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBesluitForm(false)}
                  className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:border-[#0F2744]"
                >
                  Annuleren
                </button>
                <button
                  type="submit"
                  disabled={bezig === "besluit"}
                  className="text-xs px-3 py-1.5 bg-[#0F2744] text-white rounded hover:bg-[#1a3858] disabled:opacity-50"
                >
                  {bezig === "besluit" ? "Bezig…" : "Vastleggen"}
                </button>
              </div>
            </form>
          ) : (
            <div className="text-sm text-gray-400 italic">
              Deze stap vereist een formeel besluit.
            </div>
          )}
        </div>
      )}

      {fout && (
        <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {fout}
        </div>
      )}

      {/* Voltooien */}
      <div className="mt-6 pt-5 border-t border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-gray-500">
          {voldaanCount} van {totaalCount} checklist-items voldaan
          {bewijsVereist > 0 && !heeftBewijs && " · Bewijsstukken vereist"}
          {stap.vereist_besluit && !besluit && " · Besluit nog niet vastgelegd"}
        </div>
        <button
          onClick={stapVoltooien}
          disabled={!kanVoltooien || bezig === "voltooien"}
          className={`px-4 py-2 text-sm rounded-lg font-medium ${
            kanVoltooien
              ? "bg-[#0F2744] text-white hover:bg-[#1a3858]"
              : "bg-gray-200 text-gray-500 cursor-not-allowed"
          }`}
          title={
            !kanVoltooien
              ? "Voltooi eerst checklist, bewijs en besluit"
              : undefined
          }
        >
          {bezig === "voltooien" ? "Bezig…" : "Stap voltooien"}
        </button>
      </div>
    </div>
  );
}
