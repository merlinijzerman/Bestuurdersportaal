// ============================================================================
//  E-mailnotificatie voor contactverzoeken (W2b) — Mailgun via fetch.
// ----------------------------------------------------------------------------
//  Dunne, provider-agnostische abstractie. Eén publieke functie:
//  `verstuurContactNotificatie`. Bewust GEEN npm-SDK — een directe HTTPS-call
//  naar de Mailgun-API met `fetch`, zodat we nul dependencies toevoegen en
//  volledige controle houden over timeout + soft-fail.
//
//  SOFT-FAIL (TO §6, FO REQ-PV-041): deze functie gooit NOOIT. Opslag is
//  leidend; een mislukte mail mag de gebruiker zijn succesmelding niet ontnemen.
//  De aanroeper (/api/contact) zet bij `{ ok: false }` `notificatie_verzonden
//  = false` + `mail_error` op het record, zodat de gemiste notificatie
//  handmatig opvolgbaar blijft.
//
//  TIMEOUT: een hangende provider-call mag de request niet ophouden (opslag is
//  al gelukt). AbortController kapt af na MAIL_TIMEOUT_MS → soft-fail.
//
//  CONFIG (server-side only — NOOIT NEXT_PUBLIC_*, geen adressen in de client):
//    MAILGUN_API_KEY   — Mailgun private API-key
//    MAILGUN_DOMAIN    — (sandbox)domein, bv. sandboxXXatomic.mailgun.org
//    MAILGUN_BASE_URL  — optioneel; default EU-endpoint (NL-context)
//    CONTACT_NOTIFY_TO   — komma-gescheiden ontvangers (Merlin, Robert)
//    CONTACT_NOTIFY_FROM — vast afzenderadres (sandboxdomein)
//
//  Ontbreekt config, dan soft-fail met duidelijke reden → W2a-only blijft live.
// ============================================================================

import "server-only";

const MAIL_TIMEOUT_MS = 5000;
const DEFAULT_BASE_URL = "https://api.eu.mailgun.net";

export type ContactNotificatie = {
  naam: string;
  organisatie: string;
  rol: string;
  email: string;
  telefoon: string | null;
  type_verzoek: string;
  bericht: string;
  herkomstPagina: string | null;
  aangemaaktOp: Date;
};

export type MailResultaat = { ok: true } | { ok: false; error: string };

/** HTML-escape — voorkomt injectie van aanvrager-invoer in de notificatiemail. */
function escapeHtml(waarde: string): string {
  return waarde
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rij(label: string, waarde: string | null): string {
  const v = waarde && waarde.trim() ? escapeHtml(waarde) : "—";
  return `<tr><td style="padding:4px 12px 4px 0;color:#6B6A63;vertical-align:top;white-space:nowrap">${escapeHtml(
    label
  )}</td><td style="padding:4px 0;color:#191815">${v}</td></tr>`;
}

function bouwHtml(n: ContactNotificatie): string {
  const tijdstip = n.aangemaaktOp.toLocaleString("nl-NL", {
    timeZone: "Europe/Amsterdam",
    dateStyle: "full",
    timeStyle: "short",
  });
  // bericht: escape + behoud regelovergangen.
  const berichtHtml = escapeHtml(n.bericht).replace(/\r?\n/g, "<br>");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#191815">
  <h2 style="font-size:18px;margin:0 0 16px">Nieuw contactverzoek via Bestuurdersportaal</h2>
  <table style="border-collapse:collapse;margin-bottom:16px">
    ${rij("Naam", n.naam)}
    ${rij("Organisatie", n.organisatie)}
    ${rij("Rol / functie", n.rol)}
    ${rij("E-mailadres", n.email)}
    ${rij("Telefoon", n.telefoon)}
    ${rij("Type verzoek", n.type_verzoek)}
    ${rij("Tijdstip", tijdstip)}
    ${rij("Herkomstpagina", n.herkomstPagina)}
  </table>
  <div style="border-top:1px solid #D8D3C7;padding-top:12px">
    <div style="color:#6B6A63;margin-bottom:4px">Bericht</div>
    <div>${berichtHtml}</div>
  </div>
  <p style="color:#6B6A63;font-size:12px;margin-top:20px">Antwoord op deze mail om rechtstreeks de aanvrager te beantwoorden (reply-to staat ingesteld).</p>
</div>`;
}

/**
 * Verstuur de interne notificatie van een contactverzoek via Mailgun.
 * Gooit nooit; geeft `{ ok: true }` of `{ ok: false, error }` terug.
 */
export async function verstuurContactNotificatie(
  n: ContactNotificatie
): Promise<MailResultaat> {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domein = process.env.MAILGUN_DOMAIN;
  const baseUrl = process.env.MAILGUN_BASE_URL || DEFAULT_BASE_URL;
  const from = process.env.CONTACT_NOTIFY_FROM;
  const toRaw = process.env.CONTACT_NOTIFY_TO;

  if (!apiKey || !domein || !from || !toRaw) {
    return {
      ok: false,
      error:
        "Mailgun-config onvolledig (MAILGUN_API_KEY/MAILGUN_DOMAIN/CONTACT_NOTIFY_FROM/CONTACT_NOTIFY_TO).",
    };
  }

  const ontvangers = toRaw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (ontvangers.length === 0) {
    return { ok: false, error: "CONTACT_NOTIFY_TO bevat geen geldige ontvangers." };
  }

  const body = new URLSearchParams();
  body.append("from", from);
  for (const adres of ontvangers) body.append("to", adres);
  body.append("subject", "Nieuw contactverzoek via Bestuurdersportaal");
  body.append("html", bouwHtml(n));
  // reply-to = aanvrager; e-mail is gevalideerd (geen newlines) → geen header-injectie.
  body.append("h:Reply-To", n.email);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAIL_TIMEOUT_MS);

  try {
    const resp = await fetch(`${baseUrl}/v3/${domein}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });

    if (!resp.ok) {
      // Geen response-body teruggeven aan de aanroeper (kan provider-detail lekken);
      // alleen status. Volledige detail gaat naar de server-log in de route.
      return { ok: false, error: `Mailgun gaf status ${resp.status}.` };
    }
    return { ok: true };
  } catch (e) {
    const reden =
      e instanceof Error && e.name === "AbortError"
        ? `Mailgun-timeout na ${MAIL_TIMEOUT_MS}ms.`
        : "Mailgun-aanroep mislukt (netwerkfout).";
    return { ok: false, error: reden };
  } finally {
    clearTimeout(timer);
  }
}
