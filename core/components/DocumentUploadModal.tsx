"use client";
// ============================================================================
//  core/components/DocumentUploadModal.tsx
// ----------------------------------------------------------------------------
//  Eén herbruikbare uploadmodal MET volledig metadatapalet (titel, bron,
//  documenttype, documentdatum, status + reden, bronstatus, rapportage-retire).
//  Geëxtraheerd uit de bibliotheekpagina (besluit 0140) zodat proces en
//  vergadering exact dezelfde metadata-invoer krijgen als de bibliotheek — de
//  bibliotheek was de "juiste" plek omdat je daar metadata kon vullen.
//
//  Contextueel gedrag:
//   * agendapuntId gezet -> het nieuwe stuk wordt PRIMAIR aan dat agendapunt
//     gekoppeld (server leidt vergadering_id + context='vergadering' af). Dit is
//     een NIEUW vergaderstuk, geen koppeling van een bestaand document.
//   * retireKandidaten meegegeven -> de rapportage-retire-picker verschijnt bij
//     een nieuwe, actuele rapportage. Weglaten (bv. proces/vergadering) = geen
//     retire-UI.
//
//  De server-route /api/documents/upload blijft in alle gevallen leidend
//  (capabilities, validatie, contextafleiding). Deze component levert alleen de
//  invoer aan via de gedeelde client-helper uploadDocument.
// ============================================================================

import { useRef, useState } from "react";
import {
  uploadDocument,
  type UploadResultaat,
} from "@/core/lib/document-upload-client";
import {
  DOCUMENTTYPEN,
  DOCUMENTTYPE_LABEL,
  type Documenttype,
} from "@/core/lib/document-metadata";
import {
  magVanKracht,
  statusLabelVoorType,
} from "@/core/lib/document-statusprofiel";
import { INGEST_BRONSTATUSSEN } from "@/core/lib/document-ingest-classificatie";
import { BRONSTATUS_LABEL } from "@/core/lib/document-status-transities";

// Volgorde in het uploadformulier — een tenant-upload is per definitie een
// fondsdocument, dus Intern staat vooraan en is de default (besluit 0140).
const UPLOAD_BRONNEN = ["Intern", "Extern", "DNB", "AFM", "Pensioenfederatie"];

export interface RetireKandidaat {
  id: string;
  titel: string;
}

export interface DocumentUploadModalProps {
  /** Sluit de modal (annuleren of na een geslaagde upload). */
  onClose: () => void;
  /** Na een GESLAAGDE upload — de aanroeper ververst zijn lijst / legt een
   *  vervolgkoppeling (bv. bewijsstuk of agendapunt) op basis van res.document_id. */
  onUploaded: (res: UploadResultaat) => void | Promise<void>;
  /** Titel boven de modal. */
  modalTitel?: string;
  /** Voorvulwaarde voor het titelveld. */
  standaardTitel?: string;
  /** Wanneer gezet: nieuw stuk PRIMAIR aan dit agendapunt koppelen (vergadering). */
  agendapuntId?: string | null;
  /** Kandidaat-voorgangers voor de rapportage-retire-picker (bibliotheek). */
  retireKandidaten?: RetireKandidaat[];
  /** Extra regel onder de knop (contextuele uitleg, optioneel). */
  voetnoot?: string;
}

const LEEG_FORM = {
  titel: "",
  bron: "Intern",
  bibliotheek: "fonds",
  documenttype: "",
  documentdatum: "",
  status: "",
  statusReden: "",
  bronstatus: "",
  bronstatusReden: "",
  retireRapportageId: "",
  retireReden: "",
};

export default function DocumentUploadModal({
  onClose,
  onUploaded,
  modalTitel = "Document uploaden",
  standaardTitel = "",
  agendapuntId = null,
  retireKandidaten,
  voetnoot,
}: DocumentUploadModalProps) {
  const [form, setForm] = useState({ ...LEEG_FORM, titel: standaardTitel });
  const [uploaden, setUploaden] = useState(false);
  const [bericht, setBericht] = useState("");
  const bestandRef = useRef<HTMLInputElement>(null);

  // Besluit 0140 — wat betekent de gekozen status/bronstatus voor de assistent?
  const gevolg: { toon: "ok" | "warn" | "neutraal"; tekst: string } = (() => {
    if (form.bronstatus === "uitgesloten") {
      return {
        toon: "warn",
        tekst:
          "Dit document wordt bewaard en is vindbaar in de bibliotheek, maar de assistent gebruikt het nooit als bron.",
      };
    }
    if (form.bronstatus === "historisch") {
      return {
        toon: "warn",
        tekst:
          "Dit document blijft doorzoekbaar voor historisch onderzoek, maar telt niet mee als actuele bron. De assistent citeert het niet als geldend.",
      };
    }
    if (form.status === "van_kracht" || form.status === "vastgesteld") {
      return {
        toon: "ok",
        tekst:
          "Dit document wordt na verwerking doorzoekbaar en kan door de assistent worden geciteerd als actuele bron.",
      };
    }
    return {
      toon: "neutraal",
      tekst:
        "Concept — dit document wordt wél geïndexeerd, maar geldt niet als actuele bron. De assistent citeert het niet als geldend.",
    };
  })();

  const toonRetire =
    !!retireKandidaten &&
    retireKandidaten.length > 0 &&
    form.documenttype === "rapportage" &&
    (form.status === "vastgesteld" || form.status === "van_kracht");

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const bestand = bestandRef.current?.files?.[0];
    if (!bestand) return;

    setUploaden(true);
    setBericht("");
    try {
      const res = await uploadDocument(bestand, {
        titel: form.titel,
        bron: form.bron,
        bibliotheek: form.bibliotheek,
        documenttype: form.documenttype,
        ...(agendapuntId ? { agendapunt_id: agendapuntId } : {}),
        ...(form.documentdatum ? { documentdatum: form.documentdatum } : {}),
        ...(form.status
          ? { status: form.status, status_reden: form.statusReden }
          : {}),
        ...(toonRetire && form.retireRapportageId
          ? {
              vervangt_rapportage_id: form.retireRapportageId,
              ...(form.retireReden.trim()
                ? { retire_reden: form.retireReden.trim() }
                : {}),
            }
          : {}),
        ...(form.bronstatus
          ? {
              bronstatus: form.bronstatus,
              bronstatus_reden: form.bronstatusReden,
            }
          : {}),
      });

      if (res.ok) {
        await onUploaded(res);
        onClose();
      } else {
        setBericht(
          `❌ ${res.error ?? "Uploaden is niet gelukt. Probeer het opnieuw of neem contact op met de beheerder."}`
        );
      }
    } catch {
      setBericht(
        "❌ Uploaden is niet gelukt door een verbindingsprobleem. Probeer het opnieuw."
      );
    } finally {
      setUploaden(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-accent/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-7 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-5">
          <h2 className="text-lg font-bold text-ink">{modalTitel}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            ✕
          </button>
        </div>
        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Bestand</label>
            <input
              ref={bestandRef}
              type="file"
              accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
              className="w-full border border-line rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-muted mt-1">
              PDF, Word (.docx) of Excel (.xlsx). Gescande PDF&apos;s eerst
              doorzoekbaar maken via Acrobat/Preview.
            </p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink mb-1">Titel</label>
            <input
              type="text"
              value={form.titel}
              onChange={(e) => setForm({ ...form, titel: e.target.value })}
              placeholder="bijv. DNB Leidraad Deskundigheid 2024"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">Bron</label>
              <select
                value={form.bron}
                onChange={(e) => setForm({ ...form, bron: e.target.value })}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {UPLOAD_BRONNEN.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted mt-1">
                Standaard <span className="font-semibold">Intern</span> — een upload
                vanuit het fonds is per definitie een fondsdocument.
              </p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                Documenttype <span className="text-err-ink">*</span>
              </label>
              <select
                value={form.documenttype}
                onChange={(e) => {
                  const nieuwType = e.target.value;
                  const resetStatus =
                    form.status === "van_kracht" &&
                    !magVanKracht(nieuwType as Documenttype);
                  setForm({
                    ...form,
                    documenttype: nieuwType,
                    ...(resetStatus ? { status: "", statusReden: "" } : {}),
                    ...(nieuwType === "rapportage" ? {} : { retireRapportageId: "" }),
                  });
                }}
                required
                className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              >
                <option value="">— kies een type —</option>
                {DOCUMENTTYPEN.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENTTYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted mt-1">
                Bepaalt de groep in de bibliotheek. Server-side verplicht op dit pad.
              </p>
            </div>
          </div>
          {form.documenttype === "rapportage" && (
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                Documentdatum <span className="text-err-ink">*</span>
              </label>
              <input
                type="date"
                value={form.documentdatum}
                onChange={(e) => setForm({ ...form, documentdatum: e.target.value })}
                required
                className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <p className="text-[11px] text-muted mt-1">
                De periode of vaststellingsdatum waarop de rapportage betrekking heeft.
              </p>
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-ink mb-1">
              Status bij aanlevering
            </label>
            <select
              value={form.status}
              onChange={(e) => {
                const nieuweStatus = e.target.value;
                const blijftActueel =
                  nieuweStatus === "vastgesteld" || nieuweStatus === "van_kracht";
                setForm({
                  ...form,
                  status: nieuweStatus,
                  ...(blijftActueel ? {} : { retireRapportageId: "" }),
                });
              }}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none"
            >
              <option value="">Concept — nog geen actuele bron</option>
              <option value="vastgesteld">
                {statusLabelVoorType(
                  "vastgesteld",
                  (form.documenttype as Documenttype) || null
                )}{" "}
                — buiten het portaal vastgesteld
              </option>
              {!!form.documenttype &&
                magVanKracht(form.documenttype as Documenttype) && (
                  <option value="van_kracht">
                    Van kracht — buiten het portaal geldend
                  </option>
                )}
            </select>
            <p className="text-[11px] text-muted mt-1">
              Alleen &quot;vastgesteld&quot; en &quot;van kracht&quot; tellen als
              actuele bron voor de assistent. Laat op concept staan als het stuk nog
              in besluitvorming is.
            </p>
          </div>
          {form.status && (
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                Reden <span className="font-normal text-muted">(verplicht)</span>
              </label>
              <input
                type="text"
                value={form.statusReden}
                onChange={(e) => setForm({ ...form, statusReden: e.target.value })}
                placeholder="bijv. vastgesteld in bestuursvergadering 12-03-2026"
                className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
                required
              />
              <p className="text-[11px] text-muted mt-1">
                Deze reden landt in het auditlog bij het document.
              </p>
            </div>
          )}
          {toonRetire && (
            <div>
              <label className="block text-sm font-semibold text-ink mb-1">
                Vervangt eerdere rapportage{" "}
                <span className="font-normal text-muted">(optioneel)</span>
              </label>
              <select
                value={form.retireRapportageId}
                onChange={(e) =>
                  setForm({ ...form, retireRapportageId: e.target.value })
                }
                className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-accent"
              >
                <option value="">— geen; laat vorige rapportages staan —</option>
                {(retireKandidaten ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.titel}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted mt-1">
                De gekozen rapportage wordt afgevoerd naar{" "}
                <span className="font-semibold">historisch</span> — niet meer actueel
                voor de assistent, wel vindbaar als historie. Met auditregel.
              </p>
              {form.retireRapportageId && (
                <input
                  type="text"
                  value={form.retireReden}
                  onChange={(e) => setForm({ ...form, retireReden: e.target.value })}
                  placeholder="Reden afvoer (optioneel; standaard: opgevolgd door deze rapportage)"
                  className="mt-2 w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
                />
              )}
            </div>
          )}
          <details className="border border-line rounded-lg">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-ink">
              Geavanceerd — bronstatus
            </summary>
            <div className="px-3 pb-3 pt-1">
              <select
                value={form.bronstatus}
                onChange={(e) => setForm({ ...form, bronstatus: e.target.value })}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              >
                <option value="">Actief — mag als bron worden gebruikt (standaard)</option>
                {INGEST_BRONSTATUSSEN.map((b) => (
                  <option key={b} value={b}>
                    {BRONSTATUS_LABEL[b]} —{" "}
                    {b === "historisch"
                      ? "bewaren, niet meer als actuele bron"
                      : "nooit als bron gebruiken"}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted mt-1">
                Laadt u een archiefstuk? Kies dan{" "}
                <span className="font-semibold">Historisch</span> — anders kan de
                assistent het als geldende bron citeren.
              </p>
            </div>
          </details>

          <div
            className={`rounded-lg px-3 py-2 text-[11.5px] ${
              gevolg.toon === "ok"
                ? "bg-ok-tint text-ok-ink"
                : gevolg.toon === "warn"
                  ? "bg-warn-tint text-warn-ink"
                  : "bg-app-bg text-muted"
            }`}
          >
            {gevolg.tekst}
          </div>

          {voetnoot ? (
            <p className="text-[11px] text-muted -mt-1">{voetnoot}</p>
          ) : (
            <p className="text-[11px] text-muted -mt-1">
              Dit document wordt opgeslagen in de{" "}
              <span className="font-semibold">fondsbibliotheek</span>. Generieke
              (DNB/AFM/PF) documenten worden centraal beheerd en zijn alleen-lezen.
            </p>
          )}
          {bericht && <div className="text-sm text-err-ink">{bericht}</div>}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-line rounded-lg py-2.5 text-sm font-semibold text-muted hover:bg-app-bg"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={uploaden}
              className="flex-1 bg-accent text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-accent-ink disabled:opacity-50"
            >
              {uploaden ? "Verwerken..." : "Uploaden & indexeren"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
