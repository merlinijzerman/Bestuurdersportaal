// ============================================================
//  Notifications helper — Iteratie 3-A (2026-05-18)
//
//  Centrale plek waar elke route een in-app notificatie kan
//  aanmaken. Geen e-mail; alleen rijen in `notificaties`. UI leest
//  ze uit op de homepage + via /api/notificaties.
//
//  Design-keuzes:
//
//  1. **Expliciete inserts, geen DB-triggers.** Elke route die een
//     event triggert roept `notifyUser` of `notifyByRole` aan. Dat
//     is debug-baarder en houdt de business-logic op één plek.
//
//  2. **Geen self-notify.** Als de actor (auth.uid()) dezelfde
//     gebruiker is als de ontvanger, slaan we de notificatie over.
//     Anders krijg je een melding "u heeft inbreng geplaatst" op
//     uw eigen actie.
//
//  3. **Idempotentie binnen 5 minuten.** Als dezelfde (type, ontvanger,
//     gerelateerd_aan_id) combinatie in de afgelopen 5 minuten al een
//     notificatie heeft opgeleverd, slaan we het over. Voorkomt
//     duplicates wanneer een route per ongeluk twee keer schrijft.
//
//  4. **Soft-fail.** Een fout bij het aanmaken van een notificatie
//     blokkeert de primaire actie niet. Wel `console.error` voor
//     Sentry (zodra WP7 live is). Een gemiste notificatie is een
//     UX-irritatie; een gefaalde primaire actie is een bug.
//
//  5. **fonds_id verplicht.** Defensief: garandeert dat de RLS
//     `fonds_id = (select fonds_id from profielen where id = auth.uid())`
//     bij INSERT slaagt. De caller weet welk fonds; we geven 'm mee.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------- Types ------------------------------------------------------

export type NotificatieType =
  | "inbreng_geplaatst"
  | "ai_validatie_wacht"
  | "procedure_afgerond"
  | "besluit_geregistreerd"
  | "dissent_formeel_vastgelegd"
  // Tranche 1 Vergader-basics (2026-05-18)
  | "agendapunt_gewijzigd"
  | "agendapunt_verplaatst"
  | "agendapunt_verwijderd"
  // Tranche 2 Stemmingen (2026-05-20)
  | "stemronde_geopend"
  | "volmachtstem_uitgebracht"
  | "stemronde_gesloten"
  | "stemronde_ingetrokken";

export type GerelateerdAanType =
  | "agendapunt"
  | "procedure"
  | "decision"
  | "ai_interaction"
  | "besluit";

/**
 * Type-specifieke payload-velden. Elke variant noemt expliciet welke
 * velden hij verwacht; de UI gebruikt deze velden om een zin te
 * vormen ("X plaatste inbreng op agendapunt Y").
 */
export type NotificatiePayload =
  | { type: "inbreng_geplaatst"; agendapunt_titel: string; actor_naam: string; vergadering_id: string }
  | { type: "ai_validatie_wacht"; output_type: string; validatie_domein: string; procedure_titel?: string }
  | { type: "procedure_afgerond"; procedure_titel: string; afgerond_door_naam: string }
  | { type: "besluit_geregistreerd"; procedure_titel: string; besluit_formulering_preview: string; actor_naam: string }
  | { type: "dissent_formeel_vastgelegd"; besluit_code: string; besluit_titel: string; actor_naam: string }
  // Tranche 1 Vergader-basics
  | { type: "agendapunt_gewijzigd"; agendapunt_titel: string; velden: string[]; motivering: string; actor_naam: string; vergadering_id: string }
  | { type: "agendapunt_verplaatst"; agendapunt_titel: string; oude_vergadering_id: string; nieuwe_vergadering_id: string; motivering: string; actor_naam: string; vergadering_id: string }
  | { type: "agendapunt_verwijderd"; agendapunt_titel: string; motivering: string; actor_naam: string; vergadering_id: string }
  // Tranche 2 Stemmingen
  | { type: "stemronde_geopend"; agendapunt_titel: string; vraag: string; actor_naam: string; vergadering_id: string }
  | { type: "volmachtstem_uitgebracht"; agendapunt_titel: string; vraag: string; uitgebracht_door_naam: string; keuze: string; volmacht_toelichting: string | null; vergadering_id: string }
  | { type: "stemronde_gesloten"; agendapunt_titel: string; winnend_alternatief: string | null; uitslag_samenvatting: string; quorum_status: string; meerderheid_status: string; vergadering_id: string }
  | { type: "stemronde_ingetrokken"; agendapunt_titel: string; ingetrokken_reden: string; actor_naam: string; vergadering_id: string };

type NotifyOpts = {
  /** Type van het gerelateerde object voor deeplink. */
  gerelateerd_aan_type?: GerelateerdAanType;
  /** ID in de bijbehorende tabel voor deeplink. */
  gerelateerd_aan_id?: string;
  /** Optioneel: actor-naam-snapshot. Helpt als profiel later wijzigt. */
  actor_naam?: string;
  /** Optioneel: actor-id (default `auth.uid()` van de huidige sessie). */
  actor_id?: string;
};

// ---------- Public API -------------------------------------------------

/**
 * Maak een notificatie voor één specifieke gebruiker.
 *
 * Slaat over als:
 * - `ontvangerId === actorId` (self-notify)
 * - Idempotentie-check trigger: zelfde (type, ontvanger, gerelateerd_aan_id) in laatste 5 min
 *
 * Faalt soft: bij Supabase-fout wordt `console.error` aangeroepen,
 * geen exception opgegooid. De primaire actie van de caller mag niet
 * blokkeren op een notificatie-fout.
 */
export async function notifyUser(
  supabase: SupabaseClient,
  type: NotificatieType,
  ontvangerId: string,
  fondsId: string,
  payload: NotificatiePayload,
  opts: NotifyOpts = {}
): Promise<void> {
  try {
    // 1. Self-notify check
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const actorId = opts.actor_id ?? user?.id ?? null;
    if (actorId && actorId === ontvangerId) {
      return; // Geen melding aan jezelf over je eigen actie.
    }

    // 2. Idempotentie-check — vermijdt duplicates binnen 5 minuten
    if (opts.gerelateerd_aan_id) {
      const vijfMinGeleden = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: bestaand } = await supabase
        .from("notificaties")
        .select("id")
        .eq("ontvanger_id", ontvangerId)
        .eq("type", type)
        .eq("gerelateerd_aan_id", opts.gerelateerd_aan_id)
        .gte("aangemaakt", vijfMinGeleden)
        .limit(1);
      if (bestaand && bestaand.length > 0) {
        return; // Recente duplicate — sla over.
      }
    }

    // 3. Insert
    const { error } = await supabase.from("notificaties").insert({
      ontvanger_id: ontvangerId,
      fonds_id: fondsId,
      type,
      payload,
      gerelateerd_aan_type: opts.gerelateerd_aan_type ?? null,
      gerelateerd_aan_id: opts.gerelateerd_aan_id ?? null,
      actor_id: actorId,
      actor_naam: opts.actor_naam ?? null,
    });

    if (error) {
      console.error(`[notifyUser:${type}] Insert mislukt:`, error);
    }
  } catch (e) {
    // Soft-fail: gooi nooit door naar de caller.
    console.error(`[notifyUser:${type}] Onverwachte fout:`, e);
  }
}

/**
 * Maak een notificatie voor iedereen binnen een fonds met een bepaalde rol.
 *
 * Voorbeeld: een AI-output met `validatie_domein='risk'` wacht op validatie
 * door alle voorzitters en beheerders binnen het fonds — `notifyByRole` doet
 * één query om de juiste profielen op te halen en een insert per rij.
 *
 * Slaat actor zelf over (geen self-notify). Idempotentie-check loopt per
 * ontvanger via `notifyUser`.
 */
export async function notifyByRole(
  supabase: SupabaseClient,
  type: NotificatieType,
  rollen: string[],
  fondsId: string,
  payload: NotificatiePayload,
  opts: NotifyOpts = {}
): Promise<void> {
  try {
    const { data: ontvangers, error } = await supabase
      .from("profielen")
      .select("id")
      .eq("fonds_id", fondsId)
      .in("rol", rollen);

    if (error) {
      console.error(`[notifyByRole:${type}] Profielen-query mislukt:`, error);
      return;
    }

    if (!ontvangers || ontvangers.length === 0) {
      return; // Niemand met die rol — niets te doen.
    }

    // Parallel inserts; één gefaalde notif blokkeert de anderen niet
    // omdat notifyUser zelf soft-fails.
    await Promise.all(
      (ontvangers as { id: string }[]).map((p) =>
        notifyUser(supabase, type, p.id, fondsId, payload, opts)
      )
    );
  } catch (e) {
    console.error(`[notifyByRole:${type}] Onverwachte fout:`, e);
  }
}

// ---------- UI-helpers -------------------------------------------------

/**
 * Vorm een Nederlandse zin uit een notificatie-payload. Wordt zowel
 * server- als client-side gebruikt — geen DOM-afhankelijkheden.
 *
 * UI-componenten kunnen de zin direct tonen, of de payload zelf
 * uitlezen voor extra rendering (bv. bold op de actor-naam).
 */
export function vormNotificatieZin(
  type: NotificatieType,
  payload: Record<string, unknown>
): string {
  switch (type) {
    case "inbreng_geplaatst":
      return `${payload.actor_naam ?? "Iemand"} plaatste inbreng op uw agendapunt "${payload.agendapunt_titel ?? "?"}"`;
    case "ai_validatie_wacht":
      return `AI-output wacht op validatie in domein ${payload.validatie_domein ?? "?"}${
        payload.procedure_titel ? ` (${payload.procedure_titel})` : ""
      }`;
    case "procedure_afgerond":
      return `Uw procedure "${payload.procedure_titel ?? "?"}" is afgerond door ${payload.afgerond_door_naam ?? "een collega"}`;
    case "besluit_geregistreerd":
      return `Besluit op uw procedure "${payload.procedure_titel ?? "?"}" is geregistreerd door ${payload.actor_naam ?? "een collega"}`;
    case "dissent_formeel_vastgelegd":
      return `Dissent formeel vastgelegd op besluit ${payload.besluit_code ?? ""}: ${payload.besluit_titel ?? "?"}`;
    case "agendapunt_gewijzigd":
      return `${payload.actor_naam ?? "Iemand"} wijzigde agendapunt "${payload.agendapunt_titel ?? "?"}"`;
    case "agendapunt_verplaatst":
      return `Agendapunt "${payload.agendapunt_titel ?? "?"}" is verplaatst door ${payload.actor_naam ?? "een collega"}`;
    case "agendapunt_verwijderd":
      return `Agendapunt "${payload.agendapunt_titel ?? "?"}" is verwijderd door ${payload.actor_naam ?? "een collega"}`;
    case "stemronde_geopend":
      return `${payload.actor_naam ?? "Iemand"} opende een stemronde op "${payload.agendapunt_titel ?? "?"}"`;
    case "volmachtstem_uitgebracht":
      return `${payload.uitgebracht_door_naam ?? "Iemand"} bracht namens u een stem uit ("${payload.keuze ?? "?"}") op "${payload.agendapunt_titel ?? "?"}"`;
    case "stemronde_gesloten":
      return `Stemronde op "${payload.agendapunt_titel ?? "?"}" is gesloten — uitslag: ${payload.uitslag_samenvatting ?? "?"}`;
    case "stemronde_ingetrokken":
      return `Stemronde op "${payload.agendapunt_titel ?? "?"}" is ingetrokken: ${payload.ingetrokken_reden ?? "?"}`;
    default:
      return "Nieuwe notificatie";
  }
}

/**
 * Bouw de deeplink-URL voor een notificatie. Wordt door de UI
 * gebruikt om door te klikken; markeert tegelijkertijd als gelezen.
 *
 * Retourneert `null` als de notificatie geen geldige bestemming
 * heeft (geen `gerelateerd_aan_id`).
 */
export function bouwNotificatieLink(
  gerelateerd_aan_type: string | null,
  gerelateerd_aan_id: string | null,
  payload: Record<string, unknown>
): string | null {
  if (!gerelateerd_aan_id) return null;
  switch (gerelateerd_aan_type) {
    case "agendapunt":
      // Agendapunt zit in een vergadering; payload bevat vergadering_id voor de deeplink.
      return payload.vergadering_id
        ? `/vergaderingen/${payload.vergadering_id}#agendapunt-${gerelateerd_aan_id}`
        : "/vergaderingen";
    case "procedure":
      return `/procedures/${gerelateerd_aan_id}`;
    case "decision":
      // Decisions worden bekeken vanuit hun procedure-detailpagina.
      return payload.procedure_id ? `/procedures/${payload.procedure_id}` : "/procedures";
    case "ai_interaction":
      return payload.procedure_id ? `/procedures/${payload.procedure_id}` : "/procedures";
    case "besluit":
      return payload.procedure_id ? `/procedures/${payload.procedure_id}` : "/procedures";
    default:
      return null;
  }
}

/**
 * Icoon-naam (Unicode-emoji of korte tekst-tag) voor visuele
 * onderscheiding in de UI. Bewust simpel — geen icon-library nodig.
 */
export function notificatieIcoon(type: NotificatieType): string {
  switch (type) {
    case "inbreng_geplaatst":
      return "💬";
    case "ai_validatie_wacht":
      return "🤖";
    case "procedure_afgerond":
      return "✓";
    case "besluit_geregistreerd":
      return "📋";
    case "dissent_formeel_vastgelegd":
      return "⚠";
    case "agendapunt_gewijzigd":
      return "✎";
    case "agendapunt_verplaatst":
      return "↔";
    case "agendapunt_verwijderd":
      return "🗑";
    case "stemronde_geopend":
      return "🗳";
    case "volmachtstem_uitgebracht":
      return "🤝";
    case "stemronde_gesloten":
      return "✅";
    case "stemronde_ingetrokken":
      return "↩";
    default:
      return "•";
  }
}

/**
 * Haalt alle "bijdragers" van een agendapunt op (gebruikers met inbreng
 * en/of een voorbereiding) en stuurt elk van hen een notificatie.
 *
 * Bedoeld voor PATCH/DELETE/herstel van een agendapunt — die handelingen
 * raken het werk van iedereen die er al iets op heeft gezet. De self-notify-
 * en idempotentie-checks in `notifyUser` voorkomen dat de actor zichzelf
 * notificeert of dat dubbele notificaties ontstaan binnen 5 minuten.
 *
 * Soft-fail: een fout bij ophalen of inserten blokkeert de primaire actie
 * niet.
 */
export async function notifyAgendapuntBijdragers(
  supabase: SupabaseClient,
  agendapuntId: string,
  fondsId: string,
  type: "agendapunt_gewijzigd" | "agendapunt_verplaatst" | "agendapunt_verwijderd",
  payload: NotificatiePayload,
  opts: NotifyOpts = {}
): Promise<void> {
  try {
    const [{ data: inbrengen }, { data: voorbereidingen }] = await Promise.all([
      supabase
        .from("agendapunt_inbreng")
        .select("gebruiker_id")
        .eq("agendapunt_id", agendapuntId),
      supabase
        .from("voorbereidingen")
        .select("gebruiker_id")
        .eq("agendapunt_id", agendapuntId),
    ]);

    const idsSet = new Set<string>();
    for (const r of (inbrengen as { gebruiker_id: string | null }[] | null) ?? []) {
      if (r.gebruiker_id) idsSet.add(r.gebruiker_id);
    }
    for (const r of (voorbereidingen as { gebruiker_id: string | null }[] | null) ?? []) {
      if (r.gebruiker_id) idsSet.add(r.gebruiker_id);
    }

    if (idsSet.size === 0) {
      return; // Geen bijdragers — niets te doen.
    }

    await Promise.all(
      Array.from(idsSet).map((ontvangerId) =>
        notifyUser(supabase, type, ontvangerId, fondsId, payload, opts)
      )
    );
  } catch (e) {
    console.error(`[notifyAgendapuntBijdragers:${type}] Onverwachte fout:`, e);
  }
}
