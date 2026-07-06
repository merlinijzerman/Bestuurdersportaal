"use client";
// ============================================================
//  VoorbereidingsBlok — persoonlijke AI-voorbereiding per agendapunt
// ============================================================
// Increment "bestuurlijke duiding" (FO v0.2, opvolging gebruikersfeedback
// 05-07): de duiding (betekenis / gevraagd besluit / impact) is het
// hoofdproduct, de vergadervragen zijn de afsluiter. Alle AI-tekst rendert
// via de gedeelde CitatieTekst-component ([Bron N]-pills i.p.v. kale
// markers); een uitklapbaar blok "Onderbouwing en bronnen" toont de
// genummerde bronnen (ai_output.bronnen, FR-4) plus bronnen_meta.
// Backward compat (FR-8): oude voorbereidingen zonder `duiding` blijven
// renderen, met een hint om te vernieuwen.
// Persoonlijke voorbereiding: vrije aantekeningen (agendapunt-breed), een
// notitieveld per lens én per vergadervraag (keys `vraag_N` in hetzelfde
// eigen_notities-jsonb — geen schemawijziging).

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import CitatieTekst, { MARKER_REGEX } from "./CitatieTekst";
import AgendapuntChat from "./AgendapuntChat";

export interface VoorbereidingLens {
  naam: string;
  analyse: string;
  vraag: string;
}

export interface VoorbereidingDuiding {
  betekenis?: string;
  gevraagd_besluit?: string;
  impact?: string;
}

// Zelfde vorm als BronVerwijzing uit de chat-route (FR-4).
export interface VoorbereidingBron {
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
  heeft_origineel: boolean;
}

export interface VoorbereidingAIOutput {
  duiding?: VoorbereidingDuiding;
  lenzen?: VoorbereidingLens[];
  ontbrekend?: string[];
  vergadervragen?: string[];
  samenvatting?: string;
  bronnen?: VoorbereidingBron[];
}

export interface BronnenMeta {
  documenten?: { id: string; titel: string; bron: string }[];
  risicos?: { id: string; titel: string; niveau: string }[];
  procedures?: { id: string; titel: string; status: string }[];
  profielsturing?: "actief" | "geen-profiel";
}

export interface Voorbereiding {
  id: string;
  agendapunt_id: string;
  diepte: "snel" | "grondig";
  ai_output: VoorbereidingAIOutput;
  eigen_notities: Record<string, string>;
  vrije_notities: string | null;
  bronnen_meta: BronnenMeta;
  gegenereerd_op: string;
  bijgewerkt_op: string;
}

interface Props {
  agendapuntId: string;
  /* Titel + stukken voor de geïntegreerde chat (05-07): de inline assistent
     (0036) is onderdeel van dit blok geworden zodat de kaart één AI-plek kent. */
  titel: string;
  stukken: { id: string; titel: string }[];
  initieel: Voorbereiding | null;
  onVulInbreng?: (tekst: string) => void;
}

function formatDatumKort(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Markers ([Bron N] e.d.) horen niet thuis in gedeelde inbreng-tekst.
function stripMarkers(s: string): string {
  return s.replace(new RegExp(MARKER_REGEX.source, "gi"), "").replace(/ {2,}/g, " ").trim();
}

const NIVEAU_KLEUR: Record<string, string> = {
  hoog: "text-red-700 bg-red-50",
  middel: "text-amber-700 bg-amber-50",
  laag: "text-emerald-700 bg-emerald-50",
};

export default function VoorbereidingsBlok({
  agendapuntId,
  titel,
  stukken,
  initieel,
  onVulInbreng,
}: Props) {
  const router = useRouter();
  const [voorbereiding, setVoorbereiding] = useState<Voorbereiding | null>(initieel);
  const [bezig, setBezig] = useState<"genereer" | "verdiep" | "notities" | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [notities, setNotities] = useState<Record<string, string>>(
    initieel?.eigen_notities || {}
  );
  const [vrijeNotities, setVrijeNotities] = useState<string>(
    initieel?.vrije_notities || ""
  );
  const [notitiesGewijzigd, setNotitiesGewijzigd] = useState(false);
  const [inbrengDialoogOpen, setInbrengDialoogOpen] = useState(false);
  const [neemVrijeNotitiesMee, setNeemVrijeNotitiesMee] = useState(true);
  const [onderbouwingOpen, setOnderbouwingOpen] = useState(false);

  useEffect(() => {
    if (initieel) {
      setVoorbereiding(initieel);
      setNotities(initieel.eigen_notities || {});
      setVrijeNotities(initieel.vrije_notities || "");
      setNotitiesGewijzigd(false);
    }
  }, [initieel]);

  async function genereer(diepte: "snel" | "grondig") {
    setFout(null);
    setBezig(diepte === "grondig" ? "verdiep" : "genereer");
    try {
      const res = await fetch(
        `/api/agendapunten/${agendapuntId}/voorbereiding`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ diepte }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Genereren mislukt");
      }
      const data = await res.json();
      setVoorbereiding(data.voorbereiding as Voorbereiding);
      setNotities((data.voorbereiding.eigen_notities || {}) as Record<string, string>);
      setVrijeNotities((data.voorbereiding.vrije_notities || "") as string);
      setNotitiesGewijzigd(false);
      router.refresh();
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Genereren mislukt");
    } finally {
      setBezig(null);
    }
  }

  async function notitiesOpslaan() {
    setFout(null);
    setBezig("notities");
    try {
      const res = await fetch(
        `/api/agendapunten/${agendapuntId}/voorbereiding/notities`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eigen_notities: notities,
            vrije_notities: vrijeNotities,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Opslaan mislukt");
      }
      const data = await res.json();
      setVoorbereiding(data.voorbereiding as Voorbereiding);
      setNotitiesGewijzigd(false);
    } catch (err: unknown) {
      setFout(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setBezig(null);
    }
  }

  function bouwInbrengTekst(includeVrij: boolean): string {
    if (!voorbereiding) return "";
    const ai = voorbereiding.ai_output;
    const stukken: string[] = [];
    // 1. Vrije notities bovenaan (indien aanwezig en gewenst)
    if (includeVrij && vrijeNotities && vrijeNotities.trim()) {
      stukken.push(vrijeNotities.trim());
    }
    // 2. Eigen notities per lens
    if (ai.lenzen) {
      for (const lens of ai.lenzen) {
        const notitie = notities[slug(lens.naam)];
        if (notitie && notitie.trim()) {
          stukken.push(`Wat ${lens.naam.toLowerCase()} betreft: ${notitie.trim()}`);
        }
      }
    }
    // 3. AI-vergadervragen + eventuele eigen notitie per vraag
    if (ai.vergadervragen && ai.vergadervragen.length > 0) {
      const regels = ai.vergadervragen.map((v, i) => {
        const eigen = notities[`vraag_${i + 1}`];
        const basis = `${i + 1}. ${stripMarkers(v)}`;
        return eigen && eigen.trim() ? `${basis}\n   Eigen notitie: ${eigen.trim()}` : basis;
      });
      stukken.push(
        `Vragen die ik graag in de vergadering wil stellen:\n${regels.join("\n")}`
      );
    }
    return stukken.join("\n\n");
  }

  function vulInbreng() {
    if (!voorbereiding || !onVulInbreng) return;
    const heeftVrij = !!vrijeNotities && vrijeNotities.trim().length > 0;
    if (heeftVrij) {
      // Bevestigingsdialoog tonen — voorkomt dat ruwe of vertrouwelijke
      // vrije notities ongewild in de gedeelde inbreng belanden.
      setNeemVrijeNotitiesMee(true);
      setInbrengDialoogOpen(true);
      return;
    }
    // Geen vrije notities — direct doorgeven
    const tekst = bouwInbrengTekst(false);
    if (!tekst) {
      onVulInbreng(
        "(Tip: voeg eigen notities of de AI-vergadervragen toe aan deze inbreng.)"
      );
      return;
    }
    onVulInbreng(tekst);
  }

  function bevestigVulInbreng() {
    if (!onVulInbreng) return;
    const tekst = bouwInbrengTekst(neemVrijeNotitiesMee);
    if (!tekst) {
      onVulInbreng(
        "(Tip: voeg eigen notities of de AI-vergadervragen toe aan deze inbreng.)"
      );
    } else {
      onVulInbreng(tekst);
    }
    setInbrengDialoogOpen(false);
  }

  // Detecteer of er werkelijk een gegenereerde AI-voorbereiding bestaat.
  // Een voorbereidings-rij kan ook bestaan met alleen vrije notities (ai_output = {}).
  const heeftAI = !!(
    voorbereiding &&
    (
      !!voorbereiding.ai_output?.duiding ||
      (voorbereiding.ai_output?.lenzen && voorbereiding.ai_output.lenzen.length > 0) ||
      (voorbereiding.ai_output?.vergadervragen && voorbereiding.ai_output.vergadervragen.length > 0) ||
      !!voorbereiding.ai_output?.samenvatting
    )
  );

  // Geen AI-voorbereiding (gegenereerd) — toon CTA + vrij notitieveld (privé)
  if (!heeftAI) {
    return (
      <div className="bg-amber-50/40 border border-amber-200 rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-3">
          <span className="text-base">🔒</span>
          <div className="flex-1">
            <div className="text-sm font-semibold text-[#0F2744]">
              Mijn voorbereiding
            </div>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              Laat de AI helpen scherper na te denken over dit punt — wat het
              stuk betekent, welk besluit wordt gevraagd, blinde vlekken en
              vragen voor de vergadering. Persoonlijk en alleen voor u zichtbaar.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => genereer("snel")}
                disabled={bezig !== null}
                className="bg-[#0F2744] text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-[#1a3858] disabled:opacity-50"
              >
                {bezig === "genereer"
                  ? "Bezig met opstellen…"
                  : "Genereer voorbereiding"}
              </button>
              <button
                onClick={() => genereer("grondig")}
                disabled={bezig !== null}
                className="text-xs text-[#0F2744] hover:underline disabled:opacity-50"
                title="Doorzoekt ook de bibliotheek, risicomatrix en lopende procedures"
              >
                {bezig === "verdiep"
                  ? "Bezig…"
                  : "Of meteen grondig (zoekt in bibliotheek + modules)"}
              </button>
            </div>
            {fout && <div className="text-xs text-red-700 mt-2">{fout}</div>}
          </div>
        </div>

        {/* Vrij notitieveld — beschikbaar ook zonder AI-voorbereiding */}
        <div className="bg-white border border-amber-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-[#0F2744] uppercase tracking-wide mb-2">
            Mijn aantekeningen
            <span className="text-[10px] text-gray-400 font-normal ml-2 normal-case tracking-normal">
              privé · niet zichtbaar voor anderen
            </span>
          </div>
          <textarea
            rows={3}
            value={vrijeNotities}
            onChange={(e) => {
              setVrijeNotities(e.target.value);
              setNotitiesGewijzigd(true);
            }}
            placeholder="Eigen aantekeningen bij dit agendapunt…"
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-[#C9A84C] outline-none resize-none bg-gray-50"
          />
          {notitiesGewijzigd && (
            <div className="mt-2 flex items-center justify-end">
              <button
                onClick={notitiesOpslaan}
                disabled={bezig === "notities"}
                className="text-xs text-[#0F2744] font-medium hover:underline disabled:opacity-50"
              >
                {bezig === "notities" ? "Opslaan…" : "Aantekeningen opslaan"}
              </button>
            </div>
          )}
        </div>

        {/* Geïntegreerde assistent (0036) — ook zonder gegenereerde voorbereiding
            direct vragen kunnen stellen over dit punt en de stukken. */}
        <AgendapuntChat agendapuntId={agendapuntId} titel={titel} stukken={stukken} />
      </div>
    );
  }

  const ai = voorbereiding.ai_output;
  const duiding = ai.duiding;
  const heeftDuiding = !!(
    duiding &&
    (duiding.betekenis || duiding.gevraagd_besluit || duiding.impact)
  );
  const lenzen = ai.lenzen || [];
  const ontbrekend = ai.ontbrekend || [];
  const vergadervragen = ai.vergadervragen || [];
  const aiBronnen = ai.bronnen || [];
  const meta = voorbereiding.bronnen_meta || {};
  const toonOnderbouwing = () => setOnderbouwingOpen(true);

  return (
    <div className="bg-amber-50/30 border border-amber-200 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2">
          <span className="text-base mt-0.5">🔒</span>
          <div>
            <div className="text-sm font-semibold text-[#0F2744]">
              Mijn voorbereiding
              <span className="text-[10px] uppercase tracking-wide text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded ml-2 font-medium">
                {voorbereiding.diepte === "grondig" ? "Grondig" : "Snel"}
              </span>
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Privé · gegenereerd {formatDatumKort(voorbereiding.gegenereerd_op)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {voorbereiding.diepte === "snel" && (
            <button
              onClick={() => genereer("grondig")}
              disabled={bezig !== null}
              className="text-xs text-[#0F2744] hover:underline disabled:opacity-50"
            >
              {bezig === "verdiep"
                ? "Bezig…"
                : "↗ Verdiep (bibliotheek + modules)"}
            </button>
          )}
          <button
            onClick={() => genereer(voorbereiding.diepte)}
            disabled={bezig !== null}
            className="text-xs text-gray-500 hover:text-[#0F2744] disabled:opacity-50"
            title="Genereer opnieuw"
          >
            ↻ Vernieuwen
          </button>
        </div>
      </div>

      {/* FR-8 backward compat — oud schema zonder duiding: hint om te vernieuwen */}
      {!heeftDuiding && (
        <div className="text-xs text-amber-900 bg-amber-100/70 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
          <span>
            Deze voorbereiding is met een eerdere versie gemaakt en bevat nog
            geen bestuurlijke duiding.
          </span>
          <button
            onClick={() => genereer(voorbereiding.diepte)}
            disabled={bezig !== null}
            className="font-medium underline hover:no-underline disabled:opacity-50 whitespace-nowrap"
          >
            Vernieuw voorbereiding
          </button>
        </div>
      )}

      {/* Bestuurlijke duiding — hoofdproduct (FR-1/FR-5) */}
      {heeftDuiding && (
        <div className="bg-white border border-amber-200 rounded-lg p-3 space-y-2.5">
          <div className="text-xs font-semibold text-[#0F2744] uppercase tracking-wide">
            Bestuurlijke duiding
          </div>
          {duiding!.betekenis && (
            <div className="text-sm text-gray-800 leading-relaxed">
              <CitatieTekst
                tekst={duiding!.betekenis}
                bronnen={aiBronnen}
                onBronKlik={toonOnderbouwing}
              />
            </div>
          )}
          {duiding!.gevraagd_besluit && (
            <div className="text-sm text-gray-800 leading-relaxed border-l-2 border-[#C9A84C] pl-2.5">
              <span className="font-medium text-[#0F2744]">Gevraagd besluit: </span>
              <CitatieTekst
                tekst={duiding!.gevraagd_besluit}
                bronnen={aiBronnen}
                onBronKlik={toonOnderbouwing}
              />
            </div>
          )}
          {duiding!.impact && (
            <div className="text-sm text-gray-800 leading-relaxed">
              <span className="font-medium text-[#0F2744]">Impact: </span>
              <CitatieTekst
                tekst={duiding!.impact}
                bronnen={aiBronnen}
                onBronKlik={toonOnderbouwing}
              />
            </div>
          )}
          {/* FR-7 — zelfde kadering als de chat */}
          <div className="text-[10px] text-gray-400 pt-1 border-t border-gray-100">
            AI-hulpmiddel ter voorbereiding — geen bestuurlijk advies.
          </div>
        </div>
      )}

      {/* Onderbouwing en bronnen (FR-3) — genummerde bronnen + bronnen_meta */}
      {(aiBronnen.length > 0 ||
        meta.documenten?.length ||
        meta.risicos?.length ||
        meta.procedures?.length) && (
        <div className="text-xs text-gray-600">
          <button
            onClick={() => setOnderbouwingOpen(!onderbouwingOpen)}
            className="font-medium hover:text-[#0F2744]"
          >
            {onderbouwingOpen ? "▾" : "▸"} Onderbouwing en bronnen
            {aiBronnen.length > 0 ? ` (${aiBronnen.length})` : ""}
          </button>
          {onderbouwingOpen && (
            <div className="mt-2 space-y-2">
              {aiBronnen.length > 0 && (
                <div className="space-y-1.5">
                  {aiBronnen.map((bron, i) => (
                    <div
                      key={`${bron.document_id}-${i}`}
                      className="bg-white border border-gray-200 rounded px-2 py-1.5"
                    >
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#0F2744] text-white text-[9px] font-semibold mr-1.5">
                        {i + 1}
                      </span>
                      <span className="font-medium text-[#0F2744]">{bron.titel}</span>
                      <span className="text-gray-400"> ({bron.bron})</span>
                      {bron.pagina != null && (
                        <span className="text-gray-500"> · p. {bron.pagina}</span>
                      )}
                      {bron.paragraaf && (
                        <span className="text-gray-500"> · {bron.paragraaf}</span>
                      )}
                      {bron.fragment && (
                        <div className="text-gray-600 mt-0.5 line-clamp-2">
                          “{bron.fragment}”
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-1.5 ml-1">
                {(meta.risicos?.length || 0) > 0 && (
                  <div>
                    <span className="font-semibold">Meegenomen risico&apos;s:</span>{" "}
                    {meta.risicos!.map((r, i) => (
                      <span key={r.id}>
                        {i > 0 ? ", " : ""}
                        {r.titel}{" "}
                        <span
                          className={`px-1 py-0.5 rounded ${NIVEAU_KLEUR[r.niveau] || ""}`}
                        >
                          {r.niveau}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                {(meta.procedures?.length || 0) > 0 && (
                  <div>
                    <span className="font-semibold">Lopende procedures:</span>{" "}
                    {meta.procedures!.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 ? ", " : ""}
                        {p.titel}
                      </span>
                    ))}
                  </div>
                )}
                {/* Oud schema (geen ai_output.bronnen): toon dan de documentenlijst uit bronnen_meta */}
                {aiBronnen.length === 0 && (meta.documenten?.length || 0) > 0 && (
                  <div>
                    <span className="font-semibold">Documenten:</span>{" "}
                    {meta.documenten!.map((d, i) => (
                      <span key={d.id}>
                        {i > 0 ? ", " : ""}
                        {d.titel} <span className="text-gray-400">({d.bron})</span>
                      </span>
                    ))}
                  </div>
                )}
                {meta.profielsturing && (
                  <div className="text-gray-400">
                    Profielsturing:{" "}
                    {meta.profielsturing === "actief"
                      ? "actief (nadruk op uw profiel, zelfde bronnen)"
                      : "geen profiel ingevuld"}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Vrij notitieveld — persoonlijke voorbereiding, los van AI-output */}
      <div className="bg-white border border-amber-200 rounded-lg p-3">
        <div className="text-xs font-semibold text-[#0F2744] uppercase tracking-wide mb-2">
          Mijn aantekeningen
          <span className="text-[10px] text-gray-400 font-normal ml-2 normal-case tracking-normal">
            privé · los van AI-output
          </span>
        </div>
        <textarea
          rows={3}
          value={vrijeNotities}
          onChange={(e) => {
            setVrijeNotities(e.target.value);
            setNotitiesGewijzigd(true);
          }}
          placeholder="Eigen aantekeningen bij dit agendapunt…"
          className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:border-[#C9A84C] outline-none resize-none bg-gray-50"
        />
      </div>

      {/* Lenzen */}
      {lenzen.length > 0 && (
        <div className="space-y-3">
          {lenzen.map((lens, idx) => {
            const sleutel = slug(lens.naam);
            const huidigeNotitie = notities[sleutel] ?? "";
            return (
              <div
                key={idx}
                className="bg-white border border-amber-200 rounded-lg p-3"
              >
                <div className="text-xs font-semibold text-[#0F2744] uppercase tracking-wide">
                  {lens.naam}
                </div>
                <div className="text-sm text-gray-800 mt-1.5 leading-relaxed">
                  <CitatieTekst
                    tekst={lens.analyse}
                    bronnen={aiBronnen}
                    onBronKlik={toonOnderbouwing}
                  />
                </div>
                <div className="mt-2 text-sm text-amber-900 bg-amber-50/60 border border-amber-200 rounded px-2.5 py-1.5">
                  <span className="font-medium">Open vraag:</span>{" "}
                  <CitatieTekst
                    tekst={lens.vraag}
                    bronnen={aiBronnen}
                    onBronKlik={toonOnderbouwing}
                  />
                </div>
                <textarea
                  rows={2}
                  value={huidigeNotitie}
                  onChange={(e) => {
                    setNotities({ ...notities, [sleutel]: e.target.value });
                    setNotitiesGewijzigd(true);
                  }}
                  placeholder="Uw notitie bij deze lens (alleen voor u zichtbaar)…"
                  className="mt-2 w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:border-[#C9A84C] outline-none resize-none bg-gray-50"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Ontbrekend */}
      {ontbrekend.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-[#0F2744] uppercase tracking-wide mb-2">
            Wat staat hier níet
          </div>
          <ul className="space-y-1.5">
            {ontbrekend.map((o, idx) => (
              <li key={idx} className="text-sm text-gray-800 flex gap-2">
                <span className="text-amber-700 mt-0.5">·</span>
                <span>
                  <CitatieTekst
                    tekst={o}
                    bronnen={aiBronnen}
                    onBronKlik={toonOnderbouwing}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Vergadervragen — afsluitend actieblok (FR-5), met eigen notitie per vraag */}
      {vergadervragen.length > 0 && (
        <div className="bg-white border-2 border-[#C9A84C]/50 rounded-lg p-3">
          <div className="text-xs font-semibold text-[#0F2744] uppercase tracking-wide mb-0.5">
            Neem mee de vergadering in
          </div>
          <div className="text-[11px] text-gray-500 mb-2">
            Kritische vragen als afsluiting van uw voorbereiding — noteer per
            vraag wat u ermee wilt.
          </div>
          <ol className="space-y-2.5">
            {vergadervragen.map((v, idx) => {
              const sleutel = `vraag_${idx + 1}`;
              const huidigeNotitie = notities[sleutel] ?? "";
              return (
                <li key={idx} className="text-sm text-gray-800 flex gap-2">
                  <span className="text-[#0F2744] font-semibold tabular-nums w-5 flex-shrink-0">
                    {idx + 1}.
                  </span>
                  <div className="flex-1">
                    <span className="leading-relaxed">
                      <CitatieTekst
                        tekst={v}
                        bronnen={aiBronnen}
                        onBronKlik={toonOnderbouwing}
                      />
                    </span>
                    <textarea
                      rows={1}
                      value={huidigeNotitie}
                      onChange={(e) => {
                        setNotities({ ...notities, [sleutel]: e.target.value });
                        setNotitiesGewijzigd(true);
                      }}
                      placeholder="Uw notitie bij deze vraag (alleen voor u zichtbaar)…"
                      className="mt-1.5 w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:border-[#C9A84C] outline-none resize-none bg-gray-50"
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Samenvatting-oneliner (besluitrijpheid/scherpte) */}
      {ai.samenvatting && (
        <div className="text-sm text-gray-800 italic border-l-2 border-amber-400 pl-3">
          <CitatieTekst
            tekst={ai.samenvatting}
            bronnen={aiBronnen}
            onBronKlik={toonOnderbouwing}
          />
        </div>
      )}

      {/* Acties */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-amber-200">
        <div className="flex items-center gap-3 text-xs">
          {notitiesGewijzigd && (
            <button
              onClick={notitiesOpslaan}
              disabled={bezig !== null}
              className="text-[#0F2744] font-medium hover:underline disabled:opacity-50"
            >
              {bezig === "notities" ? "Opslaan…" : "Notities opslaan"}
            </button>
          )}
          {!notitiesGewijzigd && voorbereiding.bijgewerkt_op && (
            <span className="text-gray-400">
              Notities opgeslagen {formatDatumKort(voorbereiding.bijgewerkt_op)}
            </span>
          )}
        </div>
        {onVulInbreng && (
          <button
            onClick={vulInbreng}
            className="text-xs text-[#0F2744] hover:text-[#C9A84C] font-medium"
          >
            ↓ Gebruik dit als startpunt voor mijn inbreng
          </button>
        )}
      </div>

      {fout && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {fout}
        </div>
      )}

      {/* Geïntegreerde assistent (0036) — doorvragen op de voorbereiding of de
          stukken, binnen hetzelfde privé-blok (één AI-plek per agendapunt). */}
      <AgendapuntChat agendapuntId={agendapuntId} titel={titel} stukken={stukken} />

      {/* Bevestigingsdialoog vóór vullen van inbreng — voorkomt dat ruwe of
          vertrouwelijke vrije notities ongewild in de gedeelde inbreng belanden. */}
      {inbrengDialoogOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="text-sm font-semibold text-[#0F2744]">
              Vrije notities meenemen in inbreng?
            </div>
            <p className="text-xs text-gray-700 leading-relaxed">
              Uw vrije notities worden opgenomen in de concept-inbreng. U kunt deze
              nog bewerken voordat u deelt — maar controleer of de inhoud geschikt
              is voor uw mede-bestuursleden.
            </p>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={neemVrijeNotitiesMee}
                onChange={(e) => setNeemVrijeNotitiesMee(e.target.checked)}
                className="rounded"
              />
              Vrije notities meenemen
            </label>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setInbrengDialoogOpen(false)}
                className="text-xs text-gray-600 hover:text-[#0F2744] px-3 py-1.5"
              >
                Annuleren
              </button>
              <button
                onClick={bevestigVulInbreng}
                className="bg-[#0F2744] text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-[#1a3858]"
              >
                Gebruik in inbreng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
