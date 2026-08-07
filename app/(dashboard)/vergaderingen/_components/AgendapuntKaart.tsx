"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import VoorbereidingsBlok, {
  type Voorbereiding,
} from "./VoorbereidingsBlok";
import AgendapuntEditModal, {
  type KomendeVergadering,
} from "./AgendapuntEditModal";
import StemrondeBlok, {
  type StemmingData,
  type StemData,
  type Bestuurslid,
} from "./StemrondeBlok";
import { isBureauRol } from "@/core/lib/bureau-gate";
import { uploadDocument } from "@/core/lib/document-upload-client";
import { rolHeeftCapability } from "@/core/lib/capabilities-map";

export interface Stuk {
  id: string;
  titel: string;
  bestandsnaam: string | null;
  bestandstype: "pdf" | "docx" | "xlsx" | null;
  paginas: number | null;
  samenvatting_ai: string | null;
  samengevat_op: string | null;
  opslag_pad: string | null;
  // T2/B-6 — zelfverklaarde markering dat dit stuk AI-ondersteund is voorbereid.
  ai_ondersteund_voorbereid: boolean;
  // Async ingest (F3/F4): tot het stuk doorzoekbaar is, staat het nog in de
  // pipeline. De samenvatting is wél direct beschikbaar (synchroon bij upload).
  geindexeerd: boolean;
  verwerkingsstatus: string | null;
}

// Pipeline-statussen waarin een stuk nog asynchroon wordt verwerkt (F3/F4).
const STUK_PIPELINE_STATUSSEN = [
  "ontvangen",
  "gevalideerd",
  "gescand",
  "extractie",
  "chunking",
  "embedding",
];

const STUK_BADGE: Record<NonNullable<Stuk["bestandstype"]>, { label: string; kleur: string }> = {
  pdf: { label: "PDF", kleur: "text-err-ink" },
  docx: { label: "DOCX", kleur: "text-accent-ink" },
  xlsx: { label: "XLSX", kleur: "text-ok-ink" },
};

export interface Inbreng {
  id: string;
  gebruiker_id: string;
  gebruiker_naam: string | null;
  tekst: string;
  aangemaakt: string;
}

export interface Agendapunt {
  id: string;
  vergadering_id: string;
  volgorde: number;
  titel: string;
  beschrijving: string | null;
  categorie: "beeldvorming" | "oordeelsvorming" | "besluitvorming" | "informatie";
  tijdsduur_minuten: number | null;
  verantwoordelijke: string | null;
  aangemaakt_door: string | null;
  verwijderd_op: string | null;
  verwijderd_door: string | null;
  verwijder_reden: string | null;
  procedure_stap_id: string | null;
  stukken: Stuk[];
  inbreng: Inbreng[];
}

const CATEGORIE_BADGE: Record<Agendapunt["categorie"], { bg: string; text: string; label: string }> = {
  beeldvorming: { bg: "bg-warn-tint", text: "text-warn-ink", label: "Beeldvorming" },
  oordeelsvorming: { bg: "bg-phase-tint", text: "text-phase-ink", label: "Oordeelsvorming" },
  besluitvorming: { bg: "bg-accent-tint", text: "text-accent-ink", label: "Besluitvorming" },
  informatie: { bg: "bg-app-bg", text: "text-ink", label: "Informatie" },
};

const AVATAR_KLEUREN = [
  { bg: "#CECBF6", text: "#3C3489" },
  { bg: "#9FE1CB", text: "#085041" },
  { bg: "#F5C4B3", text: "#712B13" },
  { bg: "#F4C0D1", text: "#72243E" },
  { bg: "var(--warn)", text: "#854F0B" },
  { bg: "#B5D4F4", text: "#0C447C" },
];

function avatarKleur(id: string) {
  let som = 0;
  for (let i = 0; i < id.length; i++) som = (som + id.charCodeAt(i)) % 999;
  return AVATAR_KLEUREN[som % AVATAR_KLEUREN.length];
}

function initialen(naam?: string | null) {
  if (!naam) return "??";
  return naam
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .substring(0, 2)
    .toUpperCase();
}

function formatRelatief(d: string) {
  const nu = new Date();
  const dt = new Date(d);
  const verschilMs = nu.getTime() - dt.getTime();
  const minuten = Math.floor(verschilMs / 60000);
  const uren = Math.floor(verschilMs / 3600000);
  const dagen = Math.floor(verschilMs / 86400000);
  if (minuten < 1) return "zojuist";
  if (minuten < 60) return `${minuten} min geleden`;
  if (uren < 24) return `${uren} uur geleden`;
  if (dagen === 1) return "gisteren";
  if (dagen < 7) return `${dagen} dagen geleden`;
  return dt.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

interface SamenvattingBlok {
  aanleiding?: string;
  hoofdpunten?: string[];
  gevraagd_besluit?: string;
  aandachtspunten?: string[];
}

function parseSamenvatting(s: string | null): SamenvattingBlok | null {
  if (!s) return null;
  try {
    const obj = JSON.parse(s) as SamenvattingBlok;
    return obj;
  } catch {
    return null;
  }
}

export default function AgendapuntKaart({
  nummer,
  punt,
  huidigeGebruikerId,
  huidigeRol,
  voorbereiding,
  komendeVergaderingen,
  kanOmhoog,
  kanOmlaag,
  vorigeVolgorde,
  volgendeVolgorde,
  stemming,
  stemmen,
  bestuursleden,
  totaalBestuursleden,
}: {
  nummer: number;
  punt: Agendapunt;
  huidigeGebruikerId: string;
  huidigeRol: string | null;
  voorbereiding: Voorbereiding | null;
  komendeVergaderingen: KomendeVergadering[];
  kanOmhoog: boolean;
  kanOmlaag: boolean;
  vorigeVolgorde: number | null;
  volgendeVolgorde: number | null;
  stemming: StemmingData | null;
  stemmen: StemData[];
  bestuursleden: Bestuurslid[];
  totaalBestuursleden: number;
}) {
  const router = useRouter();
  // Standaard ingeklapt (05-07): een agenda met meerdere punten werd te lang
  // wanneer elk punt uitgeklapt opende; de bestuurder klapt gericht uit.
  const [open, setOpen] = useState(false);
  const [inbrengTekst, setInbrengTekst] = useState("");
  const [inbrengBezig, setInbrengBezig] = useState(false);
  const [uploadBezig, setUploadBezig] = useState(false);
  const [uploadFout, setUploadFout] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [volgordeBezig, setVolgordeBezig] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const badge = CATEGORIE_BADGE[punt.categorie];
  const isEigenaar = punt.aangemaakt_door === huidigeGebruikerId;
  const isPrivileged = huidigeRol === "voorzitter" || huidigeRol === "beheerder";
  const magBewerken = isEigenaar || isPrivileged;
  const isVerwijderd = !!punt.verwijderd_op;
  // T1 bureau-rol (§5.3/§5.5). UI-gating is cosmetisch; de weigering staat in RLS
  // (2026_08_05_bestuursbureau_rol.sql) én in de routes (core/lib/bureau-gate.ts).
  // Het bureau bouwt de agenda en is dus vaak `aangemaakt_door` — zonder de
  // !isBureau-term zou het via de eigenaar-tak alsnog een stemronde kunnen openen.
  const isBureau = isBureauRol(huidigeRol);
  const magStemmingStarten = !isBureau && (isPrivileged || isEigenaar);
  // T2/B-6 — wie documentmetadata mag bijwerken, mag de markering zetten. Het
  // bureau doet in de praktijk het documentbeheer; server-side gegate in de route.
  const magMarkeren = rolHeeftCapability(huidigeRol, "documents.metadata.update");
  const aantalBijdragers = punt.inbreng.length; // voorbereidingen tellen ook mee, maar die zijn privé per gebruiker — server-side wordt het echte aantal getoetst

  async function verschuif(richting: "omhoog" | "omlaag") {
    const target = richting === "omhoog" ? vorigeVolgorde : volgendeVolgorde;
    if (target === null || volgordeBezig) return;
    setVolgordeBezig(true);
    try {
      const res = await fetch(`/api/agendapunten/${punt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volgorde: target }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error || "Verschuiven mislukt");
        return;
      }
      router.refresh();
    } catch {
      alert("Verbindingsfout");
    } finally {
      setVolgordeBezig(false);
    }
  }

  async function herstel() {
    if (volgordeBezig) return;
    if (!confirm("Dit agendapunt terugzetten op de agenda?")) return;
    setVolgordeBezig(true);
    try {
      const res = await fetch(`/api/agendapunten/${punt.id}/herstellen`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error || "Herstellen mislukt");
        return;
      }
      router.refresh();
    } catch {
      alert("Verbindingsfout");
    } finally {
      setVolgordeBezig(false);
    }
  }

  async function plaatsInbreng() {
    if (!inbrengTekst.trim() || inbrengBezig) return;
    setInbrengBezig(true);
    try {
      const res = await fetch("/api/inbreng", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agendapunt_id: punt.id, tekst: inbrengTekst.trim() }),
      });
      if (res.ok) {
        setInbrengTekst("");
        router.refresh();
      } else {
        const data = await res.json();
        alert(data.error || "Kon inbreng niet plaatsen");
      }
    } catch {
      alert("Verbindingsfout");
    } finally {
      setInbrengBezig(false);
    }
  }

  async function verwijderInbreng(id: string) {
    if (!confirm("Eigen inbreng verwijderen?")) return;
    try {
      const res = await fetch(`/api/inbreng/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      } else {
        alert("Kon inbreng niet verwijderen");
      }
    } catch {
      alert("Verbindingsfout");
    }
  }

  async function uploadStuk(file: File) {
    setUploadBezig(true);
    setUploadFout(null);
    try {
      // F7: direct-to-storage. bron/bibliotheek volgen server-side uit het
      // agendapunt (bron='Intern', bibliotheek='fonds').
      const res = await uploadDocument(file, {
        agendapunt_id: punt.id,
        titel: file.name.replace(/\.(pdf|docx|pptx|xlsx)$/i, ""),
      });
      if (!res.ok) {
        setUploadFout(res.error ?? "Upload mislukt");
        return;
      }
      router.refresh();
    } catch {
      setUploadFout("Verbindingsfout tijdens upload");
    } finally {
      setUploadBezig(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div
      id={`agendapunt-${punt.id}`}
      className={`bg-white border rounded-xl ${
        isVerwijderd ? "border-err/30 bg-err-tint" : "border-line"
      }`}
    >
      {/* Hele kop klikbaar om uit/in te klappen (niet alleen het pijltje). De
          knoppen erin stoppen de bubbling zodat ze hun eigen actie houden. Op
          verwijderde rijen is er niets uit te klappen, dus dan niet klikbaar. */}
      <div
        className={`w-full flex items-start gap-3 p-4${
          isVerwijderd ? "" : " cursor-pointer"
        }`}
        onClick={isVerwijderd ? undefined : () => setOpen((o) => !o)}
      >
        <span className="text-xs text-muted tabular-nums w-5 pt-1">{nummer}.</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${badge.bg} ${badge.text}`}>
              {badge.label}
            </span>
            <span
              className={`text-sm font-semibold ${
                isVerwijderd ? "text-muted line-through" : "text-ink"
              }`}
            >
              {punt.titel}
            </span>
            {isVerwijderd && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-err-tint text-err-ink">
                Verwijderd
              </span>
            )}
          </div>
          <div className="text-xs text-muted mt-1">
            {[
              punt.tijdsduur_minuten ? `${punt.tijdsduur_minuten} min` : null,
              punt.verantwoordelijke,
              `${punt.stukken.length} ${punt.stukken.length === 1 ? "stuk" : "stukken"}`,
              // Voor het bureau levert de RLS 0 inbrengrijen. "0 inbrengen" zou
              // suggereren dat er geen inbreng ís — precies wat FR-6 verbiedt.
              isBureau
                ? "inbreng afgeschermd"
                : `${punt.inbreng.length} ${punt.inbreng.length === 1 ? "inbreng" : "inbrengen"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {isVerwijderd && punt.verwijder_reden && (
            <div className="text-[11px] text-err-ink mt-1 italic">
              Reden: {punt.verwijder_reden}
            </div>
          )}
        </div>

        {/* Herstel-knop op verwijderde rijen (alleen voorzitter/beheerder) */}
        {isVerwijderd && isPrivileged && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              herstel();
            }}
            disabled={volgordeBezig}
            className="text-xs text-ok-ink hover:text-ok-ink px-2 py-1 disabled:opacity-50"
            title="Agendapunt herstellen"
          >
            ↶ Herstellen
          </button>
        )}

        {/* Pijltjes + edit-knop (alleen voor wie mag bewerken, en alleen op actieve punten) */}
        {magBewerken && !isVerwijderd && (
          <div className="flex items-center gap-0.5 pt-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                verschuif("omhoog");
              }}
              disabled={!kanOmhoog || volgordeBezig}
              className="text-muted hover:text-ink disabled:opacity-30 text-xs px-1.5 py-1"
              title="Omhoog verplaatsen"
              aria-label="Omhoog verplaatsen"
            >
              ▲
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                verschuif("omlaag");
              }}
              disabled={!kanOmlaag || volgordeBezig}
              className="text-muted hover:text-ink disabled:opacity-30 text-xs px-1.5 py-1"
              title="Omlaag verplaatsen"
              aria-label="Omlaag verplaatsen"
            >
              ▼
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditOpen(true);
              }}
              className="text-muted hover:text-ink text-sm px-2 py-1"
              title="Bewerken"
              aria-label="Bewerken"
            >
              ✎
            </button>
          </div>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          className="text-muted text-sm pt-1 px-1.5"
          aria-label={open ? "Inklappen" : "Uitklappen"}
        >
          {open ? "▾" : "▸"}
        </button>
      </div>

      {editOpen && (
        <AgendapuntEditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          punt={{
            id: punt.id,
            vergadering_id: punt.vergadering_id,
            titel: punt.titel,
            beschrijving: punt.beschrijving,
            categorie: punt.categorie,
            tijdsduur_minuten: punt.tijdsduur_minuten,
            verantwoordelijke: punt.verantwoordelijke,
          }}
          aantalBijdragers={aantalBijdragers}
          bijdragenAfgeschermd={isBureau}
          komendeVergaderingen={komendeVergaderingen}
        />
      )}

      {open && !isVerwijderd && (
        <div className="px-4 pb-4 pl-12 space-y-4 border-t border-line pt-4">
          {punt.beschrijving && (
            <p className="text-sm text-ink leading-relaxed">{punt.beschrijving}</p>
          )}

          {/* Stemronde — alleen bij besluitvorming */}
          {punt.categorie === "besluitvorming" && (
            <StemrondeBlok
              agendapuntId={punt.id}
              decisionGekoppeld={!!punt.procedure_stap_id}
              besluitvraagDefault={punt.titel}
              stemming={stemming}
              stemmen={stemmen}
              huidigeGebruikerId={huidigeGebruikerId}
              magStarten={magStemmingStarten}
              magSluiten={
                !isBureau &&
                (isPrivileged || stemming?.geopend_door === huidigeGebruikerId)
              }
              magStemmen={!isBureau}
              bestuursleden={bestuursleden}
              totaalBestuursleden={totaalBestuursleden}
            />
          )}

          {/* Stukken */}
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
              Stukken ({punt.stukken.length})
            </div>
            <div className="space-y-2">
              {punt.stukken.map((s) => (
                <StukKaart key={s.id} stuk={s} magMarkeren={magMarkeren} />
              ))}
              <label
                className={`flex items-center gap-2 text-xs border border-dashed border-app-line-strong rounded-lg px-3 py-2 hover:border-accent transition-colors ${
                  uploadBezig ? "opacity-50 cursor-wait" : "cursor-pointer text-muted"
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  disabled={uploadBezig}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadStuk(f);
                  }}
                />
                {uploadBezig
                  ? "Bezig met uploaden en samenvatten..."
                  : "+ Stuk toevoegen — PDF, Word of Excel (AI-samenvatting volgt automatisch)"}
              </label>
              {uploadFout && <div className="text-xs text-err-ink">{uploadFout}</div>}
            </div>
          </div>

          {/* Dé AI-plek van de kaart (0036 + FO duiding v0.3): de inline chat
              "Vraag door over dit agendapunt" is het enige instappunt, met de
              rijke voorbereiding als startchip; daaronder "Mijn aantekeningen"
              (privé), direct boven "Inbreng vooraf". */}
          <VoorbereidingsBlok
            agendapuntId={punt.id}
            titel={punt.titel}
            stukken={punt.stukken.map((s) => ({ id: s.id, titel: s.titel }))}
            initieel={voorbereiding}
          />

          {/* Inbreng */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-xs font-semibold text-muted uppercase tracking-wide">
                Inbreng vooraf{isBureau ? "" : ` (${punt.inbreng.length})`}
              </div>
              <span className="text-[11px] text-muted">
                {isBureau ? "afgeschermd" : "zichtbaar voor alle bestuursleden"}
              </span>
            </div>
            {/* FR-6 — het paneel verzwijgt niet dát er afgeschermde informatie is.
                Een lege lijst zou onterecht suggereren dat er geen inbreng ís;
                voor het bureau levert de RLS immers altijd 0 rijen. */}
            {isBureau && (
              <div className="bg-app-bg border border-line rounded-lg px-3 py-2.5 text-sm text-muted leading-relaxed">
                Inbreng van bestuursleden is niet zichtbaar voor het bestuursbureau.
              </div>
            )}
            {!isBureau && punt.inbreng.length > 0 && (
              <div className="space-y-2 mb-3">
                {punt.inbreng.map((i) => {
                  const kl = avatarKleur(i.gebruiker_id);
                  const isEigen = i.gebruiker_id === huidigeGebruikerId;
                  return (
                    <div key={i.id} className="flex gap-2.5 items-start">
                      <span
                        style={{ background: kl.bg, color: kl.text }}
                        className="w-7 h-7 rounded-full inline-flex items-center justify-center text-[11px] font-medium flex-shrink-0"
                      >
                        {initialen(i.gebruiker_naam)}
                      </span>
                      <div className="flex-1 min-w-0 bg-app-bg rounded-lg px-3 py-2">
                        <div className="flex items-baseline justify-between gap-2 flex-wrap">
                          <div className="flex items-baseline gap-2">
                            <span className="text-xs font-medium text-ink">
                              {i.gebruiker_naam || "Onbekend"}
                            </span>
                            <span className="text-[11px] text-muted">
                              {formatRelatief(i.aangemaakt)}
                            </span>
                          </div>
                          {isEigen && (
                            <button
                              onClick={() => verwijderInbreng(i.id)}
                              className="text-[11px] text-muted hover:text-err-ink"
                            >
                              Verwijderen
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-ink mt-1 leading-relaxed whitespace-pre-wrap">
                          {i.tekst}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Inbreng is een bestuurlijke uiting; het bureau ondersteunt en
                spreekt niet mee (§5.3). POST /api/inbreng weigert dit ook
                server-side, en de RLS-policy "eigen inbreng schrijven" hard. */}
            {!isBureau && (
              <div className="flex gap-2 items-end">
                <textarea
                  value={inbrengTekst}
                  onChange={(e) => setInbrengTekst(e.target.value)}
                  placeholder="Wat wil je vooraf inbrengen voor de discussie van dit punt?"
                  rows={2}
                  className="flex-1 border border-line rounded-lg px-3 py-2 text-sm bg-app-bg outline-none focus:border-accent resize-none"
                />
                <button
                  onClick={plaatsInbreng}
                  disabled={inbrengBezig || !inbrengTekst.trim()}
                  className="bg-accent text-white text-sm font-medium px-3 py-2 rounded-lg hover:bg-accent hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-stretch"
                >
                  {inbrengBezig ? "..." : "Plaats"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StukKaart({ stuk, magMarkeren }: { stuk: Stuk; magMarkeren: boolean }) {
  const [open, setOpen] = useState(false);
  // T2/B-6 — lokale weergave van de markering; optimistisch bij een toggle.
  const [gemarkeerd, setGemarkeerd] = useState(stuk.ai_ondersteund_voorbereid);
  const [markeerBezig, setMarkeerBezig] = useState(false);
  const samenvatting = parseSamenvatting(stuk.samenvatting_ai);

  async function toggleMarkering() {
    const nieuw = !gemarkeerd;
    setMarkeerBezig(true);
    setGemarkeerd(nieuw); // optimistisch
    try {
      const res = await fetch(`/api/documents/${stuk.id}/ai-markering`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markering: nieuw }),
      });
      if (!res.ok) setGemarkeerd(!nieuw); // terugdraaien bij fout
    } catch {
      setGemarkeerd(!nieuw);
    } finally {
      setMarkeerBezig(false);
    }
  }
  const badge = STUK_BADGE[stuk.bestandstype ?? "pdf"];
  const eenheid = stuk.bestandstype === "xlsx" ? "tabbladen" : "pagina's";
  const kanInzien = !!stuk.opslag_pad;
  // Async ingest: het stuk is al zichtbaar en (bij een agendapunt) samengevat,
  // maar pas ná de worker doorzoekbaar in de chat. Maak dat herkenbaar.
  const inVerwerking =
    !stuk.geindexeerd &&
    STUK_PIPELINE_STATUSSEN.includes(stuk.verwerkingsstatus ?? "");
  const verwerkingMislukt = stuk.verwerkingsstatus === "mislukt";
  const snippetBron = samenvatting
    ? samenvatting.gevraagd_besluit ||
      samenvatting.aanleiding ||
      samenvatting.hoofdpunten?.[0] ||
      ""
    : stuk.samenvatting_ai ?? "";
  const snippet = snippetBron
    ? snippetBron.replace(/\s+/g, " ").trim().slice(0, 160) +
      (snippetBron.length > 160 ? "…" : "")
    : "";

  return (
    <div className="bg-app-bg rounded-lg border border-line">
      <div className="p-3">
        <div className="flex items-center gap-3">
        <span
          className={`w-9 h-9 bg-white border border-line rounded-md inline-flex items-center justify-center text-[10px] font-semibold flex-shrink-0 ${badge.kleur}`}
        >
          {badge.label}
        </span>
        <div className="flex-1 min-w-0">
          {kanInzien ? (
            <a
              href={`/api/documents/${stuk.id}/bestand`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-ink truncate hover:text-accent transition-colors block"
              title="Origineel openen of downloaden"
            >
              {stuk.titel}
            </a>
          ) : (
            <div
              className="text-sm font-medium text-ink truncate"
              title="Origineel niet beschikbaar — geüpload vóór mei 2026"
            >
              {stuk.titel}
            </div>
          )}
          <div className="text-[11px] text-muted mt-0.5">
            {stuk.paginas ? `${stuk.paginas} ${eenheid}` : badge.label}
            {!stuk.samenvatting_ai ? " · samenvatting wordt nog gegenereerd" : ""}
            {inVerwerking ? " · ⏳ wordt verwerkt (nog niet doorzoekbaar)" : ""}
            {verwerkingMislukt ? " · ⚠️ verwerking mislukt" : ""}
            {!kanInzien ? " · origineel niet beschikbaar" : ""}
          </div>
          {/* T2/B-6 — markering "AI-ondersteund voorbereid" voor het bestuur. */}
          {gemarkeerd && (
            <span
              className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-semibold text-accent-ink bg-accent-tint rounded-full px-2 py-0.5"
              title="Dit stuk is met AI-ondersteuning voorbereid door het bestuursbureau."
            >
              ✎ AI-ondersteund voorbereid
            </span>
          )}
        </div>
        </div>
        {/* T2/B-6 — het markeren zelf (zelfverklaard, klasse D). Alleen zichtbaar
            voor wie documentmetadata mag bijwerken; server-side gegate. */}
        {magMarkeren && (
          <button
            type="button"
            onClick={toggleMarkering}
            disabled={markeerBezig}
            className="mt-2 text-[11px] text-muted hover:text-accent-ink disabled:opacity-50"
          >
            {gemarkeerd
              ? "Markering ‘AI-ondersteund voorbereid’ verwijderen"
              : "Markeer als AI-ondersteund voorbereid"}
          </button>
        )}
        {snippet && (
          <p className="text-[13px] leading-snug text-ink/70 mt-2 line-clamp-2">
            {snippet}
          </p>
        )}
        {stuk.samenvatting_ai && (
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="mt-3 inline-flex items-center gap-1.5 bg-accent-tint text-accent-ink text-[13px] font-medium px-3 py-1.5 rounded-lg hover:bg-accent hover:text-white transition-colors"
          >
            {open ? "Verberg samenvatting" : "Lees samenvatting"}
          </button>
        )}
      </div>

      {open && (
        <div className="px-3 pb-3">
          {samenvatting ? (
            // Ontblokt: op de kaartachtergrond i.p.v. in een wit kaartje (iteratie
            // 29-07). Dezelfde behandeling als de ontblokte AI-tekst.
            <div className="space-y-3 pt-1">
              {samenvatting.aanleiding && (
                <Sectie label="Aanleiding">
                  <p className="text-sm text-ink leading-relaxed">{samenvatting.aanleiding}</p>
                </Sectie>
              )}
              {samenvatting.hoofdpunten && samenvatting.hoofdpunten.length > 0 && (
                <Sectie label="Hoofdpunten">
                  <ul className="text-sm text-ink list-disc pl-5 space-y-1">
                    {samenvatting.hoofdpunten.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </Sectie>
              )}
              {samenvatting.gevraagd_besluit && (
                <Sectie label="Gevraagd besluit">
                  <p className="text-sm text-ink leading-relaxed">{samenvatting.gevraagd_besluit}</p>
                </Sectie>
              )}
              {samenvatting.aandachtspunten && samenvatting.aandachtspunten.length > 0 && (
                <Sectie label="Aandachtspunten">
                  <ul className="text-sm text-ink list-disc pl-5 space-y-1">
                    {samenvatting.aandachtspunten.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </Sectie>
              )}
            </div>
          ) : stuk.samenvatting_ai ? (
            <div className="pt-1 text-sm text-ink whitespace-pre-wrap">
              {stuk.samenvatting_ai}
            </div>
          ) : (
            <div className="pt-1 text-xs text-muted italic">
              Samenvatting wordt nog gegenereerd. Vernieuw de pagina over een paar seconden.
            </div>
          )}
          {stuk.samenvatting_ai && (
            <p className="text-[11px] text-muted mt-2 leading-relaxed">
              ⚠️ Automatisch gegenereerd door AI. Controleer altijd aan het bronstuk
              voordat u een oordeel vormt.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Sectie({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
