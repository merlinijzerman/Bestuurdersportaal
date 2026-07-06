"use client";

// Increment I-1 (FO §11c) — "Onderbouwing en bronnen".
// Rustige weergave: de controle-informatie (bronbasis, antwoordmodus, gebruikte
// documenten/bronverwijzingen, of historische context/algemene kennis is
// meegenomen) staat standaard INGEKLAPT onder het antwoord. De bestuurder krijgt
// eerst het inhoudelijke antwoord; deze laag is er voor vertrouwen en controle.
//
// Controlled component: page beheert open/dicht (een klik op een [Bron N]-pill
// of de vervolgactie "Toon gebruikte bronnen" klapt het paneel open en scrolt).
// De bronkaarten zelf komen als children mee (renderlogica leeft in page).

import { type ReactNode } from "react";

export interface OnderbouwingMeta {
  /** Korte samenvatting van de bronbasis (lib/vraagtype.bronbasisLabel). */
  bronbasis?: string | null;
  /** Label van de gebruikte/automatisch bepaalde antwoordmodus. */
  antwoordmodusLabel?: string | null;
  /** Ruwe antwoordmodus-waarde (voor het bepalen van vervolgacties). */
  antwoordmodus?: string | null;
  /** Retrieval-scope: 'actueel' | 'historisch' | 'besluitvorming' | 'alles'. */
  retrievalModus?: string | null;
  /** Peildatum waarop de actuele-bron-filtering is toegepast. */
  peildatum?: string | null;
  /** Of er (ook) algemene kennis is gebruikt. */
  algemeneKennis?: boolean | null;
  /** Aantal geraadpleegde bronnen (voor de count-badge). */
  aantalBronnen?: number;
  // Increment F (FO §14) — profielsturing. De transparantie dat de VOLGORDE/NADRUK
  // op het persoonlijk profiel is afgestemd staat hier in het controlevlak (niet
  // inline in het antwoord). De feitenbasis/bronnen zijn identiek; alleen ordening
  // verschilt. 'uitgeschakeld' = de bestuurder koos "Algemeen perspectief".
  /** Of het persoonlijk profiel de ordening heeft gestuurd. */
  profielsturing?: "actief" | "uitgeschakeld" | "geen-profiel" | null;
  // Increment I-2 (FO §11a) — de automatische bronkeuze. Géén zichtbare badge in
  // de chat; de bestuurder ziet de gekozen intentie hier, in het controlevlak.
  /** Automatisch (of via verduidelijkingschip) bepaalde bron-intentie. */
  bronIntent?: "fonds" | "algemeen" | "gecombineerd" | null;
  /** Vertrouwen in de automatische bronkeuze ('zeker' | 'onzeker'). */
  bronVertrouwen?: "zeker" | "onzeker" | null;
  /** Of de bestuurder de vraag bewust tot fondsdocumenten beperkte. */
  alleenFondsdocumenten?: boolean | null;
  /** Intentie door de gebruiker bevestigd via een verduidelijkingschip (vs. heuristisch). */
  bronIntentOverride?: boolean | null;
  // Increment I-3 — uniforme bronvermelding-transparantie. De model_knowledge-
  // herkomst (algemene kennis uit het taalmodel, met de genoemde instantie), en
  // de web-laag die VOORBEREID is maar nog niet gevuld (Scenario B).
  /** Algemene-kennisbronnen: per genoemde instantie + grond (kennis/wetgeving). */
  modelKennis?: { grond: "algemene_kennis" | "wetgeving"; instantie: string | null }[];
  /** False zolang er geen live web-retrieval is — toont een expliciete melding. */
  webRetrievalActief?: boolean | null;
  /** Daadwerkelijk opgehaalde webbronnen (leeg tot web-retrieval bestaat). */
  webBronnen?: { url: string; titel: string; domein: string; datum?: string | null }[];
}

const MODEL_KENNIS_GROND_LABEL: Record<string, string> = {
  algemene_kennis: "Algemene kennis",
  wetgeving: "Volgens wetgeving",
};

// Bestuurlijk leesbare labels voor de automatische bronkeuze (geen jargon).
const BRON_INTENT_LABEL: Record<string, string> = {
  fonds: "Eigen fondsdocumenten",
  algemeen: "Algemene kennis",
  gecombineerd: "Fondsdocumenten + algemene kennis",
};

interface Props {
  meta: OnderbouwingMeta;
  open: boolean;
  onToggle: () => void;
  ankerId?: string;
  /** De bronkaarten (gerenderd door page). */
  children?: ReactNode;
}

function Rij({ label, waarde }: { label: string; waarde: ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-gray-400 w-36 flex-shrink-0">{label}</span>
      <span className="text-gray-700">{waarde}</span>
    </div>
  );
}

export default function OnderbouwingPaneel({
  meta,
  open,
  onToggle,
  ankerId,
  children,
}: Props) {
  const historischMeegenomen = meta.retrievalModus === "historisch";

  return (
    <div id={ankerId} className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-3 px-3 py-2 bg-white border border-gray-200 text-left hover:bg-gray-50 transition-colors ${
          open ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="text-gray-400 text-xs">
            🔎
          </span>
          <span className="text-xs font-semibold text-[#0F2744]">
            Onderbouwing en bronnen
          </span>
          {typeof meta.aantalBronnen === "number" && meta.aantalBronnen > 0 && (
            <span className="text-[11px] text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full font-medium">
              {meta.aantalBronnen}
            </span>
          )}
        </span>
        <span
          aria-hidden
          className={`flex-shrink-0 text-gray-400 text-xs transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="border border-t-0 border-gray-200 rounded-b-lg bg-white px-3 py-3 space-y-3">
          {/* Gestructureerde controle-informatie (§11c). */}
          <div className="space-y-1">
            {meta.alleenFondsdocumenten ? (
              <Rij label="Brongebruik" waarde="Beperkt tot fondsdocumenten (uw keuze)" />
            ) : (
              meta.bronIntent && (
                <Rij
                  label="Brongebruik"
                  waarde={
                    <>
                      {BRON_INTENT_LABEL[meta.bronIntent] ?? meta.bronIntent}
                      <span className="text-gray-400">
                        {" "}
                        {meta.bronIntentOverride
                          ? "— door u bevestigd na verduidelijking"
                          : "— automatisch gekozen"}
                      </span>
                    </>
                  }
                />
              )
            )}
            {meta.bronbasis && <Rij label="Bronbasis" waarde={meta.bronbasis} />}
            {meta.antwoordmodusLabel && (
              <Rij label="Antwoordmodus" waarde={meta.antwoordmodusLabel} />
            )}
            {typeof meta.algemeneKennis === "boolean" && (
              <Rij
                label="Algemene kennis"
                waarde={meta.algemeneKennis ? "Gebruikt" : "Niet gebruikt"}
              />
            )}
            <Rij
              label="Historische context"
              waarde={historischMeegenomen ? "Meegenomen" : "Niet meegenomen"}
            />
            {meta.peildatum && <Rij label="Peildatum" waarde={meta.peildatum} />}
            {meta.profielsturing === "actief" && (
              <Rij
                label="Persoonlijk profiel"
                waarde={
                  <>
                    Volgorde en nadruk afgestemd op uw profiel.
                    <span className="text-gray-400">
                      {" "}
                      Zelfde feiten en bronnen; zet &ldquo;Algemeen perspectief&rdquo;
                      aan onder &ldquo;Aanpassen&rdquo; voor de collectieve weergave.
                    </span>
                  </>
                }
              />
            )}
            {meta.profielsturing === "uitgeschakeld" && (
              <Rij
                label="Persoonlijk profiel"
                waarde="Algemeen perspectief — collectieve weergave, niet op uw profiel geprioriteerd"
              />
            )}
          </div>

          {/* Aannames en beperkingen staan inhoudelijk in het antwoord zelf
              (duiding/sparring scheiden feit/interpretatie/aanname expliciet). */}
          <p className="text-[11px] text-gray-400 italic">
            Aannames, beperkingen en openstaande vragen staan, waar van toepassing,
            in het antwoord zelf benoemd.
          </p>

          {/* Increment I-3 — herkomst gegroepeerd per soort, zodat de bestuurder
              ziet welk deel van het antwoord uit fondsdocumenten komt, wat
              algemene kennis is, en (voorbereid) wat uit het web zou komen. */}

          {/* 1) Documentbronnen (RAG) — de bronkaarten komen als children mee. */}
          {children ? (
            <div>
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                Documentbronnen
              </div>
              <div className="space-y-2">{children}</div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              Geen interne documentbronnen geraadpleegd voor dit antwoord.
            </p>
          )}

          {/* 2) Niet-brongebaseerde duiding — algemene kennis uit het taalmodel.
              Toont de door het antwoord GENOEMDE instantie; nooit een verzonnen
              documentverwijzing. */}
          {meta.modelKennis && meta.modelKennis.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                Niet-brongebaseerde duiding (algemene kennis)
              </div>
              <ul className="space-y-1">
                {meta.modelKennis.map((mk, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-[10px] font-semibold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                      {MODEL_KENNIS_GROND_LABEL[mk.grond] ?? mk.grond}
                    </span>
                    <span className="text-gray-700">
                      {mk.instantie ?? "Geen specifieke instantie benoemd"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-gray-400 italic">
                Dit deel komt uit de algemene kennis van het taalmodel, niet uit een
                geverifieerde bron. Er is geen live web-retrieval actief; controleer
                bij formele besluitvorming de genoemde instantie zelf.
              </p>
            </div>
          )}

          {/* 3) Webbronnen — VOORBEREID maar nog niet gevuld (Scenario B). Pas
              zichtbaar zodra echte web-retrieval bestaat én resultaten oplevert. */}
          {meta.webRetrievalActief && meta.webBronnen && meta.webBronnen.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                Webbronnen
              </div>
              <ul className="space-y-1">
                {meta.webBronnen.map((w, i) => (
                  <li key={i} className="text-xs">
                    <a
                      href={w.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#0F2744] underline hover:text-accent"
                    >
                      {w.titel}
                    </a>
                    <span className="text-gray-400"> — {w.domein}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
