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
import { randomUUID } from "node:crypto";
import { cache } from "react";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { haalFondsSessie } from "@/core/lib/fonds-sessie";
import { isBureauRol } from "@/core/lib/bureau-gate";
import type { RetrievalContext } from "@/core/lib/retrieval/contract";
import { bewaakNaIO, isAfbreking, TIMEOUT_DEFAULT_MS } from "@/core/lib/retrieval/afbreken";
import { actorModelcontextRij, leesModelcontext, MODELCONTEXT_GEEN_GELDIGHEID } from "@/core/lib/retrieval/modelcontext-reader";
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
  /** Antwoordpad: server-afgeleide scope + samengestelde requestdeadline. */
  retrievalContext?: RetrievalContext;
}

/**
 * Haalt de gedeelde portaalcontext op. React.cache() dedupliceert de aanroep
 * binnen één server-render. Zonder `input` wordt de sessie server-side afgeleid
 * via haalFondsSessie() (redirect naar /login bij geen sessie/fonds). De
 * homepage geeft haar reeds-opgehaalde sessie door om een extra query te sparen.
 */
async function haalPortaalContextProvider(
  input: PortaalContextInput,
  context: RetrievalContext
): Promise<{ waarde: PortaalContext; fondsId: string; actorId: string }> {
    // Max 1× per server-render is structureel geborgd: precies één call-site per
    // oppervlak (homepage + /ai) en React.cache() hierboven dedupliceert een
    // eventuele herhaalde aanroep binnen dezelfde render.
    const supabase = await createServerSupabase();
    const signal = context.signal!;
    // Bevestig actor én fonds altijd uit de RLS-provider. Ook callers die een
    // reeds geladen sessie meegeven leveren zo geen vertrouwensclaim aan de
    // modelcontextgrens.
    const { data: profiel, error: profielError } = await supabase
      .from("profielen")
      .select("id, fonds_id, naam, rol")
      .eq("id", input.userId)
      .eq("fonds_id", input.fondsId)
      .abortSignal(signal)
      .maybeSingle();
    bewaakNaIO(signal, profielError);
    if (profielError) throw profielError;
    if (!profiel?.id || !profiel.fonds_id) throw new Error("modelcontext_buiten_scope");
    const userId = profiel.id as string;
    const fondsId = profiel.fonds_id as string;
    const gebruikerNaam = (profiel.naam as string | null) ?? input.gebruikerNaam;
    const rol = (profiel.rol as string | null) ?? input.rol ?? null;
    const isBureau = isBureauRol(rol);

    const nu = new Date().toISOString();

    // Eerstvolgende vergadering (RLS: eigen fonds).
    const { data: vergaderingenRaw, error: vergaderingenError } = await supabase
      .from("vergaderingen")
      .select("id, titel, datum, locatie")
      .eq("fonds_id", fondsId)
      .gte("datum", nu)
      .order("datum", { ascending: true })
      .limit(1).abortSignal(signal);
    bewaakNaIO(signal, vergaderingenError);
    if (vergaderingenError) throw vergaderingenError;
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
      const { data: apRaw, error: apError } = await supabase
        .from("agendapunten")
        .select("id, titel")
        .eq("vergadering_id", volgendeVergadering.id).abortSignal(signal);
      bewaakNaIO(signal, apError);
      if (apError) throw apError;
      const apList = (apRaw || []) as { id: string; titel: string }[];

      if (isBureau) {
        let metStukIds: string[] = [];
        if (apList.length > 0) {
          const { data: stukken, error: stukkenError } = await supabase
            .from("documenten")
            .select("agendapunt_id")
            .eq("actief", true)
            .in(
              "agendapunt_id",
              apList.map((a) => a.id)
            ).abortSignal(signal);
          bewaakNaIO(signal, stukkenError);
          if (stukkenError) throw stukkenError;
          metStukIds = (stukken || [])
            .map((d: { agendapunt_id: string | null }) => d.agendapunt_id)
            .filter((x): x is string => !!x);
        }
        agendapunten = telZonderGekoppeldStuk(apList, metStukIds);
      } else {
        let eigenIds: string[] = [];
        if (apList.length > 0) {
          const { data: mijnInbreng, error: inbrengError } = await supabase
            .from("agendapunt_inbreng")
            .select("agendapunt_id")
            .eq("gebruiker_id", userId)
            .in(
              "agendapunt_id",
              apList.map((a) => a.id)
            ).abortSignal(signal);
          bewaakNaIO(signal, inbrengError);
          if (inbrengError) throw inbrengError;
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
        .eq("gebruiker_id", userId).abortSignal(signal),
      gebruikerNaam
        ? supabase
            .from("procedure_eigenaars")
            .select("procedure_id")
            .eq("gebruiker_naam", gebruikerNaam).abortSignal(signal)
        : Promise.resolve({ data: [] as { procedure_id: string }[] }),
    ]);
    const mijnProcedureIds = new Set<string>();
    for (const res of eigenaarFilters) {
      bewaakNaIO(signal, "error" in res ? res.error : null);
      if ("error" in res && res.error) throw res.error;
      for (const rij of (res.data || []) as { procedure_id: string }[]) {
        mijnProcedureIds.add(rij.procedure_id);
      }
    }

    const openStappen: OpenStapCtx[] = [];
    if (mijnProcedureIds.size > 0) {
      const { data: stappenRaw, error: stappenError } = await supabase
        .from("procedure_stappen")
        .select("id, naam, deadline, procedure_id, procedures(titel)")
        .eq("status", "actief")
        .in("procedure_id", Array.from(mijnProcedureIds))
        .order("deadline", { ascending: true, nullsFirst: false })
        .limit(5).abortSignal(signal);
      bewaakNaIO(signal, stappenError);
      if (stappenError) throw stappenError;
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
    const { data: docRaw, error: docError } = await supabase
      .from("documenten")
      .select("id, titel, aangemaakt")
      .eq("bibliotheek", "fonds")
      .eq("actief", true)
      .order("aangemaakt", { ascending: false })
      .limit(1).abortSignal(signal);
    bewaakNaIO(signal, docError);
    if (docError) throw docError;
    const recentDocument = (docRaw?.[0] as DocumentCtx | undefined) ?? null;

    return {
      waarde: { volgendeVergadering, agendapunten, openStappen, recentDocument },
      fondsId,
      actorId: userId,
    };
}

export const getPortaalContext = cache(async (input?: PortaalContextInput): Promise<PortaalContext> => {
  const effectiefInput: PortaalContextInput = input ?? await (async () => {
    const sessie = await haalFondsSessie();
    return {
      userId: sessie.userId,
      fondsId: sessie.fondsId,
      gebruikerNaam: null,
      rol: sessie.rol,
    } satisfies PortaalContextInput;
  })();
  const context = effectiefInput.retrievalContext ?? {
    fondsId: effectiefInput.fondsId,
    actor: { soort: "gebruiker" as const, id: effectiefInput.userId },
    taaktype: "chat_generatie" as const,
    bronbeleid: { bronsoorten: ["fonds" as const] },
    correlationId: randomUUID(),
    verzoekStartOp: new Date().toISOString(),
    signal: AbortSignal.timeout(TIMEOUT_DEFAULT_MS),
  };
  const rows = await leesModelcontext({
    context, soort: "portaalstand",
    scope: { fondsId: effectiefInput.fondsId, actorId: effectiefInput.userId }, maxItems: 1,
    lees: async () => {
      try {
        const bevestigd = await haalPortaalContextProvider(effectiefInput, context);
        return {
          data: [actorModelcontextRij(
            bevestigd.waarde,
            bevestigd.fondsId,
            bevestigd.actorId,
            null,
            MODELCONTEXT_GEEN_GELDIGHEID
          )],
          error: null,
        };
      } catch (error) {
        if (isAfbreking(error)) throw error;
        return { data: [], error };
      }
    },
  });
  if (!rows[0]) throw new Error("modelcontext_providerfout");
  return rows[0];
});
