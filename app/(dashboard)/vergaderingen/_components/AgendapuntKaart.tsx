"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import VoorbereidingsBlok, {
  type Voorbereiding,
} from "./VoorbereidingsBlok";
import AgendapuntEditModal, {
  type KomendeVergadering,
} from "./AgendapuntEditModal";

export interface Stuk {
  id: string;
  titel: string;
  bestandsnaam: string | null;
  bestandstype: "pdf" | "docx" | "xlsx" | null;
  paginas: number | null;
  samenvatting_ai: string | null;
  samengevat_op: string | null;
  opslag_pad: string | null;
}

const STUK_BADGE: Record<NonNullable<Stuk["bestandstype"]>, { label: string; kleur: string }> = {
  pdf: { label: "PDF", kleur: "text-red-700" },
  docx: { label: "DOCX", kleur: "text-blue-700" },
  xlsx: { label: "XLSX", kleur: "text-emerald-700" },
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
  stukken: Stuk[];
  inbreng: Inbreng[];
}

const CATEGORIE_BADGE: Record<Agendapunt["categorie"], { bg: string; text: string; label: string }> = {
  beeldvorming: { bg: "bg-amber-50", text: "text-amber-800", label: "Beeldvorming" },
  oordeelsvorming: { bg: "bg-purple-50", text: "text-purple-800", label: "Oordeelsvorming" },
  besluitvorming: { bg: "bg-blue-50", text: "text-blue-800", label: "Besluitvorming" },
  informatie: { bg: "bg-gray-100", text: "text-gray-700", label: "Informatie" },
};

const AVATAR_KLEUREN = [
  { bg: "#CECBF6", text: "#3C3489" },
  { bg: "#9FE1CB", text: "#085041" },
  { bg: "#F5C4B3", text: "#712B13" },
  { bg: "#F4C0D1", text: "#72243E" },
  { bg: "#FAC775", text: "#854F0B" },
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
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
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
      const formData = new FormData();
      formData.append("bestand", file);
      formData.append("agendapunt_id", punt.id);
      formData.append("titel", file.name.replace(/\.(pdf|docx|xlsx)$/i, ""));
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadFout(data.error || "Upload mislukt");
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
        isVerwijderd ? "border-red-200 bg-red-50/30" : "border-gray-200"
      }`}
    >
      <div className="w-full flex items-start gap-3 p-4">
        <span className="text-xs text-gray-400 tabular-nums w-5 pt-1">{nummer}.</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${badge.bg} ${badge.text}`}>
              {badge.label}
            </span>
            <span
              className={`text-sm font-semibold ${
                isVerwijderd ? "text-gray-500 line-through" : "text-[#0F2744]"
              }`}
            >
              {punt.titel}
            </span>
            {isVerwijderd && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                Verwijderd
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {[
              punt.tijdsduur_minuten ? `${punt.tijdsduur_minuten} min` : null,
              punt.verantwoordelijke,
              `${punt.stukken.length} ${punt.stukken.length === 1 ? "stuk" : "stukken"}`,
              `${punt.inbreng.length} ${punt.inbreng.length === 1 ? "inbreng" : "inbrengen"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {isVerwijderd && punt.verwijder_reden && (
            <div className="text-[11px] text-red-700 mt-1 italic">
              Reden: {punt.verwijder_reden}
            </div>
          )}
        </div>

        {/* Pijltjes + edit-knop (alleen voor wie mag bewerken, en alleen op actieve punten) */}
        {magBewerken && !isVerwijderd && (
          <div className="flex items-center gap-0.5 pt-1">
            <button
              onClick={() => verschuif("omhoog")}
              disabled={!kanOmhoog || volgordeBezig}
              className="text-gray-400 hover:text-[#0F2744] disabled:opacity-30 text-xs px-1.5 py-1"
              title="Omhoog verplaatsen"
              aria-label="Omhoog verplaatsen"
            >
              ▲
            </button>
            <button
              onClick={() => verschuif("omlaag")}
              disabled={!kanOmlaag || volgordeBezig}
              className="text-gray-400 hover:text-[#0F2744] disabled:opacity-30 text-xs px-1.5 py-1"
              title="Omlaag verplaatsen"
              aria-label="Omlaag verplaatsen"
            >
              ▼
            </button>
            <button
              onClick={() => setEditOpen(true)}
              className="text-gray-400 hover:text-[#0F2744] text-sm px-2 py-1"
              title="Bewerken"
              aria-label="Bewerken"
            >
              ✎
            </button>
          </div>
        )}

        <button
          onClick={() => setOpen(!open)}
          className="text-gray-400 text-sm pt-1 px-1.5"
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
          komendeVergaderingen={komendeVergaderingen}
        />
      )}

      {open && !isVerwijderd && (
        <div className="px-4 pb-4 pl-12 space-y-4 border-t border-gray-100 pt-4">
          {punt.beschrijving && (
            <p className="text-sm text-gray-700 leading-relaxed">{punt.beschrijving}</p>
          )}

          {/* Stukken */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Stukken ({punt.stukken.length})
            </div>
            <div className="space-y-2">
              {punt.stukken.map((s) => (
                <StukKaart key={s.id} stuk={s} />
              ))}
              <label
                className={`flex items-center gap-2 text-xs border border-dashed border-gray-300 rounded-lg px-3 py-2 hover:border-[#C9A84C] transition-colors ${
                  uploadBezig ? "opacity-50 cursor-wait" : "cursor-pointer text-gray-600"
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
              {uploadFout && <div className="text-xs text-red-600">{uploadFout}</div>}
            </div>
          </div>

          {/* Mijn voorbereiding (privé) */}
          <VoorbereidingsBlok
            agendapuntId={punt.id}
            initieel={voorbereiding}
            onVulInbreng={(tekst) =>
              setInbrengTekst(
                inbrengTekst ? `${inbrengTekst}\n\n${tekst}` : tekst
              )
            }
          />

          {/* Inbreng */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Inbreng vooraf ({punt.inbreng.length})
              </div>
              <span className="text-[11px] text-gray-400">
                zichtbaar voor alle bestuursleden
              </span>
            </div>
            {punt.inbreng.length > 0 && (
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
                      <div className="flex-1 min-w-0 bg-gray-50 rounded-lg px-3 py-2">
                        <div className="flex items-baseline justify-between gap-2 flex-wrap">
                          <div className="flex items-baseline gap-2">
                            <span className="text-xs font-medium text-[#0F2744]">
                              {i.gebruiker_naam || "Onbekend"}
                            </span>
                            <span className="text-[11px] text-gray-400">
                              {formatRelatief(i.aangemaakt)}
                            </span>
                          </div>
                          {isEigen && (
                            <button
                              onClick={() => verwijderInbreng(i.id)}
                              className="text-[11px] text-gray-400 hover:text-red-600"
                            >
                              Verwijderen
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-gray-800 mt-1 leading-relaxed whitespace-pre-wrap">
                          {i.tekst}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2 items-end">
              <textarea
                value={inbrengTekst}
                onChange={(e) => setInbrengTekst(e.target.value)}
                placeholder="Wat wil je vooraf inbrengen voor de discussie van dit punt?"
                rows={2}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:border-[#C9A84C] resize-none"
              />
              <button
                onClick={plaatsInbreng}
                disabled={inbrengBezig || !inbrengTekst.trim()}
                className="bg-[#0F2744] text-white text-sm font-medium px-3 py-2 rounded-lg hover:bg-[#C9A84C] hover:text-[#0F2744] transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-stretch"
              >
                {inbrengBezig ? "..." : "Plaats"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StukKaart({ stuk }: { stuk: Stuk }) {
  const [open, setOpen] = useState(false);
  const samenvatting = parseSamenvatting(stuk.samenvatting_ai);
  const badge = STUK_BADGE[stuk.bestandstype ?? "pdf"];
  const eenheid = stuk.bestandstype === "xlsx" ? "tabbladen" : "pagina's";
  const kanInzien = !!stuk.opslag_pad;

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200">
      <div className="w-full flex items-center gap-3 p-3 hover:bg-gray-100 transition-colors rounded-lg">
        <span
          className={`w-9 h-9 bg-white border border-gray-200 rounded-md inline-flex items-center justify-center text-[10px] font-semibold flex-shrink-0 ${badge.kleur}`}
        >
          {badge.label}
        </span>
        <div className="flex-1 min-w-0">
          {kanInzien ? (
            <a
              href={`/api/documents/${stuk.id}/bestand`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#0F2744] truncate hover:text-[#C9A84C] transition-colors block"
              title="Origineel openen of downloaden"
            >
              {stuk.titel}
            </a>
          ) : (
            <div
              className="text-sm font-medium text-[#0F2744] truncate"
              title="Origineel niet beschikbaar — geüpload vóór mei 2026"
            >
              {stuk.titel}
            </div>
          )}
          <div className="text-[11px] text-gray-500 mt-0.5">
            {stuk.paginas ? `${stuk.paginas} ${eenheid}` : badge.label}
            {stuk.samenvatting_ai ? " · AI-samenvatting beschikbaar" : " · samenvatting wordt nog gegenereerd"}
            {!kanInzien ? " · origineel niet beschikbaar" : ""}
          </div>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="text-gray-400 text-xs px-2 py-1 hover:text-[#0F2744]"
          aria-label={open ? "Samenvatting inklappen" : "Samenvatting uitklappen"}
        >
          {open ? "▾" : "▸"}
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3">
          {samenvatting ? (
            <div className="bg-white rounded-md border border-gray-200 p-3 space-y-3">
              {samenvatting.aanleiding && (
                <Sectie label="Aanleiding">
                  <p className="text-sm text-gray-800 leading-relaxed">{samenvatting.aanleiding}</p>
                </Sectie>
              )}
              {samenvatting.hoofdpunten && samenvatting.hoofdpunten.length > 0 && (
                <Sectie label="Hoofdpunten">
                  <ul className="text-sm text-gray-800 list-disc pl-5 space-y-1">
                    {samenvatting.hoofdpunten.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </Sectie>
              )}
              {samenvatting.gevraagd_besluit && (
                <Sectie label="Gevraagd besluit">
                  <p className="text-sm text-gray-800 leading-relaxed">{samenvatting.gevraagd_besluit}</p>
                </Sectie>
              )}
              {samenvatting.aandachtspunten && samenvatting.aandachtspunten.length > 0 && (
                <Sectie label="Aandachtspunten">
                  <ul className="text-sm text-gray-800 list-disc pl-5 space-y-1">
                    {samenvatting.aandachtspunten.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </Sectie>
              )}
            </div>
          ) : stuk.samenvatting_ai ? (
            <div className="bg-white rounded-md border border-gray-200 p-3 text-sm text-gray-700 whitespace-pre-wrap">
              {stuk.samenvatting_ai}
            </div>
          ) : (
            <div className="bg-white rounded-md border border-gray-200 p-3 text-xs text-gray-500 italic">
              Samenvatting wordt nog gegenereerd. Vernieuw de pagina over een paar seconden.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Sectie({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
