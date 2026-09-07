// ============================================================================
//  GET /auth/microsoft-login/start — start van "Inloggen met Microsoft" (fase 1B,
//  #335 T2; ontwerp §3.4). OAuth-uitzondering: er is nog geen sessie, dus deze
//  route loopt bewust buiten withFondsRoute (geregistreerd in
//  tests/cross-tenant/route-mechanismen.expected.json als "oauth-route").
// ----------------------------------------------------------------------------
//  Fail-closed volgorde: tempolimiet (V9) → host→fonds → configuratie → fondsflag
//  → bestaande sessie met profiel → veilig vervolgpad → transactie → 302 Entra.
//  Geen sessie, geen cookie, geen state/nonce buiten de versleutelde transactie.
//  Elke weigering is neutraal (404 zonder fondsbestaan te lekken, of de ene
//  loginmelding met supportcode); alleen de categorie gaat naar de runtime-log.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { haalFondsContext } from "@/core/lib/tenant-context";
import { veiligVervolgpad } from "@/core/lib/redirect-veilig";
import { microsoftLoginGeconfigureerd } from "@/core/lib/microsoft-login-config";
import { microsoftLoginActief, microsoftLoginVoorRequest } from "@/core/lib/microsoft-login";
import { MicrosoftLoginFlowFout } from "@/core/lib/microsoft-login-orkestratie-core";
import { LOGIN_FOUT_PARAM, LOGIN_FOUT_WAARDE, microsoftLoginFoutcategorie, SUPPORTCODE_PARAM, supportcode } from "@/core/lib/microsoft-login-error-core";
import { clientIpUitHeaders, maakVensterLimiter, startSleutel } from "@/core/lib/microsoft-login-ratelimit-core";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
// Per Node-proces (op Vercel: per instantie, best-effort — zie ratelimit-core).
const limiter = maakVensterLimiter();

function nietBeschikbaar(): NextResponse {
  return NextResponse.json({ error: "Deze inlogmethode is niet beschikbaar." }, { status: 404, headers: NO_STORE });
}

function naarLogin(origin: string, sc?: string): NextResponse {
  const u = new URL("/login", origin);
  u.searchParams.set(LOGIN_FOUT_PARAM, LOGIN_FOUT_WAARDE);
  if (sc) u.searchParams.set(SUPPORTCODE_PARAM, sc);
  return NextResponse.redirect(u, { headers: NO_STORE });
}

export async function GET(req: NextRequest) {
  const { origin, searchParams } = new URL(req.url);
  const host = req.headers.get("host")?.trim().toLowerCase() ?? "";

  const tempo = limiter.beoordeel(startSleutel(clientIpUitHeaders((n) => req.headers.get(n)), host));
  if (!tempo.toegestaan) {
    console.warn("[MICROSOFT-LOGIN] start geweigerd: ratelimit");
    return naarLogin(origin);
  }

  const resolutie = await haalFondsContext(host);
  if (resolutie.type !== "gevonden") return nietBeschikbaar();
  if (!microsoftLoginGeconfigureerd()) return nietBeschikbaar();
  const actief = await microsoftLoginActief(resolutie.fondsId).catch(() => ({ actief: false as const }));
  if (!actief.actief) return nietBeschikbaar();

  // Al ingelogd mét profiel → geen tweede login (zelfde regel als de login-layout).
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profiel } = await supabase.from("profielen").select("id").eq("id", user.id).maybeSingle();
    if (profiel) return NextResponse.redirect(new URL("/", origin), { headers: NO_STORE });
  }

  const next = veiligVervolgpad(searchParams.get("next"));
  try {
    const flow = await microsoftLoginVoorRequest();
    const { url } = await flow.start({ intent: "inloggen", hostFondsId: resolutie.fondsId, host, userId: null, next });
    return NextResponse.redirect(url, { headers: NO_STORE });
  } catch (e) {
    const categorie = microsoftLoginFoutcategorie(e);
    const sc = e instanceof MicrosoftLoginFlowFout ? supportcode(e.correlatieId) : undefined;
    console.warn(`[MICROSOFT-LOGIN] start mislukt: ${categorie}${sc ? ` (${sc})` : ""}`);
    return naarLogin(origin, sc);
  }
}
