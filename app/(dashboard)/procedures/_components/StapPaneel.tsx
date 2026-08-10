"use client";

import { useEffect, useState } from "react";
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
import VereistenStrook from "./VereistenStrook";
import BibliotheekPicker from "./BibliotheekPicker";
import { uploadDocument } from "@/core/lib/document-upload-client";
import { DOCUMENTTYPEN, DOCUMENTTYPE_LABEL } from "@/core/lib/document-metadata";
import { bewijsUploadDocumenttypeBlokker } from "@/core/lib/document-ingest-classificatie";

interface Props {
  procedureId: string;
  stap: Stap;
  checklist: ChecklistItem[];
  bewijs: Bewijs[];
  besluit: Besluit | null;
  komendeVergaderingen: KomendeVergadering[];
  gekoppeldeAgendapunten: GekoppeldAgendapunt[];
  /** 1D-4: documenttype-opties voor de bewijs-tag, afgeleid uit de
      requirements voor deze stap. Leeg array → vrij invoeren. */
  documentRequirements?: { documenttype: string; label: string }[];
  /** T6-1A: leesmodus voor afgeronde of nog niet gestarte stappen. Alle
      mutatie-acties blijven zichtbaar maar zijn uitgeschakeld (niet verborgen —
      zo is duidelijk dat je inziet, niet bewerkt). Alleen de actieve stap is
      bewerkbaar. */
  alleenLezen?: boolean;
  /** T6-1A: naam van wie de stap heeft afgerond, voor de leesmodus-kop. */
  voltooidDoorNaam?: string | null;
}

function formatDatumKort(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function StapPaneel({
  procedureId,
  stap,
  checklist: initieelChecklist,
  bewijs: initieelBewijs,
  besluit,
  komendeVergaderingen,
  gekoppeldeAgendapunten,
  documentRequirements = [],
  alleenLezen = false,
  voltooidDoorNaam = null,
}: Props) {
  const router = useRouter();
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initieelChecklist);
  const [bewijs, setBewijs] = useState<Bewijs[]>(initieelBewijs);

  // Bug-fix: zonder deze sync blijft de lokale state hangen als
  // `router.refresh()` nieuwe props levert. Gevolg was dat een gefaalde
  // optimistische update visueel als afgevinkt bleef staan terwijl de
  // DB nog op voldaan=false stond — wat de stap-voltooien-validatie
  // achteraf liet falen met "Niet alle checklist-items zijn voldaan".
  useEffect(() => {
    setChecklist(initieelChecklist);
  }, [initieelChecklist]);
  useEffect(() => {
    setBewijs(initieelBewijs);
  }, [initieelBewijs]);
  const [bewijsForm, setBewijsForm] = useState(false);
  const [bewijsTitel, setBewijsTitel] = useState("");
  const [bewijsBeschrijving, setBewijsBeschrijving] = useState("");
  // 1D-4: file-upload + documenttype-tag op het bewijsformulier.
  const [bewijsBestand, setBewijsBestand] = useState<File | null>(null);
  const [bewijsDocumenttype, setBewijsDocumenttype] = useState("");
  // Optie B (werkopdracht 1.2): een LOS metadata-documenttype voor het nieuw te
  // uploaden bestand, náást de readiness-tag `bewijsDocumenttype`. Dit is de
  // classificatie die de documentbibliotheek/RAG gebruikt (beleid/besluit/…);
  // de readiness-tag zegt iets anders (welk soort bewijs de stap vraagt). Alleen
  // relevant bij een nieuwe upload — een bestaand bibliotheekdocument heeft al
  // een type.
  const [bewijsMetadataType, setBewijsMetadataType] = useState("");
  // 3-D: bibliotheek-picker — kiezen uit bestaande documenten i.p.v. uploaden.
  // Houdt de uploadflow ongewijzigd; deze state is exclusief actief.
  const [bewijsBibliotheekId, setBewijsBibliotheekId] = useState<string | null>(null);
  const [bewijsBibliotheekTitel, setBewijsBibliotheekTitel] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [besluitForm, setBesluitForm] = useState(false);
  const [besluitFormulering, setBesluitFormulering] = useState("");
  const [besluitMotivering, setBesluitMotivering] = useState("");
  // Eén textarea, één alternatief per regel — bij vastleggen splitsen
  // we op `\n` en filteren we lege regels eruit.
  const [besluitAlternatieven, setBesluitAlternatieven] = useState("");
  const [besluitDatum, setBesluitDatum] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [vergaderingForm, setVergaderingForm] = useState(false);
  const [vergaderingKeuze, setVergaderingKeuze] = useState<string>("");
  const [conceptHint, setConceptHint] = useState<string | null>(null);
  const [bezig, setBezig] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  // Niet-blokkerende waarschuwing: de handeling is geslaagd, maar er staat een
  // vervolgstap open. Bewust gescheiden van `fout` — dat blok is rood en zegt
  // "er is iets misgegaan", wat hier niet klopt.
  const [melding, setMelding] = useState<string | null>(null);

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
    if (alleenLezen) return;
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
    if (alleenLezen) return;
    setFout(null);
    setMelding(null);
    const titel = bewijsTitel.trim();
    if (!titel) {
      setFout("Titel is verplicht.");
      return;
    }
    // Optie B / 0140-regressiefix: bij een nieuwe upload in de processtroom is
    // een documenttype verplicht. Toon de blokker VÓÓR de submit (UX-guardrail)
    // i.p.v. de 400 die de uploadroute anders geeft.
    const typeBlokker = bewijsUploadDocumenttypeBlokker({
      heeftNieuwBestand: !bewijsBibliotheekId && !!bewijsBestand,
      documenttype: bewijsMetadataType,
    });
    if (typeBlokker) {
      setFout(typeBlokker);
      return;
    }
    setBezig("bewijs");
    try {
      // 3-D: drie bronnen voor `document_id`:
      //   1. Gekozen uit bibliotheek (bewijsBibliotheekId) — geen upload
      //   2. Nieuw bestand geüpload (bewijsBestand) — upload + index
      //   3. Geen koppeling — bewijs blijft titel-only
      // 1D-4: in geval (2) komt het stuk meteen in de fonds-bibliotheek
      // terecht via /api/documents/upload (bron='Intern'), met
      // bestandstype automatisch afgeleid.
      let documentId: string | null = bewijsBibliotheekId;
      if (!documentId && bewijsBestand) {
        // F7: direct-to-storage via de gedeelde helper. Het stuk komt in de
        // fonds-bibliotheek (bron='Intern') en wordt async verwerkt.
        const up = await uploadDocument(bewijsBestand, {
          bibliotheek: "fonds",
          bron: "Intern",
          titel,
          documenttype: bewijsMetadataType || null,
        });
        if (!up.ok) {
          throw new Error(up.error ?? "Upload van bewijsbestand mislukt");
        }
        // 06-08-2026: de route geeft `document_id` terug — daar koppelen we op.
        documentId = up.document_id ?? null;
        if (!documentId) {
          throw new Error(
            "Het bestand is geüpload, maar de koppeling aan dit bewijsstuk is niet gelukt. Koppel het stuk handmatig via 'Kies uit bibliotheek'."
          );
        }
        // F6/F7: het bewijsstuk wordt async verwerkt (incl. automatische OCR) en
        // is nog niet direct doorzoekbaar — dat expliciet melden (geen
        // schijnzekerheid: een stil onvindbaar bewijsstuk ondermijnt het dossier).
        setMelding(
          "Het bestand is gekoppeld en wordt nu verwerkt; het is binnen enkele minuten doorzoekbaar."
        );
      }

      const res = await fetch(`/api/procedures/${procedureId}/bewijs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stap_id: stap.id,
          titel,
          beschrijving: bewijsBeschrijving.trim() || null,
          document_id: documentId,
          documenttype: bewijsDocumenttype.trim() || null,
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
      setBewijsBestand(null);
      setBewijsDocumenttype("");
      setBewijsMetadataType("");
      setBewijsBibliotheekId(null);
      setBewijsBibliotheekTitel("");
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
    if (alleenLezen) return;
    setFout(null);
    const formulering = besluitFormulering.trim();
    if (!formulering) {
      setFout("Formulering is verplicht.");
      return;
    }
    setBezig("besluit");
    try {
      const verworpen = besluitAlternatieven
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(`/api/procedures/${procedureId}/besluiten`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stap_id: stap.id,
          formulering,
          motivering: besluitMotivering.trim() || null,
          datum: besluitDatum,
          verworpen_alternatieven: verworpen,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Vastleggen mislukt");
      }
      setBesluitForm(false);
      setBesluitAlternatieven("");
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Vastleggen mislukt");
    } finally {
      setBezig(null);
    }
  }

  async function vergaderingKoppelen(e: React.FormEvent) {
    e.preventDefault();
    if (alleenLezen) return;
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
    if (alleenLezen) return;
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
    if (alleenLezen) return;
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
    <div className="bg-white border border-line rounded-xl p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div
            className={`text-xs uppercase tracking-wide font-semibold ${
              alleenLezen
                ? stap.status === "afgerond"
                  ? "text-ok-ink"
                  : "text-muted"
                : "text-warn-ink"
            }`}
          >
            {alleenLezen
              ? stap.status === "afgerond"
                ? "Afgeronde stap — alleen-lezen"
                : "Nog niet gestarte stap — alleen-lezen"
              : "Actieve stap"}
          </div>
          <h2 className="text-lg font-semibold text-ink mt-1">
            {stap.volgorde} — {stap.naam}
          </h2>
          {alleenLezen && stap.status === "afgerond" && (
            <p className="text-xs text-muted mt-1">
              Afgerond
              {stap.voltooid_op
                ? ` op ${formatDatumKort(stap.voltooid_op)}`
                : ""}
              {voltooidDoorNaam ? ` door ${voltooidDoorNaam}` : ""}
            </p>
          )}
          {stap.beschrijving && (
            <p className="text-sm text-muted mt-1.5">{stap.beschrijving}</p>
          )}
        </div>
        <div className="text-right text-xs text-muted flex-shrink-0">
          {stap.deadline && (
            <div className="text-warn-ink font-medium">
              Deadline {formatDatumKort(stap.deadline)}
            </div>
          )}
          {stap.eigenaar_naam && <div className="mt-1">{stap.eigenaar_naam}</div>}
        </div>
      </div>

      {/* T6-1A: in leesmodus schakelt de fieldset alle formuliercontrols
          (inputs, textareas, selects, knoppen) native uit — zichtbaar maar
          niet bedienbaar. Navigatielinks (agendapunten) blijven werken. */}
      <fieldset disabled={alleenLezen} className="min-w-0 border-0 p-0 m-0">

      {/* Checklist */}
      <div className="mt-6">
        <div className="text-xs uppercase tracking-wide text-muted font-semibold mb-3">
          Checklist
        </div>
        {checklist.length === 0 ? (
          <div className="text-sm text-muted italic">
            Geen checklist-items.
          </div>
        ) : (
          <div className="space-y-2">
            {checklist.map((c) => (
              <label
                key={c.id}
                className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer ${
                  c.voldaan
                    ? "bg-app-bg"
                    : "bg-white border border-line hover:border-accent"
                }`}
              >
                <input
                  type="checkbox"
                  checked={c.voldaan}
                  onChange={() => checklistToggle(c)}
                  className="mt-0.5 accent-accent w-4 h-4 rounded"
                />
                <div className="flex-1">
                  <div
                    className={`text-sm ${
                      c.voldaan ? "text-muted line-through" : "text-ink"
                    }`}
                  >
                    {c.label}
                  </div>
                  {c.voldaan && c.voldaan_op && (
                    <div className="text-xs text-muted mt-0.5">
                      Afgevinkt {formatDatumKort(c.voldaan_op)}
                      {c.voldaan_door_naam ? ` · ${c.voldaan_door_naam}` : ""}
                    </div>
                  )}
                </div>
                {c.bewijs_vereist && !c.voldaan && (
                  <span className="text-[11px] text-warn-ink bg-warn-tint px-2 py-0.5 rounded font-medium">
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
          <div className="text-xs uppercase tracking-wide text-muted font-semibold">
            Vergaderingen
          </div>
          {!vergaderingForm && komendeVergaderingen.length > 0 && (
            <button
              onClick={() => setVergaderingForm(true)}
              className="text-xs text-ink hover:underline"
            >
              + Voeg toe aan vergadering
            </button>
          )}
        </div>

        {gekoppeldeAgendapunten.length === 0 && !vergaderingForm && (
          <div className="text-sm text-muted italic">
            Deze stap staat (nog) niet op een vergader-agenda.
          </div>
        )}

        {gekoppeldeAgendapunten.length > 0 && (
          <div className="space-y-2 mb-3">
            {gekoppeldeAgendapunten.map((a) => (
              <Link
                key={a.id}
                href={`/vergaderingen/${a.vergadering_id}`}
                className="flex items-center gap-3 p-3 border border-line rounded-lg hover:border-accent"
              >
                <div className="w-9 h-10 bg-accent-tint text-accent-ink rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                  AGENDA
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">
                    {a.titel}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {a.vergadering_titel}
                    {a.vergadering_datum
                      ? ` · ${formatDatumKort(a.vergadering_datum)}`
                      : ""}
                  </div>
                </div>
                <span className="text-xs text-ink hover:underline">
                  Open →
                </span>
              </Link>
            ))}
          </div>
        )}

        {vergaderingForm && (
          <form
            onSubmit={vergaderingKoppelen}
            className="p-3 border border-line rounded-lg bg-app-bg space-y-2"
          >
            <select
              value={vergaderingKeuze}
              onChange={(e) => setVergaderingKeuze(e.target.value)}
              className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none bg-white"
            >
              <option value="">— Kies een komende vergadering —</option>
              {komendeVergaderingen.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.titel} — {formatDatumKort(v.datum)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted">
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
                className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={bezig === "vergadering"}
                className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-ink disabled:opacity-50"
              >
                {bezig === "vergadering" ? "Bezig…" : "Koppelen"}
              </button>
            </div>
          </form>
        )}

        {komendeVergaderingen.length === 0 && (
          <p className="text-xs text-muted mt-1">
            Geen komende vergaderingen om aan te koppelen.{" "}
            <Link href="/vergaderingen" className="text-ink underline">
              Plan eerst een vergadering →
            </Link>
          </p>
        )}
      </div>

      {/* Bewijs */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wide text-muted font-semibold">
            Bewijsstukken
          </div>
          <button
            onClick={() => setBewijsForm(!bewijsForm)}
            className="text-xs text-ink hover:underline"
          >
            {bewijsForm ? "Annuleren" : "+ Toevoegen"}
          </button>
        </div>

        {bewijsForm && (
          <form
            onSubmit={bewijsToevoegen}
            className="mb-3 p-3 border border-line rounded-lg bg-app-bg space-y-2"
          >
            <input
              type="text"
              value={bewijsTitel}
              onChange={(e) => setBewijsTitel(e.target.value)}
              placeholder="Titel of bestandsnaam"
              className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none"
            />
            <textarea
              rows={2}
              value={bewijsBeschrijving}
              onChange={(e) => setBewijsBeschrijving(e.target.value)}
              placeholder="Korte beschrijving (optioneel)"
              className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none resize-none"
            />
            {/* 1D-4: documenttype-tag uit de stap-requirements.
                Als er documenttypes in deze stap zijn, presenteren we
                ze als dropdown — anders een vrij tekstveld. */}
            {documentRequirements.length > 0 ? (
              <select
                value={bewijsDocumenttype}
                onChange={(e) => setBewijsDocumenttype(e.target.value)}
                className="w-full border border-line rounded px-2 py-1.5 text-sm bg-white focus:border-accent outline-none"
              >
                <option value="">— kies documenttype (optioneel) —</option>
                {documentRequirements.map((d) => (
                  <option key={d.documenttype} value={d.documenttype}>
                    {d.label} ({d.documenttype})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={bewijsDocumenttype}
                onChange={(e) => setBewijsDocumenttype(e.target.value)}
                placeholder="Documenttype-tag (optioneel, bv. ALM_analyse)"
                className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none"
              />
            )}
            {/* 1D-4 + 3-D: bewijs-bron — drie opties:
                1. Kies bestaand document uit bibliotheek (3-D, geen duplicaat)
                2. Upload nieuw bestand (1D-4, landt ook in bibliotheek)
                3. Alleen titel + beschrijving (geen document gekoppeld)
                Opties (1) en (2) sluiten elkaar uit — de eerstgekozen wint. */}
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">
                Document koppelen (optioneel)
              </label>
              {bewijsBibliotheekId ? (
                <div className="flex items-center justify-between gap-3 p-2.5 bg-warn-tint border border-warn/30 rounded">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-warn-ink uppercase tracking-wide font-semibold">
                      Gekozen uit bibliotheek
                    </p>
                    <p className="text-sm text-ink truncate">
                      {bewijsBibliotheekTitel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setBewijsBibliotheekId(null);
                      setBewijsBibliotheekTitel("");
                    }}
                    className="text-xs text-err-ink hover:underline whitespace-nowrap"
                  >
                    Loskoppelen
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent text-ink"
                    >
                      Kies uit bibliotheek →
                    </button>
                    <span className="text-[11px] text-muted">of upload nieuw bestand:</span>
                  </div>
                  <input
                    type="file"
                    accept=".pdf,.docx,.xlsx"
                    onChange={(e) => setBewijsBestand(e.target.files?.[0] ?? null)}
                    className="block w-full text-xs text-ink file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-accent file:text-white file:text-xs hover:file:bg-accent-ink"
                  />
                  {bewijsBestand && (
                    <>
                      <p className="text-[11px] text-muted mt-1">
                        Geselecteerd: <span className="font-medium">{bewijsBestand.name}</span>
                        {" — "}wordt geüpload naar de documentbibliotheek bij vastleggen.
                      </p>
                      {/* Optie B (werkopdracht 1.2): metadata-documenttype voor het
                          nieuw geüploade stuk. Verplicht in de processtroom — de
                          bibliotheek/RAG classificeert erop. Los van de
                          readiness-tag hierboven. */}
                      <div className="mt-2">
                        <label className="block text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">
                          Documenttype <span className="text-err-ink">*</span>
                        </label>
                        <select
                          value={bewijsMetadataType}
                          onChange={(e) => setBewijsMetadataType(e.target.value)}
                          className="w-full border border-line rounded px-2 py-1.5 text-sm bg-white focus:border-accent outline-none"
                        >
                          <option value="">— kies een documenttype —</option>
                          {DOCUMENTTYPEN.map((t) => (
                            <option key={t} value={t}>
                              {DOCUMENTTYPE_LABEL[t]}
                            </option>
                          ))}
                        </select>
                        <p className="text-[11px] text-muted mt-1">
                          Waar de bibliotheek en de assistent het stuk op indelen.
                        </p>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBewijsForm(false)}
                className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={bezig === "bewijs"}
                className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-ink disabled:opacity-50"
              >
                {bezig === "bewijs" ? "Bezig…" : "Toevoegen"}
              </button>
            </div>
          </form>
        )}

        {bewijs.length === 0 ? (
          <div className="text-sm text-muted italic">
            Nog geen bewijsstukken bij deze stap.
          </div>
        ) : (
          <div className="space-y-2">
            {bewijs.map((b) => (
              <div
                key={b.id}
                className="flex items-start gap-3 p-3 border border-line rounded-lg"
              >
                <div className="w-9 h-10 bg-err-tint text-err-ink rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                  PDF
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink">
                    {b.titel}
                  </div>
                  {b.beschrijving && (
                    <div className="text-xs text-muted mt-0.5 whitespace-pre-line">
                      {b.beschrijving}
                    </div>
                  )}
                  <div className="text-xs text-muted mt-1">
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
            <div className="text-xs uppercase tracking-wide text-muted font-semibold">
              Besluit
            </div>
            {!besluit && (
              <div className="flex items-center gap-3">
                <button
                  onClick={besluitConceptOphalen}
                  disabled={bezig === "concept"}
                  className="text-xs text-accent hover:underline disabled:opacity-50 inline-flex items-center gap-1"
                  title="Laat Claude een conceptformulering opstellen op basis van bewijs en eerdere stappen"
                >
                  {bezig === "concept" ? "Concept aan het schrijven…" : "↗ Concept met AI"}
                </button>
                {!besluitForm && (
                  <button
                    onClick={() => setBesluitForm(true)}
                    className="text-xs text-ink hover:underline"
                  >
                    + Besluit vastleggen
                  </button>
                )}
              </div>
            )}
          </div>
          {conceptHint && (
            <div className="mb-3 text-xs text-warn-ink bg-warn-tint border border-warn/30 rounded-lg px-3 py-2">
              {conceptHint}
            </div>
          )}
          {besluit ? (
            <div className="border border-ok/30 bg-ok-tint rounded-lg p-3">
              <div className="text-sm text-ink font-medium">
                {besluit.formulering}
              </div>
              {besluit.motivering && (
                <p className="text-xs text-muted mt-1 whitespace-pre-line">
                  {besluit.motivering}
                </p>
              )}
              <div className="text-xs text-muted mt-2">
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
              className="p-3 border border-line rounded-lg bg-app-bg space-y-2"
            >
              <textarea
                rows={2}
                value={besluitFormulering}
                onChange={(e) => setBesluitFormulering(e.target.value)}
                placeholder="Bv.: Akkoord met verhoging hedge-ratio naar 70%, conform voorstel."
                className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none resize-none"
              />
              <textarea
                rows={3}
                value={besluitMotivering}
                onChange={(e) => setBesluitMotivering(e.target.value)}
                placeholder="Motivering (optioneel)"
                className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none resize-none"
              />
              <textarea
                rows={3}
                value={besluitAlternatieven}
                onChange={(e) => setBesluitAlternatieven(e.target.value)}
                placeholder="Verworpen alternatieven (één per regel, optioneel)&#10;Bv.:&#10;Alternatief 1: hedge-ratio op 80% → afgewezen ivm kosten&#10;Alternatief 2: bandbreedte 60-70% → afgewezen ivm complexiteit"
                className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none resize-none"
              />
              <input
                type="date"
                value={besluitDatum}
                onChange={(e) => setBesluitDatum(e.target.value)}
                className="border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBesluitForm(false)}
                  className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent"
                >
                  Annuleren
                </button>
                <button
                  type="submit"
                  disabled={bezig === "besluit"}
                  className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-ink disabled:opacity-50"
                >
                  {bezig === "besluit" ? "Bezig…" : "Vastleggen"}
                </button>
              </div>
            </form>
          ) : (
            <div className="text-sm text-muted italic">
              Deze stap vereist een formeel besluit.
            </div>
          )}
        </div>
      )}

      {fout && (
        <div className="mt-3 text-sm text-err-ink bg-err-tint border border-err/30 rounded-lg px-3 py-2">
          {fout}
        </div>
      )}

      {melding && (
        <div className="mt-3 text-sm text-warn-ink bg-warn-tint border border-warn/30 rounded-lg px-3 py-2">
          {melding}
        </div>
      )}

      {/* Voltooien — vereisten-strook (1D-4) maakt blokkers expliciet
          conform het overkoepelende ontwerpprincipe. */}
      <div className="mt-6 pt-5 border-t border-line">
        <VereistenStrook
          titel="Vereisten voor stap-voltooien"
          vereisten={[
            {
              label: `${voldaanCount} van ${totaalCount} checklist-items voldaan`,
              voldaan: allesVoldaan,
              hint: !allesVoldaan
                ? `Nog ${totaalCount - voldaanCount} item${totaalCount - voldaanCount === 1 ? "" : "s"} af te vinken`
                : null,
            },
            ...(bewijsVereist > 0
              ? [
                  {
                    label: heeftBewijs
                      ? `${bewijs.length} bewijsstuk${bewijs.length === 1 ? "" : "ken"} toegevoegd`
                      : "Bewijsstuk vereist",
                    voldaan: heeftBewijs,
                    hint: !heeftBewijs
                      ? `${bewijsVereist} checklist-item${bewijsVereist === 1 ? "" : "s"} vraagt om bewijs`
                      : null,
                  },
                ]
              : []),
            ...(stap.vereist_besluit
              ? [
                  {
                    label: besluit ? "Besluit vastgelegd" : "Besluit ontbreekt",
                    voldaan: besluit !== null,
                    hint: !besluit
                      ? "Formuleer + motiveer het besluit hierboven"
                      : null,
                  },
                ]
              : []),
          ]}
          actie={
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={stapVoltooien}
                disabled={!kanVoltooien || bezig === "voltooien"}
                className={`px-4 py-2 text-sm rounded-lg font-medium ${
                  kanVoltooien
                    ? "bg-accent text-white hover:bg-accent-ink"
                    : "bg-app-line text-muted cursor-not-allowed"
                }`}
              >
                {bezig === "voltooien" ? "Bezig…" : "Stap voltooien"}
              </button>
            </div>
          }
        />
      </div>

      </fieldset>

      {/* 3-D: Bibliotheek-picker modal — overlays op de hele pagina,
          sluit zichzelf bij selectie of klik buiten. */}
      {pickerOpen && (
        <BibliotheekPicker
          onSelect={(id, titel) => {
            setBewijsBibliotheekId(id);
            setBewijsBibliotheekTitel(titel);
            // Als een nieuw bestand was gekozen, laat dat vallen — de
            // bibliotheekkeuze wint (de UI in het form maakt dat ook duidelijk).
            setBewijsBestand(null);
            // Als de bewijs-titel nog leeg is, vul 'm alvast met de
            // documenttitel — gebruiker kan 'm desgewenst nog wijzigen.
            if (!bewijsTitel.trim()) {
              setBewijsTitel(titel);
            }
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
