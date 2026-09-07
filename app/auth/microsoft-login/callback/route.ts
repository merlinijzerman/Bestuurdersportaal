// ============================================================================
//  GET /auth/microsoft-login/callback — Entra stuurt hier code+state terug (fase
//  1B, #335 T2; ontwerp §3.4–§3.5). OAuth-uitzondering buiten withFondsRoute
//  (geregistreerd in route-mechanismen.expected.json als "oauth-route").
// ----------------------------------------------------------------------------
//  De route doet zelf niets met tokens of claims: de orkestratie consumeert de
//  eenmalige transactie, wisselt de code, verifieert handtekening en claims en
//  laat Supabase pas een sessie uitgeven ná een actieve binding (inloggen) of
//  een reservering (koppelen). Elke fout wordt één neutrale redirect met
//  supportcode; de categorie gaat uitsluitend naar de runtime-log en de private
//  audit. Nooit code/state/nonce/token in log of URL.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { haalFondsContext } from "@/core/lib/tenant-context";
import { microsoftLoginGeconfigureerd } from "@/core/lib/microsoft-login-config";
import { microsoftLoginVoorRequest } from "@/core/lib/microsoft-login";
import { MicrosoftLoginFlowFout } from "@/core/lib/microsoft-login-orkestratie-core";
import {
  LOGIN_FOUT_PARAM,
  LOGIN_FOUT_WAARDE,
  microsoftLoginFoutcategorie,
  profielCodeVoor,
  SUPPORTCODE_PARAM,
  supportcode,
} from "@/core/lib/microsoft-login-error-core";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function naarLogin(origin: string, sc?: string): NextResponse {
  const u = new URL("/login", origin);
  u.searchParams.set(LOGIN_FOUT_PARAM, LOGIN_FOUT_WAARDE);
  if (sc) u.searchParams.set(SUPPORTCODE_PARAM, sc);
  return NextResponse.redirect(u, { headers: NO_STORE });
}

function naarProfiel(origin: string, params: Record<string, string>): NextResponse {
  const u = new URL("/profiel", origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u, { headers: NO_STORE });
}

export async function GET(req: NextRequest) {
  const { origin, searchParams } = new URL(req.url);
  const host = req.headers.get("host")?.trim().toLowerCase() ?? "";

  const resolutie = await haalFondsContext(host);
  if (resolutie.type !== "gevonden" || !microsoftLoginGeconfigureerd()) return naarLogin(origin);

  try {
    const flow = await microsoftLoginVoorRequest();
    const r = await flow.voltooiCallback({
      host,
      hostFondsId: resolutie.fondsId,
      code: searchParams.get("code"),
      state: searchParams.get("state"),
      error: searchParams.get("error"),
    });
    if (r.intent === "inloggen") return NextResponse.redirect(new URL(r.next, origin), { headers: NO_STORE });
    return naarProfiel(origin, { microsoft_login: "gekoppeld" });
  } catch (e) {
    const categorie = microsoftLoginFoutcategorie(e);
    if (e instanceof MicrosoftLoginFlowFout) {
      const sc = supportcode(e.correlatieId);
      console.warn(`[MICROSOFT-LOGIN] callback mislukt: ${categorie} (${e.intent ?? "onbekend"}, ${sc})`);
      if (e.intent === "koppelen") return naarProfiel(origin, { microsoft_login: "fout", c: profielCodeVoor(categorie), [SUPPORTCODE_PARAM]: sc });
      return naarLogin(origin, sc);
    }
    console.warn(`[MICROSOFT-LOGIN] callback mislukt: ${categorie}`);
    return naarLogin(origin);
  }
}
