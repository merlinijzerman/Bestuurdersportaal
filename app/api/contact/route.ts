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
import { createAnonSupabase } from "@/core/lib/supabase-anon";
import { valideerContact } from "@/core/lib/contact-validatie";
import { verstuurContactNotificatie } from "@/core/lib/email";
import { badRequest, errorResponse, rateLimited } from "@/core/lib/api-errors";

const LABEL = "contact.POST";

// Gekoppelde privacyverklaring-versie (zie app/(public)/privacy). Wordt
// server-side bij elke inzending meegeslagen (FO §10 / REQ-PV-040).
const PRIVACY_VERSION = "2026-06-29";

// Rate-limit-venster voor de Retry-After bij een 429. De AUTORITATIEVE limiet
// (max 3 / 10 min) is sinds D1 in de RPC contact_aanvraag_insert belegd; dit
// venster spiegelt het RPC-interval alleen voor de reset-hint naar de client.
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

/** Verifieert het Turnstile-token serverside bij Cloudflare (D1-hardening B1).
 *  Een expliciet ongeldig token → false. Fail-open ALLEEN bij een eigen netwerk-/
 *  parsefout: de payload-cap + rate-limit blijven dan de vangrail, en een
 *  Cloudflare-hik mag het contactformulier niet volledig platleggen. */
async function verifieerTurnstile(
  secret: string,
  token: string,
  req: NextRequest
): Promise<boolean> {
  try {
    const form = new URLSearchParams({ secret, response: token });
    const ip =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (ip) form.set("remoteip", ip);
    const r = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      }
    );
    const data = (await r.json()) as { success?: boolean };
    return data.success === true;
  } catch (e) {
    console.error(`[${LABEL}] Turnstile-verificatie faalde (fail-open)`, e);
    return true;
  }
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

    // 3b. Bot-verificatie (Cloudflare Turnstile, D1-hardening B1). Alleen
    //     afdwingen als de secret geconfigureerd is (soft-config: lokaal zonder
    //     keys → overslaan). Token is single-use; de client reset na elke ronde.
    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
    if (turnstileSecret) {
      const tsToken =
        typeof body.turnstile_token === "string" ? body.turnstile_token : "";
      if (!tsToken) {
        return badRequest(
          LABEL,
          "Bevestig dat u geen robot bent en probeer het opnieuw."
        );
      }
      if (!(await verifieerTurnstile(turnstileSecret, tsToken, req))) {
        return badRequest(
          LABEL,
          "Bot-verificatie mislukt. Vernieuw de pagina en probeer het opnieuw."
        );
      }
    }

    // D1: GEEN service-role meer. Insert + rate-limit + notificatie-status lopen
    // via SECURITY DEFINER-RPC's met de anon-key (contact_aanvragen blijft
    // deny-by-default). De rate-limit is nu in contact_aanvraag_insert belegd;
    // hier alleen nog de ip_hash-berekening (fail-open zonder salt/IP).
    const db = createAnonSupabase();
    const ipHash = berekenIpHash(req);

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

    // 6. Insert via de anon-RPC (bron-van-waarheid). De RPC toetst intern de
    //    rate-limit (status 'rate_limited') en insert anders. Rate-limit valt nu
    //    dus ná validatie i.p.v. ervoor — functioneel gelijk (een over-limiet
    //    geldige inzending krijgt nog steeds 429).
    const { data: rpcRijen, error: insertFout } = await db.rpc(
      "contact_aanvraag_insert",
      {
        p_naam: schoon.naam,
        p_organisatie: schoon.organisatie,
        p_rol: schoon.rol,
        p_email: schoon.email,
        p_telefoon: schoon.telefoon,
        p_type_verzoek: schoon.type_verzoek,
        p_bericht: schoon.bericht,
        p_herkomst_pagina: herkomst,
        p_privacy_version: PRIVACY_VERSION,
        p_ip_hash: ipHash,
      }
    );

    // De RPC geeft een tabel (0/1 rij) terug: { id, aangemaakt_op, status }.
    const rij = (Array.isArray(rpcRijen) ? rpcRijen[0] : rpcRijen) as
      | { id: string | null; aangemaakt_op: string | null; status: string }
      | undefined;

    if (insertFout || !rij) {
      return errorResponse(LABEL, insertFout, {
        userMessage:
          "Het verzoek kon niet worden opgeslagen. Probeer het later opnieuw.",
      });
    }

    // Rate-limit-uitkomst uit de RPC → 429 met reset-hint.
    if (rij.status === "rate_limited") {
      return rateLimited(LABEL, new Date(Date.now() + RL_VENSTER_MS));
    }
    if (!rij.id) {
      return errorResponse(LABEL, null, {
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
      const { error: updateFout } = await db.rpc("contact_notificatie_status", {
        p_id: rij.id,
        p_verzonden: false,
        p_error: mail.error ?? null,
      });
      if (updateFout) {
        console.error(`[${LABEL}] kon mail_error niet wegschrijven`, updateFout);
      }
    } else {
      const { error: updateFout } = await db.rpc("contact_notificatie_status", {
        p_id: rij.id,
        p_verzonden: true,
        p_error: null,
      });
      if (updateFout) {
        console.error(`[${LABEL}] kon notificatie-status niet wegschrijven`, updateFout);
      }
    }

    // 8. Succes — minimale payload. Mailstatus lekt niet naar de gebruiker:
    //    opslag is geslaagd, dat is wat telt.
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(LABEL, e);
  }
}
