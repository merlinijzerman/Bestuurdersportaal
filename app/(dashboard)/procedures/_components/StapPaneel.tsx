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
import BibliotheekPicker from "@/core/components/BibliotheekPicker";
import VereisteToevoegen from "./VereisteToevoegen";
import VereisteKiezer from "./VereisteKiezer";
import VaststellingFormulier from "./VaststellingFormulier";
import { magLosmaken, magKoppelen, redenGeenKoppelAffordance } from "@/core/lib/vereiste-affordance";
import { uploadDocument } from "@/core/lib/document-upload-client";
import { DOCUMENTTYPEN, DOCUMENTTYPE_LABEL } from "@/core/lib/document-metadata";
import { bewijsUploadDocumenttypeBlokker } from "@/core/lib/document-ingest-classificatie";
import {
  BINDBARE_REQUIREMENT_TYPES,
  requirementSleutel,
} from "@/core/lib/requirement-sleutel";
import { zwaarteVanVereiste } from "@/core/lib/requirement-zwaarte";
import { MIN_MOTIVERING_LENGTE } from "@/core/lib/afwijking";
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

// #192: de affordance-tekst per type (kiezer/opvoeren/vastleggen). Eén knop per
// vereisteregel; de tekst volgt het type (mockup v0.1).
const ACTIE_LABEL: Record<string, string> = {
  document: "Opvoeren",
  external_submission: "Opvoeren",
  consultation: "Opvoeren",
  risk: "Koppel bestaand risico",
  assumption: "Koppel aannames",
  kpi: "Koppel KPI",
  approval: "Koppel besluit",
  // evaluation/ai_validation staan bewust NIET in ACTIE_LABEL: zij hebben geen
  // vervullingspad (besluit 0195) en tonen een uitgeschakelde affordance mét reden,
  // geen actieve koppelknop.
  dissent_review: "Leg vast",
  mandate_check: "Leg vast",
};

// P2/PR-B (#167): herkomst van een vervulling — welk gebonden feit de vereiste
// afvinkt (0189, D10). Spiegelt EvidenceItem.bron_type.
const HERKOMST_LABELS: Record<string, string> = {
  procedure_bewijs: "Bewijsstuk",
  ai_output: "AI-validatie",
  assumption: "Aanname",
  risk: "Risico",
  condition: "KPI/voorwaarde",
  evaluation: "Evaluatie",
  procedure_besluit: "Besluit",
  procedure_vaststelling: "Vaststelling",
  governance_event: "Governance-event",
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
  /** P3 (#168, §5.1): mag deze gebruiker een afwijking vastleggen bij het
      afronden (capability procedures.afwijking.vastleggen — voorzitter/bestuurder)?
      UI-signaal; de harde gate zit server-side in de route én in de DB-functie.
      Bewust NIET kanBeheren hergebruiken: bestuurder draagt de capability wél maar
      is geen kanBeheren (voorzitter/beheerder). */
  magAfwijkingVastleggen?: boolean;
  /** Id van de ingelogde gebruiker — bepaalt of de verwijder-knop op een
      eigen bewijsstuk zichtbaar is (server-side check blijft leidend). */
  currentUserId?: string;
  /** P1a (#165): fase van deze stap, voor de context op het tabblad Overzicht.
      Puur presentatie; komt uit de per fonds overschrijfbare fasetitels/-tekst. */
  fase?: { code: string; titel: string; beschrijving: string | null } | null;
  /** #192: staat het besluit "op slot" (I1)? Bepaalt of losmaken vergrendeld is
      met reden. UI-signaal — de harde gate zit server-side in de koppelroute. */
  besluitOpSlot?: boolean;
}

function formatDatumKort(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Sectie (WO-3 / P1a) ──────────────────────────────────────────────────────
// P1a (#165): Checklist / Bewijsstukken / Vergaderingen / Besluit zijn tabs
// geworden. Binnen een tab staat de sectie `statisch` open — geen collapse-chrome
// meer, maar wél de kop met samenvatting en de "+ toevoegen"-affordance (mockup
// `sectiekop`). De oude ingeklapte variant (`open`/`onToggle`) blijft bestaan
// voor eventueel hergebruik buiten de tabs.
function Sectie({
  titel,
  samenvatting,
  open,
  onToggle,
  statisch = false,
  addLabel,
  onAdd,
  children,
}: {
  titel: string;
  samenvatting: string;
  open?: boolean;
  onToggle?: () => void;
  statisch?: boolean;
  addLabel?: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  const toon = statisch ? true : !!open;
  return (
    <div className="mt-2">
      {statisch ? (
        <div className="flex items-center gap-2">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
            {titel}
          </div>
          <span className="text-[11px] text-muted">· {samenvatting}</span>
          {addLabel && onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="ml-auto text-xs text-accent hover:underline"
            >
              {addLabel}
            </button>
          )}
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle?.();
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
      )}
      {toon && <div className="mt-3">{children}</div>}
    </div>
  );
}

// P1a (#165): tabs van het stapdetail.
type StapTab = "overzicht" | "checklist" | "bewijs" | "vergaderingen" | "besluit";

// ── Uitklapbaar checklistpunt (WO-3) ─────────────────────────────────────────
// De toelichting per checklistpunt bestaat nog niet als data (OB-E10, aparte
// data-WO); tot dan toont de body de eerlijke lege staat. Bewerken van de
// toelichting volgt met die data-WO — daarom hier bewust geen dode edit-knop.
function ChecklistRij({
  c,
  alleenLezen,
  kanBeheren,
  onToggle,
  onVerwijderen,
  bezigDel,
}: {
  c: ChecklistItem;
  alleenLezen: boolean;
  kanBeheren: boolean;
  onToggle: (c: ChecklistItem) => void;
  onVerwijderen: (c: ChecklistItem, reden: string) => void;
  bezigDel: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [verwijderOpen, setVerwijderOpen] = useState(false);
  const [reden, setReden] = useState("");
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

          {/* Verwijderen (soft-deactivate, append-only) — alleen voorzitter/
              beheerder, met verplichte toelichting. */}
          {kanBeheren && !alleenLezen && (
            <div className="mt-2">
              {!verwijderOpen ? (
                <button
                  type="button"
                  onClick={() => setVerwijderOpen(true)}
                  className="text-[11px] text-err-ink hover:underline"
                >
                  Checklistpunt verwijderen
                </button>
              ) : (
                <div className="space-y-2 border border-err/30 bg-err-tint rounded-md p-2.5">
                  <label className="block text-[11px] uppercase tracking-wide text-err-ink font-semibold">
                    Toelichting bij verwijderen <span aria-hidden>*</span>
                  </label>
                  <textarea
                    rows={2}
                    value={reden}
                    onChange={(e) => setReden(e.target.value)}
                    placeholder="Waarom is dit checklistpunt niet van toepassing?"
                    className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none resize-none bg-white"
                  />
                  <p className="text-[11px] text-muted">
                    Het punt wordt uit beeld gehaald (append-only, gelogd) — geen
                    harde verwijdering.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setVerwijderOpen(false);
                        setReden("");
                      }}
                      className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent bg-white"
                    >
                      Annuleren
                    </button>
                    <button
                      type="button"
                      disabled={bezigDel || !reden.trim()}
                      onClick={() => onVerwijderen(c, reden.trim())}
                      className="text-xs px-3 py-1.5 bg-err text-white rounded hover:brightness-110 disabled:opacity-50"
                    >
                      {bezigDel ? "Bezig…" : "Verwijderen"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
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
  kanBeheren,
  slotAan,
  onKoppelen,
  onVerwijderen,
  onOntkoppelen,
  bezigOntkoppelId,
  bezigDel,
}: {
  r: EvidenceItem;
  alleenLezen: boolean;
  kanBeheren: boolean;
  slotAan: boolean;
  onKoppelen: (r: EvidenceItem) => void;
  onVerwijderen: (r: EvidenceItem, reden: string) => void;
  onOntkoppelen: (r: EvidenceItem, feitId: string) => void;
  bezigOntkoppelId: string | null;
  bezigDel: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [verwijderOpen, setVerwijderOpen] = useState(false);
  const [reden, setReden] = useState("");
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
        {(() => {
          const aantal = r.gebonden_feiten.length;
          const nogNodig = Math.max(0, r.min_aantal - aantal);
          // Status: vervuld / deels (bij min_aantal>1) / open.
          const status = r.vervuld
            ? {
                cls: "text-ok-ink bg-ok-tint",
                tekst:
                  r.min_aantal > 1
                    ? aantal > r.min_aantal
                      ? `Vervuld · ${aantal} gekoppeld`
                      : `Vervuld · ${aantal} van ${r.min_aantal}`
                    : "Vervuld",
              }
            : aantal > 0
              ? { cls: "text-warn-ink bg-warn-tint", tekst: `${aantal} van ${r.min_aantal}` }
              : { cls: "text-muted bg-app-line", tekst: "Open" };
          const koppelbaar = magKoppelen({
            type: r.requirement_type,
            kanBeheren,
            alleenLezen,
            slotAan,
          });
          // Typen zonder vervullingspad (evaluation, ai_validation — besluit 0195):
          // geen actieve knop, maar de affordance uitgeschakeld MÉT reden i.p.v.
          // niets, zodat de gebruiker niet hoeft te raden waarom er niets kan.
          const redenGeenPad = redenGeenKoppelAffordance(r.requirement_type);
          // Knop-tekst: nog niet genoeg → type-actie; genoeg/over → "Nog een toevoegen".
          const knopTekst = nogNodig > 0 ? ACTIE_LABEL[r.requirement_type] ?? "Koppelen" : "Nog een toevoegen";
          return (
            <div className="flex flex-col items-end gap-1.5 shrink-0 min-w-[150px]">
              <span className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap ${status.cls}`}>
                {status.tekst}
              </span>
              {/* magKoppelen dekt de field/alleen-lezen/beheer-poort én de typen
                  zonder vervullingspad; die laatste krijgen een reden i.p.v. niets. */}
              {koppelbaar ? (
                <button
                  type="button"
                  onClick={() => onKoppelen(r)}
                  className="border border-app-line-control rounded-lg px-3 py-1.5 text-[12.5px] font-medium bg-white text-ink hover:bg-accent-tint hover:border-accent whitespace-nowrap"
                >
                  {knopTekst}
                </button>
              ) : (
                redenGeenPad && kanBeheren && !alleenLezen && (
                  <span
                    className="text-[11px] text-muted italic text-right max-w-[150px] leading-tight"
                    title={`${redenGeenPad} Zie besluit 0195 (requirement-type zonder vervullingspad).`}
                  >
                    {redenGeenPad}
                  </span>
                )
              )}
              {nogNodig > 0 && r.min_aantal > 1 && (
                <span className="text-[11px] text-muted text-right max-w-[150px] leading-tight">
                  Nog {nogNodig} nodig
                </span>
              )}
            </div>
          );
        })()}
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
            {/* Field-uitzondering (classificatie/veld): geen gebonden feit maar een
                veld/governance-event — toon de tekstuele herkomst, geen losmaken. */}
            {r.vervuld && r.gebonden_feiten.length === 0 && r.bron_titel && (
              <p className="text-[13px] text-ok-ink mt-2">
                Herkomst: <span className="font-medium">{r.bron_titel}</span>
              </p>
            )}
            {/* #192: het volledige herkomst-spoor — elk gebonden feit met datum en
                persoon, met per-feit losmaken (deur (a) van I1). Onder een besloten
                besluit is losmaken vergrendeld mét reden i.p.v. een kale 409. */}
            {r.gebonden_feiten.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
                  Herkomst
                </div>
                {r.gebonden_feiten.map((f) => {
                  const meta = [f.datum, f.actor].filter(Boolean).join(" · ");
                  // Toon de beheerregel als er in principe iets te beheren valt;
                  // magLosmaken beslist of het echt kan (onder slot: nee → vergrendeld).
                  const toonBeheer =
                    kanBeheren && !alleenLezen && f.bron_type !== "governance_event";
                  const losmaakbaar = magLosmaken({
                    slotAan,
                    kanBeheren,
                    alleenLezen,
                    bronType: f.bron_type,
                  });
                  return (
                    <div
                      key={f.id}
                      className="flex items-start justify-between gap-3 text-[13px]"
                    >
                      <span className="text-ok-ink min-w-0">
                        ✓ {f.titel ?? (f.bron_type ? HERKOMST_LABELS[f.bron_type] : null) ?? "vastgelegd"}
                        {meta && <span className="text-muted font-normal"> · {meta}</span>}
                      </span>
                      {toonBeheer &&
                        (losmaakbaar ? (
                          <button
                            type="button"
                            onClick={() => onOntkoppelen(r, f.id)}
                            disabled={bezigOntkoppelId === f.id}
                            className="text-[11px] text-err-ink hover:underline shrink-0 disabled:opacity-50"
                          >
                            {bezigOntkoppelId === f.id ? "Bezig…" : "Losmaken"}
                          </button>
                        ) : (
                          <span className="text-[11px] text-muted italic shrink-0">
                            vergrendeld
                          </span>
                        ))}
                    </div>
                  );
                })}
                {slotAan && (
                  <p className="text-[11px] text-muted">
                    Vergrendeld — het besluit is genomen. Losmaken kan pas na heropenen.
                  </p>
                )}
              </div>
            )}
            {!r.vervuld && r.documenttype && (
              <p className="text-[13px] text-muted mt-2">
                Vereist documenttype:{" "}
                <span className="font-mono text-ink">{r.documenttype}</span>
              </p>
            )}
          </div>

          {/* Verwijderen — standaardset-vereiste: per-proces uitsluiten (de
              generieke set blijft onaangeroerd); zelf-toegevoegde vereiste:
              soft-deactivate. Beide met verplichte toelichting, gegate op
              voorzitter/beheerder. */}
          {kanBeheren && !alleenLezen && (
            <div className="mt-2">
              {!verwijderOpen ? (
                <button
                  type="button"
                  onClick={() => setVerwijderOpen(true)}
                  className="text-[11px] text-err-ink hover:underline"
                >
                  Bewijsstuk verwijderen
                </button>
              ) : (
                <div className="space-y-2 border border-err/30 bg-err-tint rounded-md p-2.5">
                  <label className="block text-[11px] uppercase tracking-wide text-err-ink font-semibold">
                    Toelichting bij verwijderen <span aria-hidden>*</span>
                  </label>
                  <textarea
                    rows={2}
                    value={reden}
                    onChange={(e) => setReden(e.target.value)}
                    placeholder="Waarom is dit bewijsstuk niet van toepassing voor dit proces?"
                    className="w-full border border-line rounded px-2 py-1.5 text-sm focus:border-accent outline-none resize-none bg-white"
                  />
                  <p className="text-[11px] text-muted">
                    {r.bron === "template"
                      ? "Alleen voor dít proces uitgesloten — de generieke set blijft onaangeroerd. Append-only, gelogd en terug te draaien."
                      : "Deze zelf toegevoegde vereiste wordt gedeactiveerd (append-only, gelogd)."}
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setVerwijderOpen(false);
                        setReden("");
                      }}
                      className="text-xs px-3 py-1.5 border border-line rounded hover:border-accent bg-white"
                    >
                      Annuleren
                    </button>
                    <button
                      type="button"
                      disabled={bezigDel || !reden.trim()}
                      onClick={() => onVerwijderen(r, reden.trim())}
                      className="text-xs px-3 py-1.5 bg-err text-white rounded hover:brightness-110 disabled:opacity-50"
                    >
                      {bezigDel ? "Bezig…" : "Verwijderen"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
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
  magAfwijkingVastleggen = false,
  currentUserId = "",
  fase = null,
  besluitOpSlot = false,
}: Props) {
  const router = useRouter();
  const slotAan = besluitOpSlot;
  // #192: welke vereiste heeft de kiezer / het vaststellingsformulier open.
  const [kiezerVereiste, setKiezerVereiste] = useState<EvidenceItem | null>(null);
  const [vastformVereiste, setVastformVereiste] = useState<EvidenceItem | null>(null);
  // P1a (#165): actief tabblad. Landingstabblad = Overzicht (mockup-default);
  // of Checklist beter past voor een actieve stap is bewust een open punt
  // (zie 00 Overzicht en status/openstaande-punten-en-risicos.md).
  const [tab, setTab] = useState<StapTab>("overzicht");
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
  // Bewijsbinding: welk vereiste vervult het stuk dat we nu opvoeren?
  // Zonder binding telt een bewijsstuk niet mee voor readiness — daarom staat
  // de keuze expliciet in het formulier en niet impliciet in een tag.
  const [bewijsVereiste, setBewijsVereiste] = useState<EvidenceItem | null>(null);
  // 3-D: bibliotheek-picker — kiezen uit bestaande documenten i.p.v. uploaden.
  // Houdt de uploadflow ongewijzigd; deze state is exclusief actief.
  const [bewijsBibliotheekId, setBewijsBibliotheekId] = useState<string | null>(null);
  const [bewijsBibliotheekTitel, setBewijsBibliotheekTitel] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [besluitForm, setBesluitForm] = useState(false);
  const [besluitFormulering, setBesluitFormulering] = useState("");
  const [besluitMotivering, setBesluitMotivering] = useState("");
  const [besluitUitkomst, setBesluitUitkomst] = useState<
    "instemmend" | "voorwaardelijk" | "afwijzend" | ""
  >("");
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
  // P3 (#168, §5.1): afronden met afwijking — het motiveringsformulier onder de
  // afrondknop, en de expliciete bevestiging bij een openstaande kritieke vereiste.
  const [afwijkingForm, setAfwijkingForm] = useState(false);
  const [afwijkingMotivering, setAfwijkingMotivering] = useState("");
  const [afwijkingBevestigd, setAfwijkingBevestigd] = useState(false);
  // Als de SERVER om bevestiging vraagt (409) terwijl de client geen kritieke
  // vereiste zag (client- en server-zwaarte kunnen afwijken), tonen we het
  // bevestigingsvakje alsnog — anders zou elke retry vastlopen op 409.
  const [serverVraagtBevestiging, setServerVraagtBevestiging] = useState(false);
  // WO-2 (D7): handmatig checklistpunt toevoegen aan een lopende stap.
  const [checklistForm, setChecklistForm] = useState(false);
  const [checklistLabel, setChecklistLabel] = useState("");
  const [checklistBewijsVereist, setChecklistBewijsVereist] = useState(false);
  // WO-2 (§4.3): een afgeronde stap heropenen (met verplichte motivering).
  const [heropenForm, setHeropenForm] = useState(false);
  const [heropenMotivering, setHeropenMotivering] = useState("");
  // WO-2-vervolg: welk (titel-only) bewijsstuk koppelen we aan een document?
  const [koppelDoelId, setKoppelDoelId] = useState<string | null>(null);
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
  const approvalKandidaten = stapEvidence.filter(
    (e) => e.requirement_type === "approval"
  );
  const besluitApprovalVereiste =
    approvalKandidaten.length === 1 ? approvalKandidaten[0] : null;
  const sleutelVan = (r: EvidenceItem) =>
    requirementSleutel(r.stap_volgorde, r.requirement_type, r.documenttype, r.label);
  // Vereisten die met een bewijsstuk vervuld kunnen worden — dezelfde const
  // als de server gebruikt. Dubbele sleutels blijven bewust buiten de picker:
  // de DB/readiness-gate faalt daar gesloten en de UI mag niet suggereren dat
  // een willekeurige van beide veilig gekozen kan worden.
  const bindbareKandidaten = stapEvidence.filter((e) =>
    (BINDBARE_REQUIREMENT_TYPES as readonly string[]).includes(
      e.requirement_type
    )
  );
  const sleutelAantallen = new Map<string, number>();
  for (const r of bindbareKandidaten) {
    const sleutel = sleutelVan(r);
    sleutelAantallen.set(sleutel, (sleutelAantallen.get(sleutel) ?? 0) + 1);
  }
  const bindbareVereisten = bindbareKandidaten.filter(
    (r) => sleutelAantallen.get(sleutelVan(r)) === 1
  );
  const labelBijSleutel = new Map(
    bindbareVereisten.map((r) => [sleutelVan(r), r.label])
  );
  const vereisteAlsPayload = (r: EvidenceItem) => ({
    stap_volgorde: r.stap_volgorde,
    requirement_type: r.requirement_type,
    documenttype: r.documenttype,
    label: r.label,
  });

  // #192: één affordance per vereisteregel — routeer naar de juiste flow op type.
  function koppelenVanuitVereiste(r: EvidenceItem) {
    switch (r.requirement_type) {
      case "document":
      case "external_submission":
      case "consultation":
        opvoerenVanuitVereiste(r); // bestaande upload-flow (Opvoeren)
        return;
      case "dissent_review":
      case "mandate_check":
        setVastformVereiste(r); // objectloos → vaststellingsformulier
        return;
      case "field":
      case "evaluation":
        return; // geen koppel-affordance (veld / doodlopend #198)
      default:
        setKiezerVereiste(r); // risk/assumption/kpi/approval/ai_validation → kiezer
    }
  }

  // P2/PR-B (#167), #192: ontkoppelen (deur a) via de ene koppelroute per gebonden
  // feit. De route weigert onder een besloten besluit (I1) met een nette 409; onder
  // slot toont de UI 'vergrendeld' i.p.v. de knop.
  async function ontkoppelVereiste(r: EvidenceItem, feitId: string) {
    setFout(null);
    setBezig(`ontkoppel-${feitId}`);
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/vereisten/koppel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actie: "ontkoppel",
            vereiste: vereisteAlsPayload(r),
            bron_id: feitId,
          }),
        }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setFout(data.error ?? "Losmaken mislukt");
        return;
      }
      router.refresh();
    } catch (err) {
      setFout(err instanceof Error ? err.message : "Losmaken mislukt");
    } finally {
      setBezig(null);
    }
  }

  const voldaanCount = checklist.filter((c) => c.voldaan).length;
  const totaalCount = checklist.length;
  const allesVoldaan = totaalCount > 0 && voldaanCount === totaalCount;
  const bewijsVereist = checklist.filter((c) => c.bewijs_vereist).length;
  const heeftBewijs = bewijs.length > 0;
  const kanVoltooien =
    allesVoldaan &&
    (bewijsVereist === 0 || heeftBewijs) &&
    (!stap.vereist_besluit || besluit !== null);

  // P1a (#165): tab-badges. Zwaarte komt van de VEREISTE (blokkerend→kritiek,
  // verplicht→vereist) via de enige afleidfunctie (swap-punt voor #168).
  const bewijsTot = stapEvidence.length;
  const bewijsVervuld = stapEvidence.filter((e) => e.vervuld).length;
  const kritiekOpen = stapEvidence.filter(
    (e) => !e.vervuld && zwaarteVanVereiste(e) === "kritiek"
  ).length;
  const vereistOpen = stapEvidence.filter(
    (e) => !e.vervuld && zwaarteVanVereiste(e) === "vereist"
  ).length;
  // P3 (#168, §5.1): afronden-met-afwijking is een optie zodra er iets openstaat
  // bóven optioneel en de gebruiker de capability draagt. Het normale "Stap
  // voltooien" blijft in PR-C ongewijzigd bestaan; de telling die de normale
  // afronding hierop blokkeert is §5.2 → P4. De open items komen uit stapEvidence.
  const afwijkingMogelijk =
    stap.status !== "afgerond" &&
    !alleenLezen &&
    magAfwijkingVastleggen &&
    kritiekOpen + vereistOpen > 0;
  const openBovenOptioneel = stapEvidence.filter(
    (e) => !e.vervuld && zwaarteVanVereiste(e) !== "optioneel"
  );

  // "Nog open" voor de vaste voettekstbalk — dezelfde blokkers als kanVoltooien,
  // nu permanent zichtbaar i.p.v. alleen als tooltip. P1a wijzigt het afrond-
  // gedrag NIET (afronden-met-afwijking is #168); dit toont alleen wat er staat.
  const nogOpen = [
    !allesVoldaan
      ? `${totaalCount - voldaanCount} checklistpunt${
          totaalCount - voldaanCount === 1 ? "" : "en"
        }`
      : null,
    bewijsVereist > 0 && !heeftBewijs ? "een bewijsstuk" : null,
    stap.vereist_besluit && !besluit ? "het formele besluit" : null,
  ].filter(Boolean) as string[];

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

  // WO-3-vervolg: checklistpunt verwijderen = soft-deactivate (actief=false),
  // append-only, met verplichte toelichting. Server-side gegate op
  // voorzitter/beheerder. Het punt verdwijnt uit beeld (blijft in het spoor).
  async function checklistVerwijderen(item: ChecklistItem, reden: string) {
    if (alleenLezen || !kanBeheren) return;
    setFout(null);
    setBezig(`checklist-del-${item.id}`);
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/checklist/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actief: false, reden }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Verwijderen mislukt");
      }
      setChecklist((huidig) => huidig.filter((c) => c.id !== item.id));
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Verwijderen mislukt");
    } finally {
      setBezig(null);
    }
  }

  // Eén resetpunt voor het bewijsformulier. Belangrijk voor de binding: bleef
  // `bewijsVereiste` na annuleren staan, dan opende een volgende "+ Bewijsstuk
  // toevoegen" met de vereiste van de vórige poging nog geselecteerd — een
  // voorspelbare misbinding.
  function resetBewijsForm() {
    setBewijsTitel("");
    setBewijsBeschrijving("");
    setBewijsBestand(null);
    setBewijsDocumenttype("");
    setBewijsVereiste(null);
    setBewijsMetadataType("");
    setBewijsBibliotheekId(null);
    setBewijsBibliotheekTitel("");
    setBewijsForm(false);
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
          // Bewijsbinding: welke vereiste dit stuk vervult. De server leidt de
          // sleutel af en verifieert dat de vereiste bestaat.
          vereiste: bewijsVereiste ? vereisteAlsPayload(bewijsVereiste) : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Toevoegen mislukt");
      }
      const data = await res.json();
      setBewijs([data.bewijs as Bewijs, ...bewijs]);
      resetBewijsForm();
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
    if (!besluitUitkomst) {
      setFout("Kies de uitkomst van het besluit.");
      return;
    }
    if (!besluitApprovalVereiste) {
      setFout(
        approvalKandidaten.length === 0
          ? "Deze besluitstap heeft geen approval-vereiste om het besluit aan te binden."
          : "Deze besluitstap heeft meerdere approval-vereisten; maak de binding eerst eenduidig."
      );
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
          uitkomst: besluitUitkomst,
          vereiste: vereisteAlsPayload(besluitApprovalVereiste),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Vastleggen mislukt");
      }
      setBesluitForm(false);
      setBesluitFormulering("");
      setBesluitMotivering("");
      setBesluitUitkomst("");
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

  // P3 (#168, §5.1): afronden met afwijking. De server (route + DB-functie) is
  // leidend; bij een openstaande kritieke vereiste eist hij bevestiging (409).
  // De UI vraagt die bevestiging vooraf omdat ze kritiekOpen zelf al kent.
  async function afwijkingVastleggen() {
    if (alleenLezen) return;
    setFout(null);
    setBezig("afwijking");
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/stappen/${stap.id}/afwijking`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            motivering: afwijkingMotivering,
            bevestigd: afwijkingBevestigd,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.bevestiging_vereist) {
        // Server vraagt expliciete bevestiging bij een kritieke vereiste. Toon het
        // vakje ook als de client zelf geen kritieke vereiste zag.
        setAfwijkingBevestigd(false);
        setServerVraagtBevestiging(true);
        setFout(data.error || "Bevestig expliciet om af te ronden.");
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || "Afronden met afwijking mislukt");
      }
      if (data.waarschuwing) setMelding(data.waarschuwing);
      setAfwijkingForm(false);
      setAfwijkingMotivering("");
      setAfwijkingBevestigd(false);
      setServerVraagtBevestiging(false);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Afronden met afwijking mislukt");
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
  // vereiste als titel + documenttype-tag. De binding zelf wordt hier gezet:
  // titel en tag zijn suggesties, de binding is wat readiness bepaalt.
  function opvoerenVanuitVereiste(r: EvidenceItem) {
    setTab("bewijs");
    setBewijsForm(true);
    setBewijsVereiste(r);
    if (!bewijsTitel.trim()) setBewijsTitel(r.label);
    if (r.documenttype) setBewijsDocumenttype(r.documenttype);
  }

  // Een reeds opgevoerd stuk alsnog aan een vereiste binden of losmaken.
  // Dit is ook het herstelpad voor stukken die de backfill ongebonden liet.
  async function bewijsBindenAanVereiste(bewijsId: string, sleutel: string) {
    if (alleenLezen) return;
    const doel = bindbareVereisten.find((r) => sleutelVan(r) === sleutel);
    if (sleutel && !doel) return;
    setFout(null);
    setBezig(`bewijs-bind-${bewijsId}`);
    try {
      const res = await fetch(
        `/api/procedures/${procedureId}/bewijs/${bewijsId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vereiste: doel ? vereisteAlsPayload(doel) : null,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Koppelen aan vereiste mislukt");
      }
      setBewijs((huidig) =>
        huidig.map((b) =>
          b.id === bewijsId
            ? { ...b, requirement_sleutel: doel ? sleutel : null }
            : b
        )
      );
      router.refresh();
    } catch (err: unknown) {
      setFout(
        err instanceof Error ? err.message : "Koppelen aan vereiste mislukt"
      );
    } finally {
      setBezig(null);
    }
  }

  // WO-3-vervolg: een vereiste verwijderen. Standaardset (bron='template') →
  // per-proces uitsluiten (generieke set onaangeroerd); zelf toegevoegd
  // (bron='instance') → soft-deactivate. Beide met verplichte toelichting.
  const reqDelKey = (r: EvidenceItem) =>
    `req-del-${r.bron}-${r.instance_id ?? ""}-${r.stap_volgorde}-${r.label}`;
  async function bewijsstukVerwijderen(r: EvidenceItem, reden: string) {
    if (alleenLezen || !kanBeheren) return;
    setFout(null);
    setBezig(reqDelKey(r));
    try {
      const res =
        r.bron === "instance" && r.instance_id
          ? await fetch(
              `/api/procedures/${procedureId}/requirements/${r.instance_id}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ actief: false, motivering: reden }),
              }
            )
          : await fetch(
              `/api/procedures/${procedureId}/requirements/uitsluiten`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  stap_volgorde: r.stap_volgorde,
                  requirement_type: r.requirement_type,
                  label: r.label,
                  documenttype: r.documenttype,
                  reden,
                }),
              }
            );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Verwijderen mislukt");
      }
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Verwijderen mislukt");
    } finally {
      setBezig(null);
    }
  }

  // P1a (#165): tab-definities met badge. Kleur van de bewijs-badge volgt de
  // zwaarte: kritiek open → rood, anders vereist open → oranje, anders volledig
  // → groen.
  const tabBadge = (tekst: string, kleur: string) => (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${kleur}`}>{tekst}</span>
  );
  const bewijsBadgeKleur =
    kritiekOpen > 0
      ? "bg-err-tint text-err-ink"
      : vereistOpen > 0
        ? "bg-warn-tint text-warn-ink"
        : bewijsTot > 0 && bewijsVervuld === bewijsTot
          ? "bg-ok-tint text-ok-ink"
          : "bg-app-bg text-muted";
  const TABS: { id: StapTab; label: string; badge: React.ReactNode }[] = [
    { id: "overzicht", label: "Overzicht", badge: null },
    {
      id: "checklist",
      label: "Checklist",
      badge: tabBadge(
        `${voldaanCount}/${totaalCount}`,
        allesVoldaan ? "bg-ok-tint text-ok-ink" : "bg-app-bg text-muted"
      ),
    },
    {
      id: "bewijs",
      label: "Bewijsstukken",
      badge:
        bewijsTot > 0
          ? tabBadge(`${bewijsVervuld}/${bewijsTot}`, bewijsBadgeKleur)
          : null,
    },
    {
      id: "vergaderingen",
      label: "Vergaderingen",
      badge:
        gekoppeldeAgendapunten.length > 0
          ? tabBadge(String(gekoppeldeAgendapunten.length), "bg-app-bg text-muted")
          : null,
    },
    {
      id: "besluit",
      label: "Besluit",
      badge: besluit
        ? tabBadge("✓", "bg-ok-tint text-ok-ink")
        : stap.vereist_besluit
          ? tabBadge("vereist", "bg-err-tint text-err-ink")
          : null,
    },
  ];

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
          <h2 className="text-base font-semibold text-ink mt-1">
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

      {/* P1a (#165): tabbladen. De balk staat BUITEN de leesmodus-fieldset zodat
          tab-switchen ook op een alleen-lezen stap werkt. */}
      <div
        role="tablist"
        aria-label="Stapdetail"
        className="mt-5 flex items-center gap-1 border-b border-line flex-wrap"
      >
        {TABS.map((t) => {
          const actief = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={actief}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-[13px] border-b-2 -mb-px inline-flex items-center gap-1.5 ${
                actief
                  ? "border-accent text-accent font-semibold"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
              {t.badge}
            </button>
          );
        })}
      </div>

      {/* Overzicht — het tabblad met context (toelichting + fase) en de
          stap-brede acties. Bewust BUITEN de fieldset: toelichting en heropenen
          moeten ook op een afgeronde stap door voorzitter/beheerder kunnen. */}
      {tab === "overzicht" && (
        <div className="mt-4">

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
          <p className="text-[13px] text-muted max-w-2xl">{stap.beschrijving}</p>
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

      {/* P1a (#165): fasecontext op het tabblad Overzicht. */}
      {fase && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">
            Fase
          </div>
          <p className="text-[13px] text-ink max-w-2xl">
            <b>
              Fase {fase.code} — {fase.titel}.
            </b>{" "}
            {fase.beschrijving ?? ""}
          </p>
        </div>
      )}
        </div>
      )}

      {/* T6-1A: in leesmodus schakelt de fieldset alle formuliercontrols
          (inputs, textareas, selects, knoppen) native uit — zichtbaar maar
          niet bedienbaar. Navigatielinks (agendapunten) blijven werken. */}
      <fieldset disabled={alleenLezen} className="min-w-0 border-0 p-0 m-0">

      {/* Checklist (P1a: tabblad). */}
      {tab === "checklist" && (
      <Sectie
        titel="Checklist"
        samenvatting={checklistSamenvatting(checklist)}
        statisch
        addLabel={
          kanBeheren && !alleenLezen ? "+ Checklistpunt toevoegen" : undefined
        }
        onAdd={
          kanBeheren && !alleenLezen
            ? () => setChecklistForm((f) => !f)
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
                kanBeheren={kanBeheren}
                onToggle={checklistToggle}
                onVerwijderen={checklistVerwijderen}
                bezigDel={bezig === `checklist-del-${c.id}`}
              />
            ))}
          </div>
        )}
      </Sectie>
      )}

      {/* Bewijsstukken (P1a: tabblad) — vereist-gedreven (evidence-unie).
          Elk item uitklapbaar; "Opvoeren" hergebruikt het bewijs-formulier.
          Daaronder de reeds opgevoerde stukken (koppelen/verwijderen). */}
      {tab === "bewijs" && (
      <Sectie
        titel="Bewijsstukken"
        samenvatting={bewijsstukkenSamenvatting(stapEvidence)}
        statisch
        addLabel={!alleenLezen ? "+ Bewijsstuk toevoegen" : undefined}
        onAdd={
          !alleenLezen
            ? () => {
                if (bewijsForm) resetBewijsForm();
                else setBewijsForm(true);
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
            {/* Bewijsbinding: welk vereiste vervult dit stuk? Zonder binding
                telt het stuk niet mee voor de bewijslast — dat zeggen we hier
                expliciet, vóór de handeling (UX-guardrail "maak vereisten en
                blokkers expliciet") in plaats van via een stille uitkomst. */}
            {bindbareVereisten.length > 0 && (
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">
                  Vervult welke vereiste?
                </label>
                <select
                  value={bewijsVereiste ? sleutelVan(bewijsVereiste) : ""}
                  onChange={(e) =>
                    setBewijsVereiste(
                      bindbareVereisten.find(
                        (r) => sleutelVan(r) === e.target.value
                      ) ?? null
                    )
                  }
                  className="w-full border border-line rounded px-2 py-1.5 text-sm bg-white focus:border-accent outline-none"
                >
                  <option value="">— geen vereiste (telt niet mee) —</option>
                  {bindbareVereisten.map((r) => (
                    <option key={sleutelVan(r)} value={sleutelVan(r)}>
                      {r.label}
                      {r.vervuld ? " — al vervuld" : ""}
                    </option>
                  ))}
                </select>
                {!bewijsVereiste && (
                  <p className="text-xs text-muted mt-1">
                    Zonder gekozen vereiste blijft de gevraagde bewijslast op
                    &laquo;nog op te voeren&raquo; staan.
                  </p>
                )}
              </div>
            )}
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
                onClick={resetBewijsForm}
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
                kanBeheren={kanBeheren}
                slotAan={slotAan}
                onKoppelen={koppelenVanuitVereiste}
                onVerwijderen={bewijsstukVerwijderen}
                onOntkoppelen={ontkoppelVereiste}
                bezigOntkoppelId={
                  bezig?.startsWith("ontkoppel-") ? bezig.slice("ontkoppel-".length) : null
                }
                bezigDel={bezig === reqDelKey(r)}
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
                      {/* P1a (#165): "Vraag de AI over dit stuk" — zelfde route
                          als de documentbibliotheek (/ai?doc=…). Alleen bij een
                          gekoppeld document; een titel-only stuk (document_id
                          null) heeft niets om over te vragen. Een <a> blijft ook
                          in de leesmodus-fieldset klikbaar. */}
                      {b.document_id && (
                        <a
                          href={`/ai?doc=${b.document_id}`}
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-1"
                          title="Open de AI-assistent met de vraag beperkt tot dit document"
                        >
                          ✦ Vraag de AI over dit stuk
                        </a>
                      )}
                      {/* Bewijsbinding: welke vereiste vervult dit stuk?
                          Ongebonden stukken tellen niet mee — dat is zichtbaar
                          én ter plekke te herstellen. */}
                      {bindbareVereisten.length > 0 && (
                        <div className="text-xs mt-1">
                          {b.requirement_sleutel &&
                          labelBijSleutel.has(b.requirement_sleutel) ? (
                            <span className="text-muted">
                              Vervult:{" "}
                              <span className="text-ink">
                                {labelBijSleutel.get(b.requirement_sleutel)}
                              </span>
                            </span>
                          ) : b.requirement_sleutel ? (
                            // Wél gebonden, maar de vereiste staat niet in de
                            // lijst: per proces uitgesloten, of weggevallen door
                            // een classificatiewijziging. "Niet gekoppeld" tonen
                            // zou onwaar zijn — en zou de gebruiker verleiden de
                            // bestaande binding stil te overschrijven.
                            <span className="text-muted">
                              Gekoppeld aan een vereiste die hier niet wordt
                              getoond:{" "}
                              <code className="text-ink">
                                {b.requirement_sleutel}
                              </code>
                            </span>
                          ) : (
                            <span className="text-warn-ink">
                              Niet aan een vereiste gekoppeld — telt niet mee
                              voor de bewijslast.
                            </span>
                          )}
                          {!alleenLezen && (
                            <select
                              value={
                                b.requirement_sleutel &&
                                labelBijSleutel.has(b.requirement_sleutel)
                                  ? b.requirement_sleutel
                                  : ""
                              }
                              disabled={bezig === `bewijs-bind-${b.id}`}
                              onChange={(e) =>
                                bewijsBindenAanVereiste(b.id, e.target.value)
                              }
                              className="ml-2 border border-line rounded px-1.5 py-0.5 text-xs bg-white focus:border-accent outline-none disabled:opacity-50"
                              aria-label="Aan vereiste koppelen"
                            >
                              <option value="">— geen vereiste —</option>
                              {bindbareVereisten.map((r) => (
                                <option key={sleutelVan(r)} value={sleutelVan(r)}>
                                  {r.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
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
      )}

      {/* Vergaderingen (P1a: tabblad). */}
      {tab === "vergaderingen" && (
      <Sectie
        titel="Vergaderingen"
        samenvatting={vergaderingenSamenvatting(gekoppeldeAgendapunten.length)}
        statisch
        addLabel={
          !alleenLezen && komendeVergaderingen.length > 0
            ? "+ Voeg toe aan vergadering"
            : undefined
        }
        onAdd={
          !alleenLezen && komendeVergaderingen.length > 0
            ? () => setVergaderingForm(true)
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
      )}

      {/* Besluit (P1a: tabblad). Ook zichtbaar als de stap geen besluit vereist,
          dan met een korte toelichting. */}
      {tab === "besluit" &&
        (stap.vereist_besluit ? (
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
              {besluit.uitkomst && (
                <div className="text-xs text-muted mt-1">
                  Uitkomst: {besluit.uitkomst}
                </div>
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
              <select
                value={besluitUitkomst}
                onChange={(e) =>
                  setBesluitUitkomst(
                    e.target.value as
                      | "instemmend"
                      | "voorwaardelijk"
                      | "afwijzend"
                      | ""
                  )
                }
                className="w-full border border-line rounded px-2 py-1.5 text-sm bg-white focus:border-accent outline-none"
                aria-label="Uitkomst van het besluit"
              >
                <option value="">— kies uitkomst —</option>
                <option value="instemmend">Instemmend</option>
                <option value="voorwaardelijk">Voorwaardelijk</option>
                <option value="afwijzend">Afwijzend</option>
              </select>
              {!besluitApprovalVereiste && (
                <p className="text-xs text-err-ink">
                  {approvalKandidaten.length === 0
                    ? "Geen approval-vereiste gekoppeld aan deze stap."
                    : "Meerdere approval-vereisten gevonden; de besluitbinding is niet eenduidig."}
                </p>
              )}
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
                  disabled={bezig === "besluit" || !besluitUitkomst || !besluitApprovalVereiste}
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
        ) : (
          <div className="mt-4 text-sm text-muted italic">
            Deze stap vereist geen formeel besluit. De uitkomst landt als
            onderbouwing in het dossier.
          </div>
        ))}

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

      {/* Vaste voettekstbalk (P1a #165): wat er nog open staat is nu permanent
          zichtbaar i.p.v. alleen als tooltip. Het afrondgedrag zelf is
          ONGEWIJZIGD — afronden-met-afwijking hoort bij #168. De blokkers zelf
          staan in de tabs hierboven (checklist, bewijs, besluit). */}
      <div className="mt-6 pt-5 border-t border-line flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted min-w-0">
          {stap.status === "afgerond" ? (
            <span className="text-ok-ink">Stap afgerond.</span>
          ) : alleenLezen ? (
            "Stap nog niet gestart — alleen-lezen."
          ) : nogOpen.length > 0 ? (
            <>
              Nog open:{" "}
              <span className="text-ink font-medium">
                {nogOpen.join(" · ")}
              </span>
            </>
          ) : (
            <span className="text-ok-ink">
              Alles voldaan — klaar om af te ronden.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {afwijkingMogelijk && (
            <button
              onClick={() => setAfwijkingForm((o) => !o)}
              disabled={bezig !== null}
              className="px-4 py-2 text-sm rounded-lg font-medium border border-warn/40 text-warn-ink bg-warn-tint hover:bg-warn/10"
            >
              Afronden met afwijking
            </button>
          )}
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
      </div>

      {/* P3 (#168, §5.1): motiveringsformulier voor afronden-met-afwijking. */}
      {afwijkingMogelijk && afwijkingForm && (
        <div className="mt-4 border border-warn/30 rounded-lg bg-warn-tint/50 p-4">
          <div className="text-sm font-medium text-ink">
            Afronden terwijl er iets openstaat
          </div>
          <p className="mt-1 text-xs text-muted">
            Overrulen is niet vervullen: de onderstaande vereisten blijven daarna open
            in het dossier. De afronding legt vast wat ontbrak, je motivering en wie
            afrondde.
          </p>
          <ul className="mt-2 space-y-1">
            {openBovenOptioneel.map((e, i) => (
              <li key={i} className="text-xs flex items-center gap-2">
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                    zwaarteVanVereiste(e) === "kritiek"
                      ? "bg-err/15 text-err-ink"
                      : "bg-warn/15 text-warn-ink"
                  }`}
                >
                  {zwaarteVanVereiste(e)}
                </span>
                <span className="text-ink">{e.label}</span>
              </li>
            ))}
          </ul>
          <label className="block mt-3 text-xs text-muted">
            Motivering (verplicht)
            <textarea
              value={afwijkingMotivering}
              onChange={(ev) => setAfwijkingMotivering(ev.target.value)}
              rows={3}
              className="mt-1 w-full text-sm rounded-lg border border-line bg-app px-3 py-2 text-ink"
              placeholder="Waarom rond je deze stap af terwijl dit openstaat?"
            />
          </label>
          {/* I2: de minimumlengte is blijvend zichtbaar — vóór verzending, niet pas
              bij de weigering. */}
          <div className="mt-1 text-[11px] text-muted">
            Minimaal {MIN_MOTIVERING_LENGTE} tekens; deze motivering komt in het dossier en is achteraf niet te wijzigen.
            {afwijkingMotivering.trim().length > 0 &&
              afwijkingMotivering.trim().length < MIN_MOTIVERING_LENGTE && (
                <span className="text-warn-ink">
                  {" "}Nog {MIN_MOTIVERING_LENGTE - afwijkingMotivering.trim().length} tekens nodig.
                </span>
              )}
          </div>
          {(kritiekOpen > 0 || serverVraagtBevestiging) && (
            <label className="flex items-start gap-2 mt-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={afwijkingBevestigd}
                onChange={(ev) => setAfwijkingBevestigd(ev.target.checked)}
                className="mt-0.5"
              />
              <span>
                Ik bevestig dat er een <strong>kritieke</strong> vereiste openstaat en
                de stap desondanks bewust wordt afgerond.
              </span>
            </label>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={afwijkingVastleggen}
              disabled={
                bezig === "afwijking" ||
                afwijkingMotivering.trim().length < MIN_MOTIVERING_LENGTE ||
                ((kritiekOpen > 0 || serverVraagtBevestiging) && !afwijkingBevestigd)
              }
              className={`px-4 py-2 text-sm rounded-lg font-medium ${
                afwijkingMotivering.trim().length >= MIN_MOTIVERING_LENGTE &&
                (kritiekOpen === 0 && !serverVraagtBevestiging
                  ? true
                  : afwijkingBevestigd)
                  ? "bg-warn text-white hover:opacity-90"
                  : "bg-app-line text-muted cursor-not-allowed"
              }`}
            >
              {bezig === "afwijking" ? "Bezig…" : "Afronden met afwijking"}
            </button>
            <button
              onClick={() => {
                setAfwijkingForm(false);
                setAfwijkingBevestigd(false);
                setServerVraagtBevestiging(false);
                setFout(null);
              }}
              disabled={bezig === "afwijking"}
              className="px-3 py-2 text-sm rounded-lg text-muted hover:text-ink"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

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

      {/* #192: de kiezer voor bestaande artefacten en het vaststellingsformulier
          voor de objectloze typen. */}
      {kiezerVereiste && (
        <VereisteKiezer
          procedureId={procedureId}
          vereiste={kiezerVereiste}
          onClose={() => setKiezerVereiste(null)}
        />
      )}
      {vastformVereiste && (
        <VaststellingFormulier
          procedureId={procedureId}
          vereiste={vastformVereiste}
          onClose={() => setVastformVereiste(null)}
        />
      )}
    </div>
  );
}
