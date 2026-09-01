"use client";

// #192 — vastleggingsformulier voor de objectloze typen (dissent_review,
// mandate_check). Hier hangt geen bestaand stuk onder: wat je vastlegt ís het
// feit, via de koppelroute (atomaire insert in procedure_vaststelling).
//
// Harde tegenstrijdigheidsguard: "Geen dissent" is UITGESCHAKELD zolang er
// openstaande formele dissent-rijen zijn (vereiste.dissent_open > 0). Niet een
// wegklikbare waarschuwing — de optie is dan onkiesbaar, en de route weigert 'm
// bovendien server-side (409).

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EvidenceItem } from "@/core/lib/decision-view";

export default function VaststellingFormulier({
  procedureId,
  vereiste,
  onClose,
}: {
  procedureId: string;
  vereiste: EvidenceItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const isDissent = vereiste.requirement_type === "dissent_review";
  const openDissent = vereiste.dissent_open > 0;

  const opties = isDissent
    ? [
        { value: "Geen dissent", kop: "Geen dissent", sub: "Alle aanwezigen konden zich in het voorstel vinden.", disabled: openDissent },
        { value: "Dissent vastgelegd", kop: "Dissent vastgelegd", sub: "Er is een minderheidsstandpunt of formeel dissent opgenomen.", disabled: false },
      ]
    : [
        { value: "Mandaatcheck geslaagd", kop: "Geslaagd", sub: "Het mandaat is bevestigd; het besluit valt binnen de bevoegdheid.", disabled: false },
        { value: "Mandaatcheck niet geslaagd", kop: "Niet geslaagd", sub: "Er is een mandaatbezwaar; leg toe wat er speelt.", disabled: false },
      ];

  // Default = de eerste niet-uitgeschakelde optie.
  const eersteKiesbaar = opties.find((o) => !o.disabled)?.value ?? opties[0].value;
  const [uitkomst, setUitkomst] = useState(eersteKiesbaar);
  const [toelichting, setToelichting] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  async function vastleggen() {
    if (!toelichting.trim()) {
      setFout("Toelichting is verplicht.");
      return;
    }
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(`/api/procedures/${procedureId}/vereisten/koppel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actie: "koppel",
          vereiste: {
            stap_volgorde: vereiste.stap_volgorde,
            requirement_type: vereiste.requirement_type,
            documenttype: vereiste.documenttype,
            label: vereiste.label,
          },
          uitkomst,
          toelichting: toelichting.trim(),
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setFout(d.error ?? "Vastleggen mislukt");
        setBezig(false);
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setFout("Vastleggen mislukt");
      setBezig(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-6 bg-[rgb(18_35_59/0.38)]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[620px] max-h-[80vh] flex flex-col bg-white border border-line rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-line">
          <h3 className="font-serif text-[17px] font-semibold text-ink">
            {isDissent ? "Leg vast dat de dissentronde is afgerond" : "Leg de mandaatcheck vast"}
          </h3>
          <p className="text-xs text-muted mt-1">
            Hier hangt geen stuk onder. Wat je vastlegt ís het feit — met jouw naam en de
            datum van vandaag.
          </p>
          <span className="mt-2 inline-flex items-center gap-2 bg-accent-tint border border-line rounded-lg px-2.5 py-1 text-xs text-accent-ink font-medium">
            {vereiste.label}
          </span>
        </div>

        <div className="px-5 py-3.5 overflow-auto flex-1">
          {isDissent && openDissent && (
            <div className="mb-3.5 flex gap-2 items-start bg-err-tint border border-err/30 rounded-lg px-3 py-2.5 text-xs text-err-ink">
              <span aria-hidden>⚠</span>
              <span>
                Er {vereiste.dissent_open === 1 ? "staat" : "staan"}{" "}
                <b>
                  {vereiste.dissent_open} formele dissent
                  {vereiste.dissent_open === 1 ? "" : "en"}
                </b>{" "}
                open in dit dossier. &quot;Geen dissent&quot; kan daarom niet worden vastgelegd — dat
                zou het dossier laten tegenspreken.
              </span>
            </div>
          )}
          {fout && (
            <div className="mb-3 text-xs text-err-ink bg-err-tint border border-err/30 rounded-lg px-3 py-2">
              {fout}
            </div>
          )}

          <div className="mb-3.5">
            <label className="block text-xs font-semibold mb-1.5">Uitkomst</label>
            <div className="flex flex-col gap-1.5">
              {opties.map((o) => (
                <label
                  key={o.value}
                  className={`flex gap-2.5 items-start border rounded-lg px-3 py-2.5 ${
                    o.disabled
                      ? "border-line bg-app-zebra border-dashed cursor-not-allowed opacity-70"
                      : "border-line cursor-pointer hover:border-accent hover:bg-accent-tint"
                  }`}
                >
                  <input
                    type="radio"
                    name="uitkomst"
                    value={o.value}
                    checked={uitkomst === o.value}
                    disabled={o.disabled}
                    onChange={() => setUitkomst(o.value)}
                    className="mt-0.5 accent-accent"
                  />
                  <span>
                    <span className="block font-semibold text-[13px] text-ink">{o.kop}</span>
                    <span className="block text-xs text-muted">{o.sub}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="vast-toel" className="block text-xs font-semibold mb-1.5">
              Toelichting
            </label>
            <textarea
              id="vast-toel"
              value={toelichting}
              onChange={(e) => setToelichting(e.target.value)}
              placeholder={isDissent ? "Wat is er besproken, en wie waren erbij?" : "Waarop is de mandaatcheck gebaseerd?"}
              className="w-full min-h-[82px] border border-app-line-control rounded-lg px-3 py-2 text-[13px] resize-y outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-line flex items-center justify-end gap-2 bg-app-zebra">
          <button
            type="button"
            onClick={onClose}
            className="border border-app-line-control rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-accent-tint"
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={vastleggen}
            disabled={bezig}
            className="bg-accent border border-accent rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-ink disabled:opacity-45"
          >
            {bezig ? "Bezig…" : "Vastleggen"}
          </button>
        </div>
      </div>
    </div>
  );
}
