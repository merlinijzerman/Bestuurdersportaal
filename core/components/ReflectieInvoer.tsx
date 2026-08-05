"use client";

// ============================================================================
//  core/components/ReflectieInvoer.tsx — Plateau B / B-3: het gelabelde
//  reflectie-invoerveld en de conceptkeuze.
// ----------------------------------------------------------------------------
//  WAAROM EEN APART VELD. Het onderscheid tussen "reflectieantwoord" en "gewone
//  vraag" volgt UITSLUITEND uit het gebruikte invoerkanaal (FR-56). Er wordt
//  nooit op inhoud geclassificeerd — niet met een regex, niet met een model,
//  niet met een heuristiek. Wat de gebruiker in dít veld typt is per definitie
//  een reflectieantwoord; wat hij in de normale invoerbalk typt is per definitie
//  een gewone vraag en beëindigt de reflectie.
//
//  Die keuze is niet technisch maar inhoudelijk: een classificatie op inhoud zou
//  betekenen dat het systeem beoordeelt of iemands zin "twijfel genoeg" is. Dat
//  is precies het oordeel dat deze functie niet mag vellen.
//
//  DE DRIE AFRONDLABELS staan vast (besluit 0113, FR-58, AC-26): Klopt ·
//  Aanpassen · Afronden zonder aparte notitie. "Niet opslaan", "Niets bewaren"
//  en "Alleen voor mij bewaren" komen niet voor — de dialoog staat op dat moment
//  al in de privéchat, dus die woorden zouden liegen. "Verwijderen" is geen
//  bestemming binnen de flow (FR-59); een chat verwijderen is een afzonderlijke
//  beheeractie. Ze worden geïmporteerd uit core/lib/reflectie-flow.ts, waar een
//  sanitytest ze bevriest.
// ============================================================================

import { useState } from "react";
import { AFRONDLABELS, type ReflectieStatus } from "@/core/lib/reflectie-flow";

interface Props {
  status: ReflectieStatus;
  /** Antwoord op de verdiepingsvraag. Gaat als reflectiebeurt naar de chatroute. */
  onAntwoord: (tekst: string) => void;
  /** "Klopt" of "Afronden zonder aparte notitie" — beide ronden de flow af. */
  onAfronden: () => void;
  /** "Aanpassen" — de gebruiker herformuleert; blijft in conceptweergave. */
  onAanpassen: () => void;
  /** De reflectie beëindigen zonder af te ronden ("terug naar het gesprek"). */
  onAfbreken: () => void;
  bezig?: boolean;
}

export default function ReflectieInvoer({
  status,
  onAntwoord,
  onAfronden,
  onAanpassen,
  onAfbreken,
  bezig = false,
}: Props) {
  const [tekst, setTekst] = useState("");

  if (status === "niet_actief") return null;

  // ── Conceptweergave: de drie labels, geen invoerveld ──────────────────────
  if (status === "conceptweergave") {
    return (
      <div className="mt-3 rounded-lg border border-line bg-card px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onAfronden}
            disabled={bezig}
            className="text-xs text-ink bg-surface border border-line rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {AFRONDLABELS[0]}
          </button>
          <button
            type="button"
            onClick={onAanpassen}
            disabled={bezig}
            className="text-xs text-ink bg-surface border border-line rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {AFRONDLABELS[1]}
          </button>
          <button
            type="button"
            onClick={onAfronden}
            disabled={bezig}
            className="text-xs text-ink bg-surface border border-line rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {AFRONDLABELS[2]}
          </button>
        </div>
        {/* Letterlijk uit ontwerp v1.0 §9.7. Deze zin bestaat omdat de
            gebruikerstoets (criterium B6) uitwijst of "afronden zonder aparte
            notitie" als verwijderen wordt gelezen. Zo ja, dan is dat een
            kritieke bevinding. */}
        <p className="mt-2 text-[11px] leading-snug text-muted italic">
          De reflectiedialoog blijft onderdeel van deze privéchat. Met deze keuze
          wordt geen afzonderlijke reflectienotitie aangemaakt.
        </p>
      </div>
    );
  }

  // ── Afgerond: alleen terug naar het gesprek (plateau B) ───────────────────
  // De publicatiebestemmingen (als vraag delen, als inbreng voorbereiden, als
  // gedeelde zorg, als aanname, als dissent) zijn plateau C en D. Ze worden hier
  // bewust NIET getoond: een knop die nog niets doet is erger dan geen knop.
  if (status === "afgerond") {
    return (
      <div className="mt-3 rounded-lg border border-line bg-card px-4 py-3">
        <button
          type="button"
          onClick={onAfbreken}
          disabled={bezig}
          className="text-xs text-ink bg-surface border border-line rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Terug naar het gesprek
        </button>
      </div>
    );
  }

  // ── Verdiepingsfase: het gelabelde invoerveld ─────────────────────────────
  const verstuur = () => {
    const schoon = tekst.trim();
    if (!schoon || bezig) return;
    setTekst("");
    onAntwoord(schoon);
  };

  return (
    <div className="mt-3 rounded-lg border border-line bg-card px-4 py-3">
      <label
        htmlFor="reflectie-invoer"
        className="block text-xs font-medium text-ink"
      >
        Uw antwoord op deze verdiepingsvraag
      </label>
      <textarea
        id="reflectie-invoer"
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            verstuur();
          }
        }}
        disabled={bezig}
        rows={3}
        placeholder="In uw eigen woorden — er is geen goed of fout antwoord."
        className="mt-1.5 w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-40"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={verstuur}
          disabled={bezig || tekst.trim().length === 0}
          className="text-xs text-ink bg-surface border border-line rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Versturen
        </button>
        <button
          type="button"
          onClick={onAfbreken}
          disabled={bezig}
          className="text-xs text-muted hover:text-ink disabled:opacity-40 transition-colors"
        >
          Reflectie afronden
        </button>
      </div>
      {/* UX-principe "maak vereisten en blokkers expliciet": zeg vóór de actie
          wat de normale invoerbalk doet, niet achteraf als melding. */}
      <p className="mt-2 text-[11px] leading-snug text-muted">
        Stelt u hieronder een gewone vraag in de invoerbalk, dan wordt de
        reflectie afgerond en behandeld als een normale beurt.
      </p>
    </div>
  );
}
