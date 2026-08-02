// ============================================================================
//  Fondsleden — weergavenaam + rol van collega's binnen het eigen fonds.
// ----------------------------------------------------------------------------
//  WAAROM DIT BESTAAT. Het portaal bewaarde bij elke schrijfactie een KOPIE van
//  `profielen.naam` (`procedure_eigenaars.gebruiker_naam`, `procedure_log.
//  actor_naam`, …), omdat de RLS op `profielen` strikt de eigen rij afdekt en
//  niemand de naam van een collega kon lezen. Die kopieën verouderen stil zodra
//  iemand zijn naam wijzigt, en ze bevriezen een fout — een account dat zonder
//  naam is geregistreerd krijgt via `maak_profiel()` het e-mailadres als naam,
//  en dát adres stond vervolgens voorgoed in het dossier.
//
//  Migratie 2026-08-02 voegt `public.vw_fondsleden` toe: een smalle, fonds-
//  gescopete projectie met alleen id/naam/rol. Deze helper leest die view en
//  levert een opzoektabel, zodat schermen de naam LIVE kunnen tonen.
//
//  BEWUST GEEN VERVANGING VAN DE SNAPSHOTS. De kopieën blijven staan:
//   - ze zijn de terugval voor co-eigenaars zonder account (vrij ingevoerde
//     naam, bijvoorbeeld een externe adviseur);
//   - in auditsporen (`procedure_log.actor_naam`) zijn ze juist het gewenste
//     gedrag: die leggen vast wie iets deed op dát moment, en zijn append-only
//     (besluit 0001). Die worden hier dus NIET langsgelopen.
//
//  Regel: live naam wint waar een `gebruiker_id` bekend is én de view een naam
//  teruggeeft; anders de snapshot. Bestaat de view nog niet (migratie nog niet
//  gedraaid), dan levert de query een fout, blijft de tabel leeg en valt alles
//  terug op de snapshot. Deploy-volgorde is daarmee vrij.
// ============================================================================

import "server-only";

export interface Fondslid {
  id: string;
  naam: string | null;
  rol: string | null;
}

/** Minimale vorm van de Supabase-client die deze helper nodig heeft. */
interface LeesbareClient {
  from(tabel: string): {
    select(kolommen: string): PromiseLike<{
      data: unknown[] | null;
      error: unknown | null;
    }>;
  };
}

/**
 * Leden van het EIGEN fonds, als opzoektabel op gebruiker-id.
 * De view scopet zelf op het fonds van de ingelogde gebruiker — er hoeft (en
 * mag) hier dus geen fonds_id te worden meegegeven.
 */
export async function haalFondsleden(
  supabase: LeesbareClient
): Promise<Map<string, Fondslid>> {
  const kaart = new Map<string, Fondslid>();
  try {
    const { data, error } = await supabase
      .from("vw_fondsleden")
      .select("id, naam, rol");
    if (error || !data) return kaart;
    for (const rij of data as Fondslid[]) {
      if (rij?.id) kaart.set(rij.id, rij);
    }
  } catch {
    // View bestaat nog niet of is niet leesbaar → stil terugvallen op snapshots.
  }
  return kaart;
}

/**
 * De naam die getoond moet worden voor één eigenaar/actor.
 * Live naam wint; anders de bevroren snapshot; anders een neutrale aanduiding.
 */
export function weergaveNaam(
  gebruikerId: string | null | undefined,
  snapshot: string | null | undefined,
  leden: Map<string, Fondslid>
): string {
  const live = gebruikerId ? leden.get(gebruikerId)?.naam : null;
  return (live?.trim() || snapshot?.trim() || "Onbekend");
}

/**
 * Initialen voor een avatar-bolletje. Werkt op woorden, niet op tekens, en
 * negeert een e-mailadres-staart zodat een niet-ingevulde weergavenaam geen
 * "M@" oplevert.
 */
export function initialen(naam: string): string {
  const zonderDomein = naam.includes("@") ? naam.split("@")[0] : naam;
  return zonderDomein
    .split(/[\s._-]+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
