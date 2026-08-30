// ============================================================================
//  Homepage-werkbak (§9.2) — server-side bronlezing.
// ----------------------------------------------------------------------------
//  De werkbak heeft geen eigen tabel. Hij projecteert uitsluitend werk dat al
//  bestaat en waarvan de huidige gebruiker een expliciete houder is. De oude
//  metadata-reviewwachtrij is bewust géén bron: die workflow is met besluit
//  0152 verwijderd. Voorbereidingen blijven privé en verschijnen alleen voor
//  hun auteur, zolang de gekoppelde vergadering nog niet is afgerond.
// ============================================================================

import "server-only";
import { cache } from "react";
import { createServerSupabase } from "@/core/lib/supabase-server";
import type { WerkbakItem } from "@/core/lib/werkbak-afleiding";

export type { WerkbakItem, WerkbakSoort } from "@/core/lib/werkbak-afleiding";
export {
  eersteWerkbakItems,
  isAchterstallig,
  sorteerWerkbak,
  WERKBAK_RUSTPUNT,
} from "@/core/lib/werkbak-afleiding";

type ActieRij = {
  id: string;
  actie: string;
  deadline: string | null;
  decision_id: string;
  status: string | null;
};

type BesluitRij = { id: string; procedure_id: string };
type ProcedureRij = { id: string; titel: string };
type StapRij = {
  id: string;
  naam: string;
  deadline: string | null;
  procedure_id: string;
};
type VoorbereidingRij = { id: string; agendapunt_id: string };
type AgendapuntRij = { id: string; titel: string; vergadering_id: string };
type VergaderingRij = { id: string; titel: string; datum: string; status: string };

export interface WerkbakInput {
  userId: string;
  gebruikerNaam: string | null;
}

/**
 * Haalt de persoonlijke werkbak op. RLS voert de fondsgrens af; aanvullende
 * `eigenaar_id` / `gebruiker_id`-filters maken de persoonlijke toewijzing
 * expliciet. Externe actiehouders (alleen `eigenaar_naam`) verschijnen bewust
 * niet: zij hebben geen portaalprofiel en dus geen persoonlijke werkbak.
 */
export const haalWerkbak = cache(async (input: WerkbakInput): Promise<WerkbakItem[]> => {
  const supabase = await createServerSupabase();

  const [actiesRes, eigenProcedureRes, voorbereidingRes] = await Promise.all([
    supabase
      .from("decision_actions")
      .select("id, actie, deadline, decision_id, status")
      .eq("eigenaar_id", input.userId)
      .in("status", ["open", "in_behandeling", "escalatie"]),
    input.gebruikerNaam
      ? Promise.all([
          supabase
            .from("procedure_eigenaars")
            .select("procedure_id")
            .eq("gebruiker_id", input.userId),
          supabase
            .from("procedure_eigenaars")
            .select("procedure_id")
            .eq("gebruiker_naam", input.gebruikerNaam),
        ])
      : Promise.all([
          supabase
            .from("procedure_eigenaars")
            .select("procedure_id")
            .eq("gebruiker_id", input.userId),
        ]),
    supabase
      .from("voorbereidingen")
      .select("id, agendapunt_id")
      .eq("gebruiker_id", input.userId),
  ]);

  const acties = (actiesRes.data || []) as ActieRij[];
  const besluitIds = [...new Set(acties.map((actie) => actie.decision_id))];
  const { data: besluitenRaw } = besluitIds.length
    ? await supabase
        .from("decision_objects")
        .select("id, procedure_id")
        .in("id", besluitIds)
    : { data: [] as BesluitRij[] };
  const besluiten = (besluitenRaw || []) as BesluitRij[];
  const procedureIdsUitBesluiten = [...new Set(besluiten.map((besluit) => besluit.procedure_id))];

  const eigenProcedureIds = new Set<string>();
  for (const res of eigenProcedureRes) {
    for (const rij of (res.data || []) as { procedure_id: string }[]) {
      eigenProcedureIds.add(rij.procedure_id);
    }
  }

  const alleProcedureIds = [...new Set([...procedureIdsUitBesluiten, ...eigenProcedureIds])];
  const [proceduresRes, stappenRes] = await Promise.all([
    alleProcedureIds.length
      ? supabase.from("procedures").select("id, titel").in("id", alleProcedureIds)
      : Promise.resolve({ data: [] as ProcedureRij[] }),
    eigenProcedureIds.size
      ? supabase
          .from("procedure_stappen")
          .select("id, naam, deadline, procedure_id")
          .in("procedure_id", [...eigenProcedureIds])
          .in("status", ["actief", "heropend"])
      : Promise.resolve({ data: [] as StapRij[] }),
  ]);
  const procedures = (proceduresRes.data || []) as ProcedureRij[];
  const stappen = (stappenRes.data || []) as StapRij[];
  const procedureTitel = new Map(procedures.map((procedure) => [procedure.id, procedure.titel]));
  const procedurePerBesluit = new Map(besluiten.map((besluit) => [besluit.id, besluit.procedure_id]));

  const voorbereidingen = (voorbereidingRes.data || []) as VoorbereidingRij[];
  const agendapuntIds = [...new Set(voorbereidingen.map((voorbereiding) => voorbereiding.agendapunt_id))];
  const { data: agendapuntenRaw } = agendapuntIds.length
    ? await supabase
        .from("agendapunten")
        .select("id, titel, vergadering_id")
        .in("id", agendapuntIds)
        .is("verwijderd_op", null)
    : { data: [] as AgendapuntRij[] };
  const agendapunten = (agendapuntenRaw || []) as AgendapuntRij[];
  const vergaderingIds = [...new Set(agendapunten.map((punt) => punt.vergadering_id))];
  const { data: vergaderingenRaw } = vergaderingIds.length
    ? await supabase
        .from("vergaderingen")
        .select("id, titel, datum, status")
        .in("id", vergaderingIds)
        .neq("status", "afgerond")
    : { data: [] as VergaderingRij[] };
  const vergaderingen = (vergaderingenRaw || []) as VergaderingRij[];
  const agendapuntPerId = new Map(agendapunten.map((punt) => [punt.id, punt]));
  const vergaderingPerId = new Map(vergaderingen.map((vergadering) => [vergadering.id, vergadering]));

  const items: WerkbakItem[] = [];
  for (const actie of acties) {
    const procedureId = procedurePerBesluit.get(actie.decision_id);
    if (!procedureId) continue;
    items.push({
      id: `actie:${actie.id}`,
      soort: "actie",
      titel: actie.actie,
      herkomst: procedureTitel.get(procedureId) ?? "Besluitdossier",
      deadline: actie.deadline,
      href: `/procedures/${procedureId}?dossier=acties#onderbouwing`,
    });
  }
  for (const stap of stappen) {
    items.push({
      id: `stap:${stap.id}`,
      soort: "stap",
      titel: stap.naam,
      herkomst: procedureTitel.get(stap.procedure_id) ?? "Procedure",
      deadline: stap.deadline,
      href: `/procedures/${stap.procedure_id}?stap=${stap.id}`,
    });
  }
  for (const voorbereiding of voorbereidingen) {
    const punt = agendapuntPerId.get(voorbereiding.agendapunt_id);
    const vergadering = punt ? vergaderingPerId.get(punt.vergadering_id) : null;
    if (!punt || !vergadering) continue;
    items.push({
      id: `vergadering:${voorbereiding.id}`,
      soort: "vergadering",
      titel: `Voorbereiding: ${punt.titel}`,
      herkomst: vergadering.titel,
      deadline: vergadering.datum.slice(0, 10),
      href: `/vergaderingen/${vergadering.id}#agendapunt-${punt.id}`,
    });
  }
  return items;
});
