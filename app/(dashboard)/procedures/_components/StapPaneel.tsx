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
import type { EvidenceItem } from "@/core/lib/decision-view";
import BibliotheekPicker from "./BibliotheekPicker";
import VereisteToevoegen from "./VereisteToevoegen";
import { uploadDocument } from "@/core/lib/document-upload-client";
import { DOCUMENTTYPEN, DOCUMENTTYPE_LABEL } from "@/core/lib/document-metadata";
import { bewijsUploadDocumenttypeBlokker } from "@/core/lib/document-ingest-classificatie";
import {
  checklistSamenvatting,
  bewijsstukkenSamenvatting,
  vergaderingenSamenvatting,
} from "@/core/lib/procedure-detail-weergave";

// WO-3: de Bewijsstukken-sectie is vereist-gedreven (evidence-unie template +
// instantie) i.p.v. een losse lijst opgevoerde stukken; het vroegere
// StapRequirementsPaneel gaat hierin op. AI-validatie (AIValidatieBlok) valt
// buiten deze tranche.
const REQUIREMENT_LABELS: Record<string, string> = {
  document: "Document",
  field: "Veld",
  assumption: "Aanname",
  risk: "Risico",
  ai_validation: "AI-validatie",
  approval: "Goedkeuring",
  mandate_check: "Mandaatcheck",
  kpi: "KPI",
  evaluation: "Evaluatie",
  dissent_review: "Dissent-review",
  external_submission: "Externe indiening",
  consultation: "Consultatie",
};

interface Props {
  procedureId: string;
  stap: Stap;
  checklist: ChecklistItem[];
  bewijs: Bewijs[];
  /** WO-3: gevraagde bewijslast voor deze stap (readiness-unie); vervangt het
      losse requirements-paneel. Wordt hier op stap_volgorde gefilterd. */
  evidence: EvidenceItem[];
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
  /** WO-2 (D7/§5.4): mag deze gebruiker checklistpunten toevoegen en een
      afgeronde stap heropenen? Alleen voorzitter/beheerder. Dit is een
      UI-signaal — de harde gate zit server-side in de routes. */
  kanBeheren?: boolean;
  /** Id van de ingelogde gebruiker — bepaalt of de verwijder-knop op een
      eigen bewijsstuk zichtbaar is (server-side check blijft leidend). */
  currentUserId?: string;
}

function formatDatumKort(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Ingeklapte sectie (WO-3) ─────────────────────────────────────────────────
// Checklist / Bewijsstukken / Vergaderingen openen standaard ingeklapt met een
// samenvatting in de kop. `open`/`onToggle` zijn controlled zodat de "+ toevoegen"-
// affordance de sectie tegelijk kan openklappen.
function Sectie({
  titel,
  samenvatting,
  open,
  onToggle,
  addLabel,
  onAdd,
  children,
}: {
  titel: string;
  samenvatting: string;
  open: boolean;
  onToggle: () => void;
  addLabel?: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex items-center gap-2 cursor-pointer select-none"
      >
        <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
          {titel}
        </div>
        <span className="text-[11px] text-muted">· {samenvatting}</span>
        <span className="ml-auto flex items-center gap-3">
          {addLabel && onAdd && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAdd();
              }}
              className="text-xs text-accent hover:underline"
            >
              {addLabel}
            </button>
          )}
          <span
            aria-hidden
            className={`text-muted text-xs transition-transform ${
              open ? "" : "-rotate-90"
            }`}
          >
            ▾
          </span>
        </span>
      </div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

// ── Uitklapbaar checklistpunt (WO-3) ─────────────────────────────────────────
// De toelichting per checklistpunt bestaat nog niet als data (OB-E10, aparte
// data-WO); tot dan toont de body de eerlijke lege staat. Bewerken van de
// toelichting volgt met die data-WO — daarom hier bewust geen dode edit-knop.
function ChecklistRij({
  c,
  alleenLezen,
  onToggle,
}: {
  c: ChecklistItem;
  alleenLezen: boolean;
  onToggle: (c: ChecklistItem) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`bg-white border rounded-lg ${
        c.voldaan ? "border-line" : "border-line hover:border-accent"
      }`}
    >
      <div className="flex items-start gap-3 p-3">
        <input
          type="checkbox"
          checked={c.voldaan}
          disabled={alleenLezen}
          onChange={() => onToggle(c)}
          className="mt-0.5 accent-accent w-4 h-4 rounded"
        />
        <div className="flex-1 min-w-0">
          <div
            className={`text-sm flex items-center gap-2 flex-wrap ${
              c.voldaan ? "text-muted line-through" : "text-ink"
            }`}
          >
            {c.label}
            {c.bron === "handmatig" && (
              <span className="text-[10px] uppercase tracking-wide text-phase-ink bg-phase-tint border border-phase/30 px-1.5 py-0.5 rounded no-underline">
                Handmatig
              </span>
            )}
          </div>
          {c.voldaan && c.voldaan_op && (
            <div className="text-xs text-muted mt-0.5">
              Afgevinkt {formatDatumKort(c.voldaan_op)}
              {c.voldaan_door_naam ? ` · ${c.voldaan_door_naam}` : ""}
            </div>
          )}
        </div>
        {c.bewijs_vereist && !c.voldaan && (
          <span className="text-[11px] text-warn-ink bg-warn-tint px-2 py-0.5 rounded font-medium whitespace-nowrap">
            Bewijs vereist
          </span>
        )}
        {/* role=button i.p.v. <button> zodat inzien óók in leesmodus werkt
            (een <button> in de disabled fieldset zou niet klikbaar zijn). */}
        <span
          role="button"
          tabIndex={0}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((o) => !o);
            }
          }}
          aria-expanded={open}
          className="text-[11px] text-muted hover:text-accent shrink-0 inline-flex items-center gap-1 cursor-pointer"
        >
          Toelichting
          <span
            aria-hidden
            className={`text-xs transition-transform ${open ? "" : "-rotate-90"}`}
          >
            ▾
          </span>
        </span>
      </div>
      {open && (
        <div className="px-3 pb-3">
          <div className="bg-app-bg border border-line rounded-md p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">
              Toelichting
            </div>
            {c.toelichting ? (
              <p className="text-[13px] text-muted whitespace-pre-line">
                {c.toelichting}
              </p>
            ) : (
              <p className="text-[13px] text-muted italic">
                Nog geen toelichting bij dit checklistpunt.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Uitklapbaar bewijsstuk / vereiste (WO-3) ─────────────────────────────────
// Vereist-gedreven rij (evidence). Toelichting per vereiste bestaat nog niet als
// data (OB-E10). "Opvoeren" hergebruikt het bestaande bewijs-formulier.
function BewijsstukRij({
  r,
  alleenLezen,
  onOpvoeren,
}: {
  r: EvidenceItem;
  alleenLezen: boolean;
  onOpvoeren: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-line rounded-lg">
      <div className="flex items-center gap-3 p-3">
        <span className="text-[10px] uppercase tracking-wide text-muted font-semibold w-24 shrink-0">
          {REQUIREMENT_LABELS[r.requirement_type] ?? r.requirement_type}
        </span>
        <div className="flex-1 text-sm text-ink min-w-0">
          {r.label}
          {r.blokkerend && !r.vervuld && (
            <span className="text-[10px] text-err-ink bg-err-tint border border-err/30 rounded px-1.5 py-0.5 ml-1 font-medium">
              blokkerend
            </span>
          )}
        </div>
        {/* role=button i.p.v. <button> zodat inzien óók in leesmodus werkt. */}
        <span
          role="button"
          tabIndex={0}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((o) => !o);
            }
          }}
          aria-expanded={open}
          className="text-[11px] text-muted hover:text-accent shrink-0 inline-flex items-center gap-1 cursor-pointer"
        >
          Toelichting
          <span
            aria-hidden
            className={`text-xs transition-transform ${open ? "" : "-rotate-90"}`}
          >
            ▾
          </span>
        </span>
        {r.vervuld ? (
          <span className="text-[11px] text-ok-ink font-medium shrink-0 whitespace-nowrap">
            ✓ Opgevoerd
          </span>
        ) : alleenLezen ? (
          <span className="text-[11px] text-muted shrink-0 whitespace-nowrap">
            Nog op te voeren
          </span>
        ) : (
          <button
            type="button"
            onClick={onOpvoeren}
            className="text-[11px] text-accent hover:underline shrink-0 whitespace-nowrap"
          >
            Opvoeren
          </button>
        )}
      </div>
      {open && (
        <div className="px-3 pb-3">
          <div className="bg-app-bg border border-line rounded-md p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">
              Toelichting
            </div>
            {r.toelichting ? (
              <p className="text-[13px] text-muted whitespace-pre-line">
                {r.toelichting}
              </p>
            ) : (
              <p className="text-[13px] text-muted italic">
                Nog geen toelichting bij dit bewijsstuk.
              </p>
            )}
            {r.vervuld && r.bron_titel && (
              <p className="text-[13px] text-ok-ink mt-2">
                Opgevoerd: {r.bron_titel}
              </p>
            )}
            {!r.vervuld && r.documenttype && (
              <p className="text-[13px] text-muted mt-2">
                Vereist documenttype:{" "}
                <span className="font-mono text-ink">{r.documenttype}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StapPaneel({
  procedureId,
  stap,
  checklist: initieelChecklist,
  bewijs: initieelBewijs,
  evidence,
  besluit,
  komendeVergaderingen,
  gekoppeldeAgendapunten,
  documentRequirements = [],
  alleenLezen = false,
  voltooidDoorNaam = null,
  kanBeheren = false,
  currentUserId = "",
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
  // WO-2 (D7): handmatig checklistpunt toevoegen aan een lopende stap.
  const [checklistForm, setChecklistForm] = useState(false);
  const [checklistLabel, setChecklistLabel] = useState("");
  const [checklistBewijsVereist, setChecklistBewijsVereist] = useState(false);
  // WO-2 (§4.3): een afgeronde stap heropenen (met verplichte motivering).
  const [heropenForm, setHeropenForm] = useState(false);
  const [heropenMotivering, setHeropenMotivering] = useState("");
  // WO-2-vervolg: welk (titel-only) bewijsstuk koppelen we aan een document?
  const [koppelDoelId, setKoppelDoelId] = useState<string | null>(null);
  // WO-3: ingeklapte secties (controlled zodat "+ toevoegen" ze kan openklappen).
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [bewijsOpen, setBewijsOpen] = useState(false);
  const [vergaderingOpen, setVergaderingOpen] = useState(false);
  // WO-3: stap-toelichting (onder de titel) bewerken.
  const [toelichtingBewerken, setToelichtingBewerken] = useState(false);
  const [toelichtingWaarde, setToelichtingWaarde] = useState(
    stap.beschrijving ?? ""
  );
  useEffect(() => {
    setToelichtingWaarde(stap.beschrijving ?? "");
  }, [stap.beschrijving]);

  const stapEvidence = evidence.filter(
    (e) => e.stap_volgorde === stap.volgorde
  );

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

  // WO-2 (D7): handmatig checklistpunt toevoegen. Server-side gegate op
  // voorzitter/beheerder; de UI toont de affordance alleen bij die rollen.
  async function checklistToevoegen(e: React.FormEvent) {
    e.preventDefault();
    if (alleenLezen || !kanBeheren) return;
    setFout(null);
    const label = checklistLabel.trim();
    if (!label) {
      setFout("Omschrijving van het checklistpunt is verplicht.");
      return;
    }
    setBezig("checklist-toevoegen");
    try {
      const res = await fetch(`/api/procedures/${procedureId}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stap_id: stap.id,
          label,
          bewijs_vereist: checklistBewijsVereist,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Toevoegen mislukt");
      }
      const data = await res.json();
      if (data.item) setChecklist([...checklist, data.item as ChecklistItem]);
      setChecklistLabel("");
      setChecklistBewijsVereist(false);
      setChecklistForm(false);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Toevoegen mislukt");
    } finally {
      setBezig(null);
    }
  }

  // WO-2 (§4.3): een afgeronde stap heropenen. Motivering is verplicht; de
  // heropening wordt append-only gelogd en afhankelijke afgeronde stappen
  // krijgen server-side `herbevestiging_nodig`. Server-side gegate.
  async function stapHeropenen(e: React.FormEvent) {
    e.preventDefault();
    if (!kanBeheren) return;
    setFout(null);
    const motivering = heropenMotivering.trim();
    if (!motivering) {
      setFout("Motivering voor het heropenen is verplicht.");
      return;
    }
    setBezig("heropenen");
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/stappen/${stap.id}/heropenen`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivering }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Heropenen mislukt");
      }
      setHeropenMotivering("");
      setHeropenForm(false);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Heropenen mislukt");
    } finally {
      setBezig(null);
    }
  }

  // WO-2-vervolg: een bewijsstuk verwijderen (indiener of voorzitter/beheerder;
  // server-side gegate + append-only gelogd).
  async function bewijsVerwijderen(bewijsId: string) {
    if (alleenLezen) return;
    setFout(null);
    setBezig(`bewijs-del-${bewijsId}`);
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/bewijs/${bewijsId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Verwijderen mislukt");
      }
      setBewijs((huidig) => huidig.filter((b) => b.id !== bewijsId));
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Verwijderen mislukt");
    } finally {
      setBezig(null);
    }
  }

  // WO-2-vervolg: een document koppelen aan een vooraf opgegeven bewijsstuk.
  async function bewijsKoppelen(bewijsId: string, documentId: string) {
    if (alleenLezen) return;
    setFout(null);
    setBezig(`bewijs-koppel-${bewijsId}`);
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/bewijs/${bewijsId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document_id: documentId }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Koppelen mislukt");
      }
      setKoppelDoelId(null);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Koppelen mislukt");
    } finally {
      setBezig(null);
    }
  }

  // WO-3: stap-toelichting opslaan (schrijft procedure_stappen.beschrijving).
  // Buiten de leesmodus-fieldset zodat een voorzitter/beheerder een toelichting
  // ook op een afgeronde stap kan corrigeren. Server-side gegate.
  async function toelichtingOpslaan() {
    if (!kanBeheren) return;
    setFout(null);
    setBezig("toelichting");
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/stappen/${stap.id}/toelichting`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toelichting: toelichtingWaarde.trim() || null }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Opslaan mislukt");
      }
      setToelichtingBewerken(false);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setBezig(null);
    }
  }

  // "Opvoeren" bij een vereiste opent het bewijs-formulier, voorgevuld met de
  // vereiste als titel + documenttype-tag.
  function opvoerenVanuitVereiste(r: EvidenceItem) {
    setBewijsOpen(true);
    setBewijsForm(true);
    if (!bewijsTitel.trim()) setBewijsTitel(r.label);
    if (r.documenttype) setBewijsDocumenttype(r.documenttype);
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

      {/* WO-3: toelichting onder de staptitel (schrijft procedure_stappen.
          beschrijving). Bewerkbaar door voorzitter/beheerder — bewust BUITEN de
          leesmodus-fieldset zodat ook een afgeronde stap gecorrigeerd kan worden. */}
      <div className="mt-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] uppercase tracking-wide text-muted font-semibold">
            Toelichting
          </span>
          {kanBeheren && !toelichtingBewerken && (
            <button
              type="button"
              onClick={() => {
                setToelichtingWaarde(stap.beschrijving ?? "");
                setToelichtingBewerken(true);
              }}
              className="text-xs text-accent hover:underline"
            >
              Wijzigen
            </button>
          )}
        </div>
        {toelichtingBewerken ? (
          <div className="space-y-2">
            <textarea
              rows={3}
              maxLength={4000}
              value={toelichtingWaarde}
              onChange={(e) => setToelichtingWaarde(e.target.value)}
              placeholder="Bestuurlijke toelichting bij deze stap."
              className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setToelichtingBewerken(false)}
                className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={toelichtingOpslaan}
                disabled={bezig === "toelichting"}
                className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-ink disabled:opacity-50"
              >
                {bezig === "toelichting" ? "Bezig…" : "Opslaan"}
              </button>
            </div>
          </div>
        ) : stap.beschrijving ? (
          <p className="text-sm text-muted max-w-2xl">{stap.beschrijving}</p>
        ) : (
          <p className="text-sm text-muted italic">
            Nog geen toelichting bij deze stap.
          </p>
        )}
      </div>

      {/* WO-2 (§4.3): heropenen van een afgeronde stap. Bewust BUITEN de
          leesmodus-fieldset (die alles disabled) — heropenen is juist de
          handeling die op een afgeronde stap hoort. Alleen voor
          voorzitter/beheerder; motivering verplicht; server-side gegate en
          append-only gelogd. Afhankelijke afgeronde stappen krijgen dan
          `herbevestiging_nodig`. */}
      {stap.status === "afgerond" && kanBeheren && (
        <div className="mt-4 pt-4 border-t border-line">
          {!heropenForm ? (
            <button
              type="button"
              onClick={() => setHeropenForm(true)}
              className="text-xs px-3 py-1.5 border border-warn/40 text-warn-ink bg-warn-tint rounded-lg hover:border-warn"
            >
              ↺ Stap heropenen
            </button>
          ) : (
            <form onSubmit={stapHeropenen} className="space-y-2">
              <label className="block text-[11px] uppercase tracking-wide text-muted font-semibold">
                Motivering voor het heropenen <span className="text-err-ink">*</span>
              </label>
              <textarea
                rows={2}
                value={heropenMotivering}
                onChange={(e) => setHeropenMotivering(e.target.value)}
                placeholder="Bv.: heropend na verduidelijkingsvraag DNB over de evenwichtigheidstoets."
                className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none resize-none"
              />
              <p className="text-[11px] text-muted">
                Het bestuurlijk oordeel krijgt een nieuwe versie; de eerdere
                afronding blijft in het spoor. Gerelateerde afgeronde stappen
                worden gemarkeerd met “herbevestiging nodig”.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setHeropenForm(false);
                    setHeropenMotivering("");
                  }}
                  className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent"
                >
                  Annuleren
                </button>
                <button
                  type="submit"
                  disabled={bezig === "heropenen"}
                  className="text-xs px-3 py-1.5 bg-warn text-white rounded hover:brightness-110 disabled:opacity-50"
                >
                  {bezig === "heropenen" ? "Bezig…" : "Heropenen"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* T6-1A: in leesmodus schakelt de fieldset alle formuliercontrols
          (inputs, textareas, selects, knoppen) native uit — zichtbaar maar
          niet bedienbaar. Navigatielinks (agendapunten) blijven werken. */}
      <fieldset disabled={alleenLezen} className="min-w-0 border-0 p-0 m-0">

      {/* Checklist — WO-3: ingeklapt met samenvatting; items uitklapbaar. */}
      <Sectie
        titel="Checklist"
        samenvatting={checklistSamenvatting(checklist)}
        open={checklistOpen}
        onToggle={() => setChecklistOpen((o) => !o)}
        addLabel={
          kanBeheren && !alleenLezen ? "+ Checklistpunt toevoegen" : undefined
        }
        onAdd={
          kanBeheren && !alleenLezen
            ? () => {
                setChecklistOpen(true);
                setChecklistForm((f) => !f);
              }
            : undefined
        }
      >
        {checklistForm && kanBeheren && !alleenLezen && (
          <form
            onSubmit={checklistToevoegen}
            className="mb-3 p-3 border border-accent/40 bg-accent-tint rounded-lg space-y-2"
          >
            <input
              type="text"
              value={checklistLabel}
              onChange={(e) => setChecklistLabel(e.target.value)}
              placeholder="Nieuw checklistpunt, bv. 'Toets keuzebegeleiding op begrijpelijkheid'"
              className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none bg-white"
            />
            <label className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={checklistBewijsVereist}
                onChange={(e) => setChecklistBewijsVereist(e.target.checked)}
                className="accent-accent w-4 h-4 rounded"
              />
              Bewijs vereist
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setChecklistForm(false);
                  setChecklistLabel("");
                  setChecklistBewijsVereist(false);
                }}
                className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent bg-white"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={bezig === "checklist-toevoegen"}
                className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-ink disabled:opacity-50"
              >
                {bezig === "checklist-toevoegen" ? "Bezig…" : "Toevoegen"}
              </button>
            </div>
          </form>
        )}
        {checklist.length === 0 ? (
          <div className="text-sm text-muted italic">Geen checklist-items.</div>
        ) : (
          <div className="space-y-2">
            {checklist.map((c) => (
              <ChecklistRij
                key={c.id}
                c={c}
                alleenLezen={alleenLezen}
                onToggle={checklistToggle}
              />
            ))}
          </div>
        )}
      </Sectie>

      {/* Bewijsstukken — WO-3: vereist-gedreven (evidence-unie), ingeklapt.
          Elk item uitklapbaar; "Opvoeren" hergebruikt het bewijs-formulier.
          Daaronder de reeds opgevoerde stukken (koppelen/verwijderen). */}
      <Sectie
        titel="Bewijsstukken"
        samenvatting={bewijsstukkenSamenvatting(stapEvidence)}
        open={bewijsOpen}
        onToggle={() => setBewijsOpen((o) => !o)}
        addLabel={!alleenLezen ? "+ Bewijsstuk toevoegen" : undefined}
        onAdd={
          !alleenLezen
            ? () => {
                setBewijsOpen(true);
                setBewijsForm((f) => !f);
              }
            : undefined
        }
      >
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

        {/* Vereist-gedreven lijst (de gevraagde bewijslast voor deze stap). */}
        {stapEvidence.length > 0 ? (
          <div className="space-y-2">
            {stapEvidence.map((r, i) => (
              <BewijsstukRij
                key={`${r.requirement_type}-${r.label}-${i}`}
                r={r}
                alleenLezen={alleenLezen}
                onOpvoeren={() => opvoerenVanuitVereiste(r)}
              />
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted italic">
            Geen formele bewijslast gedefinieerd voor deze stap.
          </div>
        )}

        {/* Reeds opgevoerde stukken (koppelen/verwijderen blijven hier). */}
        {bewijs.length > 0 && (
          <div className="mt-4 pt-3 border-t border-line">
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-2">
              Opgevoerde stukken
            </div>
            <div className="space-y-2">
              {bewijs.map((b) => {
                const gepland = !b.document_id;
                const magVerwijderen =
                  kanBeheren ||
                  (!!currentUserId && b.toegevoegd_door === currentUserId);
                return (
                  <div
                    key={b.id}
                    className="flex items-start gap-3 p-3 border border-line rounded-lg"
                  >
                    <div
                      className={`w-9 h-10 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                        gepland
                          ? "bg-app-bg text-muted border border-dashed border-app-line-strong"
                          : "bg-err-tint text-err-ink"
                      }`}
                    >
                      {gepland ? "—" : "PDF"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink flex items-center gap-2 flex-wrap">
                        {b.titel}
                        {gepland && (
                          <span className="text-[10px] uppercase tracking-wide text-warn-ink bg-warn-tint border border-warn/30 px-1.5 py-0.5 rounded">
                            Nog te leveren
                          </span>
                        )}
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
                      {!alleenLezen && (gepland || magVerwijderen) && (
                        <div className="flex items-center gap-3 mt-2">
                          {gepland && (
                            <button
                              type="button"
                              onClick={() => setKoppelDoelId(b.id)}
                              disabled={bezig === `bewijs-koppel-${b.id}`}
                              className="text-xs text-accent hover:underline disabled:opacity-50"
                            >
                              {bezig === `bewijs-koppel-${b.id}`
                                ? "Bezig…"
                                : "Document koppelen"}
                            </button>
                          )}
                          {magVerwijderen && (
                            <button
                              type="button"
                              onClick={() => bewijsVerwijderen(b.id)}
                              disabled={bezig === `bewijs-del-${b.id}`}
                              className="text-xs text-err-ink hover:underline disabled:opacity-50"
                            >
                              {bezig === `bewijs-del-${b.id}`
                                ? "Bezig…"
                                : "Verwijderen"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* WO-2 (D7): een instantie-bewijslasttype toevoegen aan deze lopende
            stap. Rendert alleen bij voorzitter/beheerder (VereisteToevoegen
            geeft anders null terug); de harde gate zit server-side. */}
        {!alleenLezen && (
          <div className="mt-3">
            <VereisteToevoegen
              procedureId={procedureId}
              stapVolgorde={stap.volgorde}
              kanBeheren={kanBeheren}
            />
          </div>
        )}
      </Sectie>

      {/* Vergaderingen — WO-3: ingeklapt met samenvatting. */}
      <Sectie
        titel="Vergaderingen"
        samenvatting={vergaderingenSamenvatting(gekoppeldeAgendapunten.length)}
        open={vergaderingOpen}
        onToggle={() => setVergaderingOpen((o) => !o)}
        addLabel={
          !alleenLezen && komendeVergaderingen.length > 0
            ? "+ Voeg toe aan vergadering"
            : undefined
        }
        onAdd={
          !alleenLezen && komendeVergaderingen.length > 0
            ? () => {
                setVergaderingOpen(true);
                setVergaderingForm(true);
              }
            : undefined
        }
      >
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
                <span className="text-xs text-ink hover:underline">Open →</span>
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
      </Sectie>

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

      {/* Voltooien — alleen de knop; wat nog ontbreekt staat als tooltip.
          De blokkers zelf staan hierboven (checklist, bewijs, besluit). */}
      <div className="mt-6 pt-5 border-t border-line flex items-center justify-end">
        <button
          onClick={stapVoltooien}
          disabled={!kanVoltooien || bezig === "voltooien"}
          title={
            kanVoltooien
              ? "Alle vereisten voldaan"
              : `Nog nodig: ${[
                  !allesVoldaan
                    ? `${totaalCount - voldaanCount} checklist-item${
                        totaalCount - voldaanCount === 1 ? "" : "s"
                      }`
                    : null,
                  bewijsVereist > 0 && !heeftBewijs ? "bewijsstuk" : null,
                  stap.vereist_besluit && !besluit ? "besluit" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}`
          }
          className={`px-4 py-2 text-sm rounded-lg font-medium ${
            kanVoltooien
              ? "bg-accent text-white hover:bg-accent-ink"
              : "bg-app-line text-muted cursor-not-allowed"
          }`}
        >
          {bezig === "voltooien" ? "Bezig…" : "Stap voltooien"}
        </button>
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

      {/* WO-2-vervolg: picker om een document te koppelen aan een vooraf
          opgegeven ("Nog te leveren") bewijsstuk. */}
      {koppelDoelId && (
        <BibliotheekPicker
          onSelect={(id) => {
            const doelId = koppelDoelId;
            if (doelId) bewijsKoppelen(doelId, id);
          }}
          onClose={() => setKoppelDoelId(null)}
        />
      )}
    </div>
  );
}
