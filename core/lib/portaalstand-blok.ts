// ============================================================================
//  Portaalstand-blok — contextbesef (besluit 0090).
// ----------------------------------------------------------------------------
//  PURE opmaak van de "portaalstand" die de chat-route als context meestuurt bij
//  een persoonlijke of statusgerichte vraag: de eigen eerstvolgende processtap,
//  de komende vergadering en de agendapunten zonder eigen inbreng. De GEGEVENS
//  komen server-side uit getPortaalContext (core/lib/portaalcontext.ts) — dezelfde
//  bron die het AI-startpunt gebruikt, uitsluitend onder RLS op de sessie. Deze
//  functie doet geen I/O en is los narekenbaar (portaalstand-blok.sanity.ts).
//
//  KEUZES:
//   - Benoemde tekst, geen genummerde bron (gelijk aan modulesBlok): het model
//     verwijst bij naam, niet als [Bron N]. De stand is expliciet een STAND, geen
//     vastgesteld besluit — zowel in het label als in de instructie.
//   - De instructie (signaleren, niet adviseren; tegenspraak benoemen) reist mee
//     ín het blok, zodat de kostbare toon-systeemprompt byte-identiek blijft (§4b).
//   - Lege onderdelen worden weggelaten; is er niets, dan is het blok leeg ("").
// ============================================================================

import type { PortaalContext } from "@/core/lib/portaalcontext-afleiding";

/** Leesbare datum (dag maand jaar) voor in de prompt. Ongeldige input → "". */
function datumKort(d: string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Leesbare datum + tijd voor de vergadering. Ongeldige input → "". */
function datumLang(d: string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// De instructie bij het standblok (§4b, human-in-the-loop): signaleren wat
// openstaat, nooit een besluit/opdracht opdragen, en een tegenspraak met een
// document/besluit expliciet benoemen i.p.v. stilzwijgend kiezen (besluitpunt 2).
const PORTAALSTAND_INSTRUCTIE =
  "Gebruik de portaalstand om te benoemen wat er voor deze bestuurder nog openstaat. " +
  'Signaleer ("hier staat nog open…", "hier is nog geen inbreng geplaatst") — draag ' +
  'nooit een besluit of opdracht op ("u moet nu X doen"). Spreekt de portaalstand een ' +
  "document of genotuleerd besluit tegen, benoem dan beide expliciet en kies niet " +
  "stilzwijgend één van beide.";

/**
 * Bouwt het portaalstand-contextblok uit de (reeds server-side opgehaalde)
 * portaalcontext. Puur: geen DB, geen datum-`now`-afhankelijkheid behalve de
 * meegegeven datums. Geeft "" terug als er geen enkel stand-element is (dan gaat
 * er geen blok mee). Bevat GEEN leidende witregels; de aanroeper componeert die.
 */
export function bouwPortaalstandBlok(stand: PortaalContext): string {
  const regels: string[] = [];

  const eersteStap = stand.openStappen[0] ?? null;
  if (eersteStap) {
    const deadline = datumKort(eersteStap.deadline);
    regels.push(
      `- Uw eerstvolgende processtap: «${eersteStap.naam}» in «${eersteStap.procedure_titel}»` +
        (deadline ? ` — deadline ${deadline}` : "")
    );
  }

  if (stand.volgendeVergadering) {
    const wanneer = datumLang(stand.volgendeVergadering.datum);
    regels.push(
      `- Komende vergadering: «${stand.volgendeVergadering.titel}»` +
        (wanneer ? ` op ${wanneer}` : "")
    );
    const ap = stand.agendapunten;
    if (ap.totaal > 0) {
      // T1 bureau-rol (§6.6): bij maatstaf `gekoppeld_stuk` telt de context iets
      // anders, dus zegt de promptregel ook iets anders. Zonder deze tak zou de
      // assistent tegen een bureaugebruiker over "uw eigen inbreng" spreken —
      // een uiting die het bureau niet doet en niet kan zien. De bestaande regel
      // (maatstaf `eigen_inbreng`) blijft byte-voor-byte gelijk: nulgrens G23.
      if (ap.maatstaf === "gekoppeld_stuk") {
        const eerste = ap.eersteZonderStuk;
        regels.push(
          `- Agendapunten zonder gekoppeld stuk: ${ap.zonderGekoppeldStuk} van ${ap.totaal}` +
            (eerste ? `; eerstvolgende «${eerste.titel}»` : "")
        );
      } else {
        const eerste = ap.eersteZonderInbreng;
        regels.push(
          `- Agendapunten zonder uw eigen inbreng: ${ap.zonderEigenInbreng} van ${ap.totaal}` +
            (eerste ? `; eerstvolgende «${eerste.titel}»` : "")
        );
      }
    }
  }

  if (regels.length === 0) return "";

  return (
    "=== UW PORTAALSTAND (context — geen genummerde bron; dit is uw actuele " +
    "proces-/taakstand in het portaal, geen vastgesteld besluit) ===\n" +
    regels.join("\n") +
    "\n\n" +
    PORTAALSTAND_INSTRUCTIE
  );
}
