// ============================================================================
//  Gedeelde portaalcontext — server-helper (AI-startpunt P1, besluit 0085).
// ----------------------------------------------------------------------------
//  Één server-side bron voor de "wat speelt er nu"-context die zowel de homepage
//  (`app/(dashboard)/page.tsx`) als het AI-startpunt (`/ai`) tonen. Vóór P1
//  leefden deze queries alleen in de homepage; ze zijn hier geëxtraheerd zodat
//  beide oppervlakken dezelfde afleiding gebruiken en niet uiteenlopen.
//
//  De PURE afleidingslogica (tellen, selecteren, lege kaarten weglaten) én de
//  vormtypen staan in core/lib/portaalcontext-afleiding.ts (los testbaar onder
//  `tsx`, zonder `server-only`). Dit bestand doet uitsluitend de RLS-queries.
//
//  GUARDRAILS (CLAUDE.md):
//   - RLS per fonds_id: uitsluitend de anon-key-RLS-client (createServerSupabase).
//     Het fonds komt NOOIT uit een URL/param — de default-tak leidt het af via
//     haalFondsSessie(); een caller die al een server-side sessie heeft (de
//     homepage) geeft die door zodat er geen extra profiel-query ontstaat.
//   - Privacy: "agendapunten zonder inbreng" telt UITSLUITEND de eigen inbreng
//     (gebruiker_id = de ingelogde gebruiker). Nooit die van een ander bestuurslid.
//   - Performance: React.cache() dedupliceert de afleiding binnen één server-
//     render (acceptatiecriterium 7 — max 1× per render).
// ============================================================================

import "server-only";
import { cache } from "react";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { VERGADERING_KOLOMMEN_AGENDA } from "@/core/lib/kolommen";
import { haalFondsSessie } from "@/core/lib/fonds-sessie";
import { isBureauRol } from "@/core/lib/bureau-gate";
import {
  telEigenInbreng,
  telZonderGekoppeldStuk,
  type PortaalContext,
  type AgendapuntTelling,
  type VergaderingCtx,
  type OpenStapCtx,
  type DocumentCtx,
} from "@/core/lib/portaalcontext-afleiding";

// Re-export zodat consumenten alles via één import krijgen.
export type {
  PortaalContext,
  AgendapuntTelling,
  AgendapuntMaatstaf,
  VergaderingCtx,
  OpenStapCtx,
  DocumentCtx,
  StartpuntKaartSoort,
} from "@/core/lib/portaalcontext-afleiding";
export {
  telEigenInbreng,
  telZonderGekoppeldStuk,
  startpuntKaarten,
  heeftEnigeContext,
} from "@/core/lib/portaalcontext-afleiding";

/** Server-side afgeleide sessie die een caller kan doorgeven om een dubbele
 *  profiel-query te vermijden. `gebruikerNaam` is nodig voor de historische
 *  eigenaar-op-naam-match in de procedurestappen. */
export interface PortaalContextInput {
  userId: string;
  fondsId: string;
  gebruikerNaam: string | null;
  /** T1 bureau-rol: bepaalt welke maatstaf de agendapuntkaart gebruikt (§6.6).
   *  Optioneel zodat bestaande call-sites zonder rol ongewijzigd blijven werken;
   *  ontbreekt hij, dan valt de afleiding terug op de bestuurdersstand. */
  rol?: string | null;
}

/**
 * Haalt de gedeelde portaalcontext op. React.cache() dedupliceert de aanroep
 * binnen één server-render. Zonder `input` wordt de sessie server-side afgeleid
 * via haalFondsSessie() (redirect naar /login bij geen sessie/fonds). De
 * homepage geeft haar reeds-opgehaalde sessie door om een extra query te sparen.
 */
export const getPortaalContext = cache(
  async (input?: PortaalContextInput): Promise<PortaalContext> => {
    // Max 1× per server-render is structureel geborgd: precies één call-site per
    // oppervlak (homepage + /ai) en React.cache() hierboven dedupliceert een
    // eventuele herhaalde aanroep binnen dezelfde render.
    const supabase = await createServerSupabase();

    let userId: string;
    let fondsId: string;
    let gebruikerNaam: string | null;
    let rol: string | null;

    if (input) {
      ({ userId, fondsId, gebruikerNaam } = input);
      rol = input.rol ?? null;
    } else {
      const sessie = await haalFondsSessie();
      userId = sessie.userId;
      fondsId = sessie.fondsId;
      rol = sessie.rol;
      const { data: profiel } = await supabase
        .from("profielen")
        .select("naam")
        .eq("id", userId)
        .single();
      gebruikerNaam = (profiel?.naam as string | null) ?? null;
    }
    const isBureau = isBureauRol(rol);

    const nu = new Date().toISOString();

    // Eerstvolgende vergadering (RLS: eigen fonds).
    const { data: vergaderingenRaw } = await supabase
      .from("vergaderingen")
      .select(VERGADERING_KOLOMMEN_AGENDA)
      .eq("fonds_id", fondsId)
      .gte("datum", nu)
      .order("datum", { ascending: true })
      .limit(1);
    const volgendeVergadering =
      (vergaderingenRaw?.[0] as VergaderingCtx | undefined) ?? null;

    // Agendapunten van die vergadering.
    //
    // Twee maatstaven (T1, ontwerp §6.6). Voor de bestuurlijke rollen: hoeveel
    // punten wachten nog op de EIGEN inbreng (besluit 0085, ongewijzigd). Voor
    // `bestuursbureau`: hoeveel punten missen nog een gekoppeld stuk. Die tweede
    // tak bestaat omdat de eerste voor het bureau actief zou misleiden — het
    // plaatst geen inbreng en leest sinds migratie 2026_08_05 geen inbrengrijen,
    // dus de teller zou stelselmatig "alle agendapunten" tonen.
    let agendapunten: AgendapuntTelling = isBureau
      ? telZonderGekoppeldStuk([], [])
      : telEigenInbreng([], []);
    if (volgendeVergadering) {
      const { data: apRaw } = await supabase
        .from("agendapunten")
        .select("id, titel")
        .eq("vergadering_id", volgendeVergadering.id);
      const apList = (apRaw || []) as { id: string; titel: string }[];

      if (isBureau) {
        let metStukIds: string[] = [];
        if (apList.length > 0) {
          const { data: stukken } = await supabase
            .from("documenten")
            .select("agendapunt_id")
            .eq("actief", true)
            .in(
              "agendapunt_id",
              apList.map((a) => a.id)
            );
          metStukIds = (stukken || [])
            .map((d: { agendapunt_id: string | null }) => d.agendapunt_id)
            .filter((x): x is string => !!x);
        }
        agendapunten = telZonderGekoppeldStuk(apList, metStukIds);
      } else {
        let eigenIds: string[] = [];
        if (apList.length > 0) {
          const { data: mijnInbreng } = await supabase
            .from("agendapunt_inbreng")
            .select("agendapunt_id")
            .eq("gebruiker_id", userId)
            .in(
              "agendapunt_id",
              apList.map((a) => a.id)
            );
          eigenIds = (mijnInbreng || []).map(
            (i: { agendapunt_id: string }) => i.agendapunt_id
          );
        }
        agendapunten = telEigenInbreng(apList, eigenIds);
      }
    }

    // Eigen open procedurestappen (co-eigenaar via gebruiker_id ∪ gebruiker_naam).
    const eigenaarFilters = await Promise.all([
      supabase
        .from("procedure_eigenaars")
        .select("procedure_id")
        .eq("gebruiker_id", userId),
      gebruikerNaam
        ? supabase
            .from("procedure_eigenaars")
            .select("procedure_id")
            .eq("gebruiker_naam", gebruikerNaam)
        : Promise.resolve({ data: [] as { procedure_id: string }[] }),
    ]);
    const mijnProcedureIds = new Set<string>();
    for (const res of eigenaarFilters) {
      for (const rij of (res.data || []) as { procedure_id: string }[]) {
        mijnProcedureIds.add(rij.procedure_id);
      }
    }

    const openStappen: OpenStapCtx[] = [];
    if (mijnProcedureIds.size > 0) {
      const { data: stappenRaw } = await supabase
        .from("procedure_stappen")
        .select("id, naam, deadline, procedure_id, procedures(titel)")
        .eq("status", "actief")
        .in("procedure_id", Array.from(mijnProcedureIds))
        .order("deadline", { ascending: true, nullsFirst: false })
        .limit(5);
      for (const s of (stappenRaw || []) as Array<{
        id: string;
        naam: string;
        deadline: string | null;
        procedure_id: string;
        procedures: { titel: string } | { titel: string }[] | null;
      }>) {
        const procRel = Array.isArray(s.procedures)
          ? s.procedures[0]
          : s.procedures;
        openStappen.push({
          id: s.id,
          naam: s.naam,
          deadline: s.deadline,
          procedure_id: s.procedure_id,
          procedure_titel: procRel?.titel ?? "Procedure",
        });
      }
    }

    // Meest recent toegevoegde, actieve document uit de FONDSbibliotheek.
    // (Generiek = platform-gecureerd; hoort niet bij "door het fonds toegevoegd".)
    const { data: docRaw } = await supabase
      .from("documenten")
      .select("id, titel, aangemaakt")
      .eq("bibliotheek", "fonds")
      .eq("actief", true)
      .order("aangemaakt", { ascending: false })
      .limit(1);
    const recentDocument = (docRaw?.[0] as DocumentCtx | undefined) ?? null;

    return { volgendeVergadering, agendapunten, openStappen, recentDocument };
  }
);
