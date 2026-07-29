// ============================================================================
//  Voorbeeldvragen bij de vrije vraag — pure vragenpool (P2 Deel A).
// ----------------------------------------------------------------------------
//  Levert maximaal drie voorbeeldvragen voor de lege staat van /ai, afgeleid
//  UITSLUITEND uit de al opgehaalde PortaalContext (getPortaalContext). Er komt
//  bewust GEEN nieuwe database-query bij (werkopdracht A6 / acceptatiecriterium
//  6): elke generator leest alleen velden die het startpunt toch al toont.
//
//  Twee generatoren vullen een pool met kandidaten; een selectieregel toont er
//  drie, elk van een verschillende `vraagsoort` (Antwoordmodus), met de
//  signaal-vragen bovenaan. Puur en programmatisch narekenbaar (zie
//  startvragen.sanity.ts) — geen DB, geen React, geen modelaanroep. Dat laatste
//  is een expliciete keuze: een taalmodel-gegenereerde vraag kost latency op een
//  scherm dat direct moet staan en zou nieuwe AI-functionaliteit zijn (CLAUDE.md:
//  niet zonder prompt-/outputlogging).
//
//  Neutraal-kritisch, nooit richting een uitkomst (mockup "blinde vlek"):
//  vraagvormen als "welk besluit wordt gevraagd" / "is dit besluitrijp", nooit
//  een oordeel of aanbeveling. En nooit rol-/expertise- of collega-gedreven —
//  dat bouwt onzichtbaar kokers in een collegiaal verantwoordelijk orgaan.
//
//  BEWUST NIET in dit plateau (zie werkopdracht + planbesluit 29-07):
//   - de `procedure_requirements`-signaalvariant (onvervuld bewijsstuk): die is
//     niet in de portaalcontext geladen; ophalen zou een nieuwe query zijn.
//   - procesfase-weging (beeldvorming/oordeelsvorming/…): die viertrapsfase
//     bestaat niet in het datamodel en is niet geladen. Sorteren gebeurt op de
//     wél-geladen signalen (signaal > context, en nabijheid) i.p.v. op fase.
// ============================================================================

import type { PortaalContext } from "./portaalcontext-afleiding";
import type { Antwoordmodus } from "./vraagtype";

/** Herkomst van een voorbeeldvraag — meetbaar gelogd bij een klik (criterium 4). */
export type StartvraagBron = "context" | "signaal";

export interface Startvraag {
  tekst: string;
  bron: StartvraagBron;
  /** Antwoordmodus-soort; stuurt de spreiding (max één per soort). */
  vraagsoort: Antwoordmodus;
  /** Hoger = eerder getoond. Signaal weegt zwaarder dan context. */
  gewicht: number;
}

/** Een naderende deadline telt als signaal binnen deze horizon. */
export const NADEREND_DAGEN = 21;

// ── Generatoren ──────────────────────────────────────────────────────────────

/**
 * Contextvragen: vaste zinsvormen gevuld met titels uit de context. Elke vorm
 * heeft een vaste `vraagsoort` zodat de spreiding deterministisch is (geen
 * heuristiek op de gegenereerde tekst). Volgorde/gewicht: agendapunt > document
 * > processtap > vergadering (aflopend), zodat het meest concrete bovenaan komt.
 */
export function genereerContextvragen(ctx: PortaalContext): Startvraag[] {
  const uit: Startvraag[] = [];

  const ap = ctx.agendapunten.eersteZonderInbreng;
  if (ap) {
    uit.push({
      tekst: `Welk besluit wordt gevraagd bij «${ap.titel}», en is dat stuk daarvoor besluitrijp?`,
      bron: "context",
      vraagsoort: "besluitrijpheid",
      gewicht: 60,
    });
  }

  const doc = ctx.recentDocument;
  if (doc) {
    uit.push({
      tekst: `Welke risico's zitten er voor het fonds in «${doc.titel}»?`,
      bron: "context",
      vraagsoort: "duiding",
      gewicht: 55,
    });
  }

  const stap = ctx.openStappen[0];
  if (stap) {
    uit.push({
      tekst: `Wat houdt «${stap.naam}» in en wat wordt er van mij verwacht?`,
      bron: "context",
      vraagsoort: "feitelijk",
      gewicht: 50,
    });
  }

  const verg = ctx.volgendeVergadering;
  if (verg) {
    uit.push({
      tekst: `Welke stukken horen bij de vergadering «${verg.titel}»?`,
      bron: "context",
      vraagsoort: "bronoverzicht",
      gewicht: 45,
    });
  }

  return uit;
}

/**
 * Signaalvragen: afgeleid van wat er ontbreekt of knelt, en UITSLUITEND uit de
 * twee signalen die de portaalcontext al kent — een agendapunt zonder eigen
 * inbreng, en een naderende deadline op de eerstvolgende processtap. `nuMs` is
 * expliciet meegegeven (geen Date.now() in de pure laag) zodat de deadline-check
 * deterministisch narekenbaar is.
 */
export function genereerSignaalvragen(
  ctx: PortaalContext,
  nuMs: number
): Startvraag[] {
  const uit: Startvraag[] = [];

  const ap = ctx.agendapunten.eersteZonderInbreng;
  if (ap) {
    uit.push({
      tekst: `Op «${ap.titel}» heb ik nog geen inbreng geplaatst — waar moet ik op letten?`,
      bron: "signaal",
      vraagsoort: "persoonlijke_voorbereiding",
      gewicht: 100,
    });
  }

  const stap = ctx.openStappen[0];
  if (stap?.deadline) {
    const dagen = Math.ceil((new Date(stap.deadline).getTime() - nuMs) / 86400000);
    if (dagen >= 0 && dagen <= NADEREND_DAGEN) {
      uit.push({
        tekst: `«${stap.naam}» heeft een deadline over ${dagen} ${
          dagen === 1 ? "dag" : "dagen"
        } — wat is er nog nodig om die te halen?`,
        bron: "signaal",
        vraagsoort: "besluitrijpheid",
        gewicht: 95,
      });
    }
  }

  return uit;
}

// ── Selectie ──────────────────────────────────────────────────────────────────

/**
 * Kiest uit de pool maximaal `max` vragen, greedy op aflopend gewicht, met
 * hooguit ÉÉN vraag per `vraagsoort` (A2: de getoonde vragen zijn van
 * verschillend soort en laten en passant zien wat de assistent aankan). Stabiel:
 * bij gelijk gewicht wint de eerder ingevoegde kandidaat.
 */
export function kiesStartvragen(pool: Startvraag[], max = 3): Startvraag[] {
  const gesorteerd = pool
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v.gewicht - a.v.gewicht || a.i - b.i)
    .map((x) => x.v);

  const gekozen: Startvraag[] = [];
  const soortenGezien = new Set<Antwoordmodus>();
  for (const v of gesorteerd) {
    if (gekozen.length >= max) break;
    if (soortenGezien.has(v.vraagsoort)) continue;
    soortenGezien.add(v.vraagsoort);
    gekozen.push(v);
  }
  return gekozen;
}

/**
 * De ≤3 voorbeeldvragen voor de lege staat van /ai. Combineert beide generatoren
 * en past de selectieregel toe. Levert een lege lijst als er geen context is
 * (dan toont het startpunt geen chips) — nooit generieke placeholdertekst.
 */
export function startvragenVoor(ctx: PortaalContext, nuMs: number): Startvraag[] {
  const pool = [...genereerSignaalvragen(ctx, nuMs), ...genereerContextvragen(ctx)];
  return kiesStartvragen(pool, 3);
}
