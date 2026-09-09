// ============================================================================
//  POST /auth/microsoft-login/uitnodiging — activeert een beperkte koppel-/
//  herstelsessie (fase 1C, #344 PR-B; ontwerp §6.2). OAuth-uitzondering: er is
//  nog geen sessie (geregistreerd als "oauth-route" in route-mechanismen).
// ----------------------------------------------------------------------------
//  Het token komt UITSLUITEND uit de body van deze POST; de pagina /koppelen
//  leest het uit het URL-fragment en verwijdert het direct. Een GET, linkpreview
//  of scanner verbruikt dus niets. Fail-closed volgorde: methode → canonieke
//  fondshost → configuratie → atomische startlimiet (V9) → vorm → activering
//  (atomisch, eenmalig, in de database). Ongeldig, verlopen, ingetrokken en al
//  gebruikt geven EXACT dezelfde neutrale melding. Het token wordt nooit gelogd;
//  alleen de categorie gaat naar de runtime-log.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { haalFondsContext } from "@/core/lib/tenant-context";
import { microsoftLoginConfig } from "@/core/lib/microsoft-login-config";
import { microsoftLoginActief, telStartpoging } from "@/core/lib/microsoft-login";
import { activeerUitnodiging } from "@/core/lib/microsoft-login-gateway";
import { canoniekeFondsHost } from "@/core/lib/microsoft-login-flow-core";
import { clientIpUitHeaders, MICROSOFT_LOGIN_START_LIMIET, startSleutel } from "@/core/lib/microsoft-login-ratelimit-core";
import { HERKOPPEL_VENSTER_SECONDEN } from "@/core/lib/microsoft-login-beleid-core";
import { ACTIVERING_SCHEMA, herkoppelTokenHash, UITNODIGING_ONGELDIG_MELDING } from "@/core/lib/microsoft-login-beheer-core";
import { microsoftLoginFoutcategorie } from "@/core/lib/microsoft-login-error-core";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

function nietBeschikbaar(): NextResponse {
  return NextResponse.json({ error: "Deze inlogmethode is niet beschikbaar." }, { status: 404, headers: NO_STORE });
}

/** Eén neutrale weigering voor ongeldig, verlopen, ingetrokken en al gebruikt. */
function ongeldig(): NextResponse {
  return NextResponse.json({ error: UITNODIGING_ONGELDIG_MELDING }, { status: 403, headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  let config;
  try {
    config = microsoftLoginConfig();
  } catch {
    return nietBeschikbaar();
  }
  const host = canoniekeFondsHost(req.headers.get("host"), { lokaalToegestaan: config.lokaalToegestaan });
  if (!host) return nietBeschikbaar();
  const resolutie = await haalFondsContext(host);
  if (resolutie.type !== "gevonden") return nietBeschikbaar();
  const actief = await microsoftLoginActief(resolutie.fondsId).catch(() => ({ actief: false as const }));
  if (!actief.actief) return nietBeschikbaar();

  // V9 — dezelfde atomische teller als de inlogstart; telling mislukt = weigeren.
  try {
    const telling = await telStartpoging({
      sleutel: startSleutel(clientIpUitHeaders((n) => req.headers.get(n)), host, config.sleutel.sleutel),
      limiet: MICROSOFT_LOGIN_START_LIMIET.limiet,
      vensterSeconden: MICROSOFT_LOGIN_START_LIMIET.vensterSeconden,
    });
    if (!telling.toegestaan) {
      console.warn("[MICROSOFT-LOGIN] uitnodiging activeren geweigerd: ratelimit");
      return ongeldig();
    }
  } catch (e) {
    console.warn(`[MICROSOFT-LOGIN] uitnodiging activeren geweigerd: ratelimit-telling mislukt (${microsoftLoginFoutcategorie(e)})`);
    return ongeldig();
  }

  const body = ACTIVERING_SCHEMA.safeParse(await req.json().catch(() => null));
  if (!body.success) return ongeldig();

  try {
    const r = await activeerUitnodiging({
      tokenHash: herkoppelTokenHash(body.data.token),
      fondsId: resolutie.fondsId,
      vensterSeconden: HERKOPPEL_VENSTER_SECONDEN,
      correlatieId: crypto.randomUUID(),
    });
    if ("categorie" in r) {
      console.warn(`[MICROSOFT-LOGIN] uitnodiging activeren geweigerd: ${r.categorie}`);
      return ongeldig();
    }
    return NextResponse.json({ ok: true, vensterTot: r.vensterTot.toISOString() }, { headers: NO_STORE });
  } catch (e) {
    console.warn(`[MICROSOFT-LOGIN] uitnodiging activeren mislukt: ${microsoftLoginFoutcategorie(e)}`);
    return ongeldig();
  }
}
