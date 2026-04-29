"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export interface Stuk {
  id: string;
  titel: string;
  bestandsnaam: string | null;
  paginas: number | null;
  samenvatting_ai: string | null;
  samengevat_op: string | null;
}

export interface Inbreng {
  id: string;
  gebruiker_id: string;
  gebruiker_naam: string | null;
  tekst: string;
  aangemaakt: string;
}

export interface Agendapunt {
  id: string;
  volgorde: number;
  titel: string;
  beschrijving: string | null;
  categorie: "beeldvorming" | "oordeelsvorming" | "besluitvorming" | "informatie";
  tijdsduur_minuten: number | null;
  verantwoordelijke: string | null;
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
}: {
  nummer: number;
  punt: Agendapunt;
  huidigeGebruikerId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [inbrengTekst, setInbrengTekst] = useState("");
  const [inbrengBezig, setInbrengBezig] = useState(false);
  const [uploadBezig, setUploadBezig] = useState(false);
  const [uploadFout, setUploadFout] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const badge = CATEGORIE_BADGE[punt.categorie];

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
      formData.append("titel", file.name.replace(/\.pdf$/i, ""));
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
    <div className="bg-white border border-gray-200 rounded-xl">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-gray-50 transition-colors rounded-xl"
      >
        <span className="text-xs text-gray-400 tabular-nums w-5 pt-1">{nummer}.</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${badge.bg} ${badge.text}`}>
              {badge.label}
            </span>
            <span className="text-sm font-semibold text-[#0F2744]">{punt.titel}</span>
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
        </div>
        <span className="text-gray-400 text-sm pt-1">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
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
                  accept=".pdf,application/pdf"
                  className="hidden"
                  disabled={uploadBezig}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadStuk(f);
                  }}
                />
                {uploadBezig
                  ? "Bezig met uploaden en samenvatten..."
                  : "+ PDF toevoegen (AI-samenvatting volgt automatisch)"}
              </label>
              {uploadFout && <div className="text-xs text-red-600">{uploadFout}</div>}
            </div>
          </div>

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

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-100 transition-colors rounded-lg"
      >
        <span className="w-9 h-9 bg-white border border-gray-200 rounded-md inline-flex items-center justify-center text-[10px] font-semibold text-red-700 flex-shrink-0">
          PDF
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[#0F2744] truncate">{stuk.titel}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {stuk.paginas ? `${stuk.paginas} pagina's` : "PDF"}
            {stuk.samenvatting_ai ? " · AI-samenvatting beschikbaar" : " · samenvatting wordt nog gegenereerd"}
          </div>
        </div>
        <span className="text-gray-400 text-xs">{open ? "▾" : "▸"}</span>
      </button>

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
