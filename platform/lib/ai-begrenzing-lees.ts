// ============================================================================
//  ai-begrenzing-lees.ts — leeslaag voor de beheerweergave AI-begrenzing
// ----------------------------------------------------------------------------
//  Leest de kill switches, de quota, de modelallowlist en de maandtellers, en
//  levert ze als kant-en-klare aggregaten aan de weergave. De rekenregels
//  (drempels, statuswoorden, maandgrens) komen uit core/lib/ai-quota-kern, zodat
//  de UI exact dezelfde grenzen hanteert als de database.
//
//  De client wordt INGESPOTEN: deze module maakt zelf geen verbinding en kan
//  daardoor alleen binnen withPlatformRead() draaien — dezelfde borging als
//  verbruik-bundel-lees.ts. Alle acht ai_*-tabellen zijn deny-by-default; alleen
//  de service-role die de wrapper injecteert komt erbij.
//
//  PRIVACY. De weergave toont metadata: aantallen per fonds en per gebruiker.
//  Geen prompts, geen antwoorden, geen documentinhoud. De gebruikersnaam komt
//  uit `profielen` en is nodig om een beheerder te laten zien wíe tegen zijn
//  grens aanloopt — dat is de bedoelde functie van FR-5, niet een bijvangst.
//
//  Besluit 0180.
// ============================================================================

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QUOTA_SLEUTELS,
  SWITCH_SLEUTELS,
  beoordeelStand,
  maandSleutel,
  type QuotaSleutel,
  type QuotaStand,
  type SwitchSleutel,
  type SwitchStatus,
} from "@/core/lib/ai-quota-kern";

/**
 * Bovengrens op het aantal verbruiksregels dat één weergave inleest. Bij het
 * Previewquotum (1.200 AI-acties per maand) is dit ruim; wordt hij geraakt, dan
 * meldt de weergave dat de cijfers zijn afgekapt in plaats van stilzwijgend een
 * te laag getal te tonen. Zelfde afweging als LEESLIMIET in
 * platform/lib/monitoring-queries.ts.
 */
const LEESLIMIET = 20000;

export type OpenVerzoek = {
  id: string;
  aangevraagdDoor: string;
  aangevraagdDoorEmail: string | null;
  aangevraagdOp: string;
  reden: string;
  configVersieBijAanvraag: number;
};

export type SwitchWeergave = {
  sleutel: SwitchSleutel;
  status: SwitchStatus;
  reden: string | null;
  gewijzigdOp: string;
  gewijzigdDoorEmail: string | null;
  openVerzoek: OpenVerzoek | null;
};

export type AllowlistRij = {
  provider: string;
  model: string;
  actief: boolean;
  vensterStart: string | null;
  vensterEind: string | null;
  /** Afgeleid: staat een tijdelijk venster op dit moment open? */
  vensterActief: boolean | null;
  reden: string | null;
};

export type FondsVerbruik = {
  fondsId: string;
  naam: string;
  ai: QuotaStand;
  ocr: QuotaStand;
};

export type GebruikerVerbruik = {
  gebruikerId: string;
  naam: string;
  fondsNaam: string;
  ai: QuotaStand;
};

export type AiBegrenzingOverzicht = {
  /** Maandbucket (UTC) waarover alles is gemeten, als `YYYY-MM-01`. */
  maand: string;
  configVersie: number | null;
  /** Ontbreekt een quotumrij, dan is die grens NIET geconfigureerd = dicht. */
  quota: Partial<Record<QuotaSleutel, number>>;
  quotaOntbreekt: QuotaSleutel[];
  switches: SwitchWeergave[];
  allowlist: AllowlistRij[];
  globaal: QuotaStand;
  fondsen: FondsVerbruik[];
  gebruikers: GebruikerVerbruik[];
  /** Acties die door een crash zijn blijven hangen en zijn verlopen verklaard. */
  verlopenActies: number;
  gelezenRijen: number;
  afgekapt: boolean;
};

type VerbruikRij = {
  fonds_id: string | null;
  gebruiker_id: string | null;
  ai_acties: number | null;
  ocr_paginas: number | null;
};

export async function haalAiBegrenzingOverzicht(
  svc: SupabaseClient,
  opties?: { nu?: Date }
): Promise<AiBegrenzingOverzicht> {
  const nu = opties?.nu ?? new Date();
  const maand = maandSleutel(nu);

  const [
    { data: versieRij },
    { data: quotaRijen },
    { data: switchRijen },
    { data: allowlistRijen },
    { data: fondsRijen },
    { data: profielRijen },
    { data: verbruikRijen },
    { count: verlopenCount },
  ] = await Promise.all([
    svc.from("ai_config_versie").select("versie").eq("id", 1).maybeSingle(),
    svc.from("ai_quota_config").select("sleutel, waarde"),
    svc
      .from("ai_kill_switch")
      .select("sleutel, status, reden, gewijzigd_op, gewijzigd_door, open_verzoek_id"),
    svc
      .from("ai_model_allowlist")
      .select("provider, model, actief, venster_start, venster_eind, reden")
      .order("provider")
      .order("model"),
    svc.from("fondsen").select("id, naam").order("naam"),
    svc.from("profielen").select("id, naam, fonds_id"),
    svc
      .from("ai_verbruik_log")
      .select("fonds_id, gebruiker_id, ai_acties, ocr_paginas")
      .eq("maand", maand)
      .limit(LEESLIMIET),
    svc
      .from("ai_actie")
      .select("id", { count: "exact", head: true })
      .eq("status", "verlopen")
      .gte("gestart_op", `${maand}T00:00:00.000Z`),
  ]);

  // ── Quota ────────────────────────────────────────────────────────────────
  const quota: Partial<Record<QuotaSleutel, number>> = {};
  for (const r of (quotaRijen ?? []) as { sleutel: string; waarde: number }[]) {
    if ((QUOTA_SLEUTELS as readonly string[]).includes(r.sleutel)) {
      quota[r.sleutel as QuotaSleutel] = r.waarde;
    }
  }
  const quotaOntbreekt = QUOTA_SLEUTELS.filter((s) => quota[s] === undefined);

  // ── Identiteiten voor de auditregels ─────────────────────────────────────
  // Alleen de identiteiten die daadwerkelijk in een schakelaar of verzoek
  // voorkomen; geen volledige ledenlijst inlezen.
  const identiteitIds = new Set<string>();
  for (const s of (switchRijen ?? []) as { gewijzigd_door: string | null }[]) {
    if (s.gewijzigd_door) identiteitIds.add(s.gewijzigd_door);
  }
  const openVerzoekIds = ((switchRijen ?? []) as { open_verzoek_id: string | null }[])
    .map((s) => s.open_verzoek_id)
    .filter((id): id is string => Boolean(id));

  const { data: verzoekRijen } = openVerzoekIds.length
    ? await svc
        .from("ai_heractivering_verzoek")
        .select("id, sleutel, aangevraagd_door, aangevraagd_op, reden, config_versie_bij_aanvraag")
        .in("id", openVerzoekIds)
    : { data: [] as unknown[] };

  for (const v of (verzoekRijen ?? []) as { aangevraagd_door: string }[]) {
    identiteitIds.add(v.aangevraagd_door);
  }

  const { data: identiteitRijen } = identiteitIds.size
    ? await svc.from("platform_identities").select("id, email").in("id", [...identiteitIds])
    : { data: [] as unknown[] };
  const emailVan = new Map<string, string>();
  for (const i of (identiteitRijen ?? []) as { id: string; email: string }[]) {
    emailVan.set(i.id, i.email);
  }

  const verzoekVan = new Map<string, OpenVerzoek>();
  for (const v of (verzoekRijen ?? []) as {
    id: string;
    aangevraagd_door: string;
    aangevraagd_op: string;
    reden: string;
    config_versie_bij_aanvraag: number;
  }[]) {
    verzoekVan.set(v.id, {
      id: v.id,
      aangevraagdDoor: v.aangevraagd_door,
      aangevraagdDoorEmail: emailVan.get(v.aangevraagd_door) ?? null,
      aangevraagdOp: v.aangevraagd_op,
      reden: v.reden,
      configVersieBijAanvraag: v.config_versie_bij_aanvraag,
    });
  }

  // ── Schakelaars, in vaste volgorde ───────────────────────────────────────
  const switchBron = new Map<string, Record<string, unknown>>();
  for (const s of (switchRijen ?? []) as Record<string, unknown>[]) {
    switchBron.set(String(s.sleutel), s);
  }
  const switches: SwitchWeergave[] = SWITCH_SLEUTELS.map((sleutel) => {
    const r = switchBron.get(sleutel);
    const openId = (r?.open_verzoek_id as string | null) ?? null;
    return {
      sleutel,
      // Ontbreekt de rij, dan is de configuratie onvolledig. Toon dat als
      // `gestopt`: een onbekende schakelaar hoort dicht te lijken, niet open.
      status: (r?.status as SwitchStatus) ?? "gestopt",
      reden: (r?.reden as string | null) ?? null,
      gewijzigdOp: (r?.gewijzigd_op as string) ?? "",
      gewijzigdDoorEmail: r?.gewijzigd_door
        ? (emailVan.get(String(r.gewijzigd_door)) ?? null)
        : null,
      openVerzoek: openId ? (verzoekVan.get(openId) ?? null) : null,
    };
  });

  // ── Allowlist ────────────────────────────────────────────────────────────
  const nuMs = nu.getTime();
  const allowlist: AllowlistRij[] = ((allowlistRijen ?? []) as Record<string, unknown>[]).map(
    (r) => {
      const start = r.venster_start ? new Date(String(r.venster_start)).getTime() : null;
      const eind = r.venster_eind ? new Date(String(r.venster_eind)).getTime() : null;
      return {
        provider: String(r.provider),
        model: String(r.model),
        actief: Boolean(r.actief),
        vensterStart: (r.venster_start as string | null) ?? null,
        vensterEind: (r.venster_eind as string | null) ?? null,
        vensterActief: start === null ? null : nuMs >= start && (eind === null || nuMs < eind),
        reden: (r.reden as string | null) ?? null,
      };
    }
  );

  // ── Tellers bucketen ─────────────────────────────────────────────────────
  const rijen = (verbruikRijen ?? []) as VerbruikRij[];
  const afgekapt = rijen.length >= LEESLIMIET;

  let globaalActies = 0;
  const aiPerFonds = new Map<string, number>();
  const ocrPerFonds = new Map<string, number>();
  const aiPerGebruiker = new Map<string, number>();

  for (const r of rijen) {
    const acties = r.ai_acties ?? 0;
    const paginas = r.ocr_paginas ?? 0;
    globaalActies += acties;
    if (r.fonds_id) {
      aiPerFonds.set(r.fonds_id, (aiPerFonds.get(r.fonds_id) ?? 0) + acties);
      ocrPerFonds.set(r.fonds_id, (ocrPerFonds.get(r.fonds_id) ?? 0) + paginas);
    }
    if (r.gebruiker_id) {
      aiPerGebruiker.set(r.gebruiker_id, (aiPerGebruiker.get(r.gebruiker_id) ?? 0) + acties);
    }
  }

  // Een ontbrekende quotumrij betekent DICHT, niet onbeperkt: `beoordeelStand`
  // levert bij limiet 0 de status `geblokkeerd`. Dat spiegelt de preflight, die
  // zonder quotumrij eveneens weigert.
  const limiet = (s: QuotaSleutel) => quota[s] ?? 0;

  const fondsNaamVan = new Map<string, string>();
  for (const f of (fondsRijen ?? []) as { id: string; naam: string }[]) {
    fondsNaamVan.set(f.id, f.naam);
  }

  const fondsen: FondsVerbruik[] = ((fondsRijen ?? []) as { id: string; naam: string }[])
    .map((f) => ({
      fondsId: f.id,
      naam: f.naam,
      ai: beoordeelStand(aiPerFonds.get(f.id) ?? 0, limiet("fonds_maand")),
      ocr: beoordeelStand(ocrPerFonds.get(f.id) ?? 0, limiet("ocr_fonds_maand")),
    }))
    // Drukste fonds bovenaan: dat is waar een beheerder naar zoekt.
    .sort((a, b) => b.ai.gebruikt - a.ai.gebruikt || a.naam.localeCompare(b.naam));

  const gebruikers: GebruikerVerbruik[] = ((profielRijen ?? []) as {
    id: string;
    naam: string | null;
    fonds_id: string | null;
  }[])
    .filter((p) => (aiPerGebruiker.get(p.id) ?? 0) > 0)
    .map((p) => ({
      gebruikerId: p.id,
      naam: p.naam ?? "(naam onbekend)",
      fondsNaam: p.fonds_id ? (fondsNaamVan.get(p.fonds_id) ?? "(onbekend fonds)") : "—",
      ai: beoordeelStand(aiPerGebruiker.get(p.id) ?? 0, limiet("gebruiker_maand")),
    }))
    .sort((a, b) => b.ai.gebruikt - a.ai.gebruikt || a.naam.localeCompare(b.naam));

  return {
    maand,
    configVersie: (versieRij?.versie as number | undefined) ?? null,
    quota,
    quotaOntbreekt,
    switches,
    allowlist,
    globaal: beoordeelStand(globaalActies, limiet("globaal_maand")),
    fondsen,
    gebruikers,
    verlopenActies: verlopenCount ?? 0,
    gelezenRijen: rijen.length,
    afgekapt,
  };
}
