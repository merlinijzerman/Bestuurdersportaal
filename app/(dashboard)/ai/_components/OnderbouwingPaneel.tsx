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
import { normgewichtLabel, isVeiligeUrl } from "@/core/lib/bronsoort";
import { samenvattingDocumentnamen } from "@/core/lib/bronsamenvatting";

export interface OnderbouwingMeta {
  /** Korte samenvatting van de bronbasis (lib/vraagtype.bronbasisLabel). */
  bronbasis?: string | null;
  /** Label van de gebruikte/automatisch bepaalde antwoordmodus. */
  antwoordmodusLabel?: string | null;
  /** Ruwe antwoordmodus-waarde (voor het bepalen van vervolgacties). */
  antwoordmodus?: string | null;
  /** Retrieval-scope: 'actueel' | 'historisch' | 'besluitvorming' | 'alles'. */
  retrievalModus?: string | null;
  // Besluit 0139 (M-R4) — de zoekvraag waarop daadwerkelijk is gezocht en of die
  // door de history-aware reformulatie is herschreven. Alleen tonen bij
  // `gereformuleerd = true`; anders verandert de weergave niet.
  /** De (mogelijk herschreven) zoekvraag waarop is gezocht. */
  zoekvraag?: string | null;
  /** Of de vraag is herschreven tot een zelfstandige zoekvraag. */
  gereformuleerd?: boolean;
  /** Peildatum waarop de actuele-bron-filtering is toegepast. */
  peildatum?: string | null;
  /** Of er (ook) algemene kennis is gebruikt. */
  algemeneKennis?: boolean | null;
  /** Aantal geraadpleegde bronnen (voor de count-badge). */
  aantalBronnen?: number;
  /**
   * Documenttitels van de geraadpleegde bronnen, voor de ingeklapte balk.
   * Client-side afgeleid uit de bronnen die de caller tóch al heeft — géén extra
   * veld in de API-payload.
   */
  bronTitels?: string[];
  // Increment F (FO §14) — profielsturing. De transparantie dat de VOLGORDE/NADRUK
  // op het persoonlijk profiel is afgestemd staat hier in het controlevlak (niet
  // inline in het antwoord). De feitenbasis/bronnen zijn identiek; alleen ordening
  // verschilt. 'uitgeschakeld' = de bestuurder koos "Algemeen perspectief".
  /** Of het persoonlijk profiel de ordening heeft gestuurd. */
  profielsturing?: "actief" | "uitgeschakeld" | "geen-profiel" | null;
  // OP-4 (FO Organisatieprofiel v0.4 §8) — of het organisatieprofiel is meegewogen
  // ('actief') of ontbrak/leeg was ('geen-profiel'). De _aspecten voeden het
  // onderscheid feiten/strategie/risicohouding in het paneel (metadata, geen inhoud).
  /** Of het organisatieprofiel als context is meegewogen. */
  organisatieprofiel?: "actief" | "geen-profiel" | null;
  /** Welke veldgroepen zijn geïnjecteerd — voedt de feiten/strategie/risicohouding-split. */
  organisatieprofielAspecten?: {
    organisatietype: boolean;
    uitvoerende_partijen: boolean;
    omvang: boolean;
    kernfeiten: boolean;
    missie: boolean;
    visie: boolean;
    strategische_speerpunten: boolean;
    risicohouding: boolean;
    peildatum: string | null;
  } | null;
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
  // Contextbesef (besluit 0090) — of de PORTAALSTAND (eigen eerstvolgende
  // processtap, komende vergadering, agendapunten zonder eigen inbreng) is
  // meegewogen. Aparte aanduiding in het controlevlak, onderscheiden van de
  // documentbronnen (transparantielijn besluit 0071).
  /** Of de eigen portaalstand als context is meegewogen. */
  portaalstandGebruikt?: boolean | null;
  // Increment I-3 — uniforme bronvermelding-transparantie. De model_knowledge-
  // herkomst (algemene kennis uit het taalmodel, met de genoemde instantie), en
  // de web-laag die VOORBEREID is maar nog niet gevuld (Scenario B).
  /** Algemene-kennisbronnen: per genoemde instantie + grond (kennis/wetgeving). */
  modelKennis?: { grond: "algemene_kennis" | "wetgeving"; instantie: string | null }[];
  /** True als voor dit antwoord live web-retrieval webbronnen opleverde (Scenario A). */
  webRetrievalActief?: boolean | null;
  /** Geverifieerde webbronnen (URL + titel + domein + ophaaldatum + normgewicht). */
  webBronnen?: {
    url: string;
    titel: string;
    domein: string;
    datum?: string | null;
    normgewicht?: string | null;
    ophaaldatum?: string | null;
  }[];
  // B1 / scope-split — reizen mee zodat de vervolgacties na herladen consistent zijn.
  /** Ging de vraag over een specifiek stuk of agendapunt? Stuurt de vervolgacties. */
  documentGericht?: boolean | null;
  /** Inhoudelijke vervolgvragen (B1), op basis van het antwoord gegenereerd. */
  vervolgvragen?: string[] | null;
}

const MODEL_KENNIS_GROND_LABEL: Record<string, string> = {
  algemene_kennis: "Algemene kennis",
  wetgeving: "Volgens wetgeving",
};

// OP-4 — welke veldgroepen uit het organisatieprofiel zijn meegewogen. Bepaalt
// het feiten/strategie/risicohouding-onderscheid dat het paneel toont (§8).
function organisatieprofielVeldgroepen(
  a: NonNullable<OnderbouwingMeta["organisatieprofielAspecten"]>
): string[] {
  const groepen: string[] = [];
  if (a.organisatietype || a.uitvoerende_partijen || a.omvang || a.kernfeiten)
    groepen.push("feiten");
  if (a.missie || a.visie || a.strategische_speerpunten) groepen.push("strategie");
  if (a.risicohouding) groepen.push("risicohouding");
  return groepen;
}

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
  /**
   * Kolommen voor de bronkaarten. 1 (default) voor smalle surfaces zoals de
   * inline agendapuntchat; /ai geeft 2 — daar is de kolom 1020px breed en werd
   * één lange lijst onnodig lang.
   */
  bronKolommen?: 1 | 2;
  /**
   * Anti-dubbeling (besluit 0099): bij antwoordmodus `bronoverzicht` staan de
   * documenten in het ANTWOORD, niet hier. Het paneel houdt dan alleen de
   * verantwoording. Zonder deze vlag zou de fallbacktekst "Geen interne
   * documentbronnen geraadpleegd" verschijnen — feitelijk onjuist, want ze zijn
   * juist wél geraadpleegd en staan hierboven.
   */
  bronnenInAntwoord?: boolean;
  /** De bronkaarten (gerenderd door page). */
  children?: ReactNode;
}

function Rij({ label, waarde }: { label: string; waarde: ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-muted w-36 flex-shrink-0">{label}</span>
      <span className="text-ink">{waarde}</span>
    </div>
  );
}

export default function OnderbouwingPaneel({
  meta,
  open,
  onToggle,
  ankerId,
  bronKolommen = 1,
  bronnenInAntwoord = false,
  children,
}: Props) {
  const historischMeegenomen = meta.retrievalModus === "historisch";
  // Samenvatting in de INGEKLAPTE balk. Bewust geen retrievalmethode: die staat
  // uitsluitend server-side in retrieval_meta (auditspoor) en zou een
  // payloaduitbreiding vragen. `bronbasis` zegt in bestuurlijke taal hetzelfde
  // waar het hier om gaat: waarop steunt dit antwoord.
  const documentnamen = samenvattingDocumentnamen(meta.bronTitels ?? []);

  return (
    <div id={ankerId} className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-3 px-3 py-2 bg-white border border-line text-left hover:bg-app-bg transition-colors ${
          open ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="text-muted text-xs">
            🔎
          </span>
          <span className="text-xs font-semibold text-ink flex-shrink-0">
            Onderbouwing en bronnen
          </span>
          {typeof meta.aantalBronnen === "number" && meta.aantalBronnen > 0 && (
            <span className="text-[11px] text-muted bg-app-bg px-2 py-0.5 rounded-full font-medium flex-shrink-0">
              {meta.aantalBronnen}
            </span>
          )}
          {documentnamen && (
            <span className="text-[11px] text-muted truncate min-w-0">
              {documentnamen}
            </span>
          )}
          {meta.bronbasis && (
            <span className="text-[11px] text-muted hidden lg:inline flex-shrink-0">
              · {meta.bronbasis}
            </span>
          )}
        </span>
        <span
          aria-hidden
          className={`flex-shrink-0 text-muted text-xs transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="border border-t-0 border-line rounded-b-lg bg-white px-3 py-3 space-y-3">
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
                      <span className="text-muted">
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
            {/* Besluit 0139 (M-R4) — bij een herschreven vervolgvraag tonen we de
                zoekvraag waarop daadwerkelijk is gezocht. Zo is voor de bestuurder
                zichtbaar en reproduceerbaar waarop de bronnen zijn gevonden. */}
            {meta.gereformuleerd && meta.zoekvraag && (
              <Rij
                label="Gezochte zoekvraag"
                waarde={
                  <>
                    “{meta.zoekvraag}”
                    <span className="text-muted">
                      {" "}
                      — uw vervolgvraag is voor het zoeken herschreven tot een
                      zelfstandige zoekvraag.
                    </span>
                  </>
                }
              />
            )}
            {meta.profielsturing === "actief" && (
              <Rij
                label="Persoonlijk profiel"
                waarde={
                  <>
                    Volgorde en nadruk afgestemd op uw profiel.
                    <span className="text-muted">
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
            {meta.portaalstandGebruikt && (
              <Rij
                label="Portaalstand"
                waarde={
                  <>
                    Meegewogen als uw eigen proces-/taakstand.
                    <span className="text-muted">
                      {" "}
                      Uw eerstvolgende processtap, de komende vergadering en
                      agendapunten zonder uw inbreng — geen documentbron, maar de
                      actuele stand uit het portaal.
                    </span>
                  </>
                }
              />
            )}
            {meta.organisatieprofiel === "actief" && (
              <Rij
                label="Organisatieprofiel"
                waarde={
                  <>
                    Meegewogen als organisatiecontext
                    {meta.organisatieprofielAspecten &&
                      organisatieprofielVeldgroepen(meta.organisatieprofielAspecten).length > 0 &&
                      ` — ${organisatieprofielVeldgroepen(meta.organisatieprofielAspecten).join(" · ")}`}
                    .
                    <span className="text-muted">
                      {" "}
                      Organisatiespecifieke context; weegt onder wet- en regelgeving
                      en formele stukken.
                      {meta.organisatieprofielAspecten?.peildatum
                        ? ` Peildatum ${meta.organisatieprofielAspecten.peildatum}.`
                        : ""}
                    </span>
                  </>
                }
              />
            )}
          </div>

          {/* Aannames en beperkingen staan inhoudelijk in het antwoord zelf
              (duiding/sparring scheiden feit/interpretatie/aanname expliciet). */}
          <p className="text-[11px] text-muted italic">
            Aannames, beperkingen en openstaande vragen staan, waar van toepassing,
            in het antwoord zelf benoemd.
          </p>

          {/* Increment I-3 — herkomst gegroepeerd per soort, zodat de bestuurder
              ziet welk deel van het antwoord uit fondsdocumenten komt, wat
              algemene kennis is, en (voorbereid) wat uit het web zou komen. */}

          {/* 1) Documentbronnen (RAG) — de bronkaarten komen als children mee.
                 Bij `bronoverzicht` staan ze in het antwoord (besluit 0099) en
                 houdt dit paneel alleen de verantwoording: geen dubbele lijst. */}
          {bronnenInAntwoord ? (
            <p className="text-xs text-muted">
              De gevonden documenten staan als lijst in het antwoord hierboven.
            </p>
          ) : children ? (
            <div>
              <div className="text-[11px] font-bold text-muted uppercase tracking-wide mb-2">
                Documentbronnen
              </div>
              <div
                className={
                  bronKolommen === 2
                    ? "grid gap-2 md:grid-cols-2 items-start"
                    : "space-y-2"
                }
              >
                {children}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">
              Geen interne documentbronnen geraadpleegd voor dit antwoord.
            </p>
          )}

          {/* 2) Niet-brongebaseerde duiding — algemene kennis uit het taalmodel.
              Toont de door het antwoord GENOEMDE instantie; nooit een verzonnen
              documentverwijzing. */}
          {meta.modelKennis && meta.modelKennis.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-muted uppercase tracking-wide mb-2">
                Niet-brongebaseerde duiding (algemene kennis)
              </div>
              <ul className="space-y-1">
                {meta.modelKennis.map((mk, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-[10px] font-semibold text-muted bg-app-bg px-1.5 py-0.5 rounded">
                      {MODEL_KENNIS_GROND_LABEL[mk.grond] ?? mk.grond}
                    </span>
                    <span className="text-ink">
                      {mk.instantie ?? "Geen specifieke instantie benoemd"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted italic">
                Dit deel komt uit de algemene kennis van het taalmodel, niet uit een
                geverifieerde bron. Er is geen live web-retrieval actief; controleer
                bij formele besluitvorming de genoemde instantie zelf.
              </p>
            </div>
          )}

          {/* 3) Webbronnen (Scenario A, besluit 0072) — daadwerkelijk opgehaalde en
              tegen de whitelist geverifieerde externe bronnen: URL + titel +
              ophaaldatum + normgewicht-badge, gescheiden van fondsbronnen. */}
          {meta.webRetrievalActief && meta.webBronnen && meta.webBronnen.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-muted uppercase tracking-wide mb-2">
                Webbronnen (live opgehaald)
              </div>
              <ul className="space-y-1.5">
                {meta.webBronnen.map((w, i) => (
                  <li key={i} className="text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* L-04: dezelfde rendergate als elders in de app. De URL
                          komt bij herladen uit gesprekken.berichten (jsonb, door
                          de gebruiker zelf beschrijfbaar), dus her-valideren. */}
                      {isVeiligeUrl(w.url) ? (
                        <a
                          href={w.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink underline hover:text-accent"
                        >
                          {w.titel}
                        </a>
                      ) : (
                        <span className="text-ink">{w.titel}</span>
                      )}
                      {w.normgewicht && (
                        <span className="text-[10px] font-semibold text-muted bg-app-bg px-1.5 py-0.5 rounded">
                          {normgewichtLabel(w.normgewicht)}
                        </span>
                      )}
                    </div>
                    <span className="text-muted">
                      {w.domein}
                      {w.ophaaldatum
                        ? ` — opgehaald ${new Date(w.ophaaldatum).toLocaleString("nl-NL", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted italic">
                Live opgehaald uit gezaghebbende bronnen op het genoemde moment. Bij
                tijdgevoelige informatie (deadlines, tarieven, wetsstatus): verifieer
                bij formele besluitvorming de instantie zelf.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
