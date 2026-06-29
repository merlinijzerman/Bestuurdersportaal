// ============================================================================
//  POST /api/contact — publieke contactinzending (W2a + W2b).
// ----------------------------------------------------------------------------
//  Publiek bereikbaar (geen auth), maar beschermd. Verwerkingsvolgorde (TO §4):
//    1. methode + content-type
//    2. origin/CSRF-check tegen de marketing-host
//    3. honeypot  → stil 200 (geen opslag/mail)
//    4. rate-limit (per ip_hash, eigen telling op contact_aanvragen) → 429
//    5. server-side validatie → generieke 400
//    6. insert via service-role incl. privacy_version (+ ip_hash)
//    7. e-mailnotificatie (W2b) — SOFT-FAIL: opslag leidend
//    8. 200 minimale success-payload
//
//  Insert loopt UITSLUITEND via de service-role-client (RLS deny-by-default op
//  contact_aanvragen; de browser schrijft nooit direct — FO REQ-PV-042).
//  Dataminimalisatie (FO §10): geen ruw IP; alleen een gezouten ip_hash, en
//  alleen voor de rate-limit/misbruikbestrijding.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase-service";
import { valideerContact } from "@/lib/contact-validatie";
import { verstuurContactNotificatie } from "@/lib/email";
import { badRequest, errorResponse, rateLimited } from "@/lib/api-errors";

const LABEL = "contact.POST";

// Gekoppelde privacyverklaring-versie (concept; zie app/(public)/privacy).
// Wordt server-side bij elke inzending meegeslagen (FO §10 / REQ-PV-040).
const PRIVACY_VERSION = "concept-2026-06-29";

// Rate-limit: max N opgeslagen inzendingen per ip_hash binnen het venster.
const RL_LIMIET = 3;
const RL_VENSTER_MS = 10 * 60 * 1000;

const HERKOMST_MAX = 255;

/**
 * Origin/CSRF-check (TO §9.1): de POST moet van de marketing-host komen. We
 * vergelijken de host uit Origin (voorkeur) of Referer tegen MARKETING_HOST
 * (komma-gescheiden lijst). Buiten productie laten we localhost/geen-origin toe,
 * zodat lokaal smoken (curl/preview) blijft werken.
 */
function originToegestaan(req: NextRequest): boolean {
  const isDev = process.env.NODE_ENV !== "production";
  const bron = req.headers.get("origin") || req.headers.get("referer");

  if (!bron) return isDev; // geen header → alleen in dev toestaan

  let host: string;
  try {
    host = new URL(bron).host;
  } catch {
    return false;
  }

  if (isDev && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return true;

  const toegestane = (process.env.MARKETING_HOST || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  return toegestane.includes(host.toLowerCase());
}

/** Gezouten sha256-hash van het IP. Null als er geen IP of salt is. */
function berekenIpHash(req: NextRequest): string | null {
  const salt = process.env.CONTACT_IP_HASH_SALT;
  if (!salt) return null;
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim();
  if (!ip) return null;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    // 1. Content-type moet JSON zijn.
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return badRequest(LABEL, "Ongeldig verzoek.", 415);
    }

    // 2. Origin/CSRF.
    if (!originToegestaan(req)) {
      console.warn(`[${LABEL}] 403 origin geweigerd`);
      return NextResponse.json({ error: "Verzoek geweigerd." }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return badRequest(LABEL, "Ongeldig verzoek.");
    }

    // 3. Honeypot: gevuld → stil negeren (geen opslag/mail). Bewust 200, zodat
    //    een bot geen signaal krijgt dat hij gedetecteerd is (FO REQ-PV-017).
    const honeypot = typeof body.website === "string" ? body.website.trim() : "";
    if (honeypot) {
      return NextResponse.json({ ok: true });
    }

    const service = createServiceSupabase();

    // 4. Rate-limit op ip_hash (eigen telling; lib/rate-limit.ts is auth-only en
    //    hier niet bruikbaar). Geen ip_hash (geen salt/IP) → fail-open.
    const ipHash = berekenIpHash(req);
    if (ipHash) {
      const sinds = new Date(Date.now() - RL_VENSTER_MS).toISOString();
      const { count, error: telFout } = await service
        .from("contact_aanvragen")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("aangemaakt_op", sinds);
      if (telFout) {
        // Fail-open: een telstoring mag het formulier niet platleggen.
        console.error(`[${LABEL}] rate-limit telling mislukt — fail-open`, telFout);
      } else if ((count ?? 0) >= RL_LIMIET) {
        const reset = new Date(Date.now() + RL_VENSTER_MS);
        return rateLimited(LABEL, reset);
      }
    }

    // 5. Server-side validatie (autoritatief). Generieke 400 naar buiten.
    const resultaat = valideerContact({
      naam: body.naam,
      organisatie: body.organisatie,
      rol: body.rol,
      email: body.email,
      telefoon: body.telefoon,
      type_verzoek: body.type_verzoek,
      bericht: body.bericht,
    });
    if (!resultaat.ok) {
      return badRequest(
        LABEL,
        "Controleer de ingevulde velden en probeer het opnieuw."
      );
    }
    const schoon = resultaat.schoon;

    // Herkomstpagina: uit de body (client stuurt pathname) of de Referer-path.
    let herkomst: string | null =
      typeof body.herkomst_pagina === "string"
        ? body.herkomst_pagina.trim().slice(0, HERKOMST_MAX)
        : null;
    if (!herkomst) {
      const ref = req.headers.get("referer");
      if (ref) {
        try {
          herkomst = new URL(ref).pathname.slice(0, HERKOMST_MAX);
        } catch {
          /* laat null */
        }
      }
    }

    // 6. Insert via service-role. Bron-van-waarheid; gebruiker krijgt succes
    //    zodra dit lukt (mail volgt soft-fail).
    const { data: rij, error: insertFout } = await service
      .from("contact_aanvragen")
      .insert({
        naam: schoon.naam,
        organisatie: schoon.organisatie,
        rol: schoon.rol,
        email: schoon.email,
        telefoon: schoon.telefoon,
        type_verzoek: schoon.type_verzoek,
        bericht: schoon.bericht,
        herkomst_pagina: herkomst,
        privacy_version: PRIVACY_VERSION,
        ip_hash: ipHash,
      })
      .select("id, aangemaakt_op")
      .single();

    if (insertFout || !rij) {
      return errorResponse(LABEL, insertFout, {
        userMessage:
          "Het verzoek kon niet worden opgeslagen. Probeer het later opnieuw.",
      });
    }

    // 7. E-mailnotificatie — SOFT-FAIL. Mislukt deze, dan blijft de opslag staan
    //    en markeren we het record zodat handmatige opvolging mogelijk is.
    const mail = await verstuurContactNotificatie({
      naam: schoon.naam,
      organisatie: schoon.organisatie,
      rol: schoon.rol,
      email: schoon.email,
      telefoon: schoon.telefoon,
      type_verzoek: schoon.type_verzoek,
      bericht: schoon.bericht,
      herkomstPagina: herkomst,
      aangemaaktOp: rij.aangemaakt_op ? new Date(rij.aangemaakt_op) : new Date(),
    });

    if (!mail.ok) {
      console.error(`[${LABEL}] notificatie soft-fail:`, mail.error);
      const { error: updateFout } = await service
        .from("contact_aanvragen")
        .update({ notificatie_verzonden: false, mail_error: mail.error })
        .eq("id", rij.id);
      if (updateFout) {
        console.error(`[${LABEL}] kon mail_error niet wegschrijven`, updateFout);
      }
    } else {
      await service
        .from("contact_aanvragen")
        .update({ notificatie_verzonden: true })
        .eq("id", rij.id);
    }

    // 8. Succes — minimale payload. Mailstatus lekt niet naar de gebruiker:
    //    opslag is geslaagd, dat is wat telt.
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(LABEL, e);
  }
}
