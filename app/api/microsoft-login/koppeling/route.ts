// ============================================================================
//  /api/microsoft-login/koppeling — status (GET), ontkoppelen (DELETE) en herstel
//  (POST) van de Microsoft-login-koppeling van het EIGEN account (fase 1B, #335 T2;
//  ontwerp §3.8). Strikt zelfbeheer: profile.view.own / profile.manage.own.
// ----------------------------------------------------------------------------
//  De statusrespons draagt nooit tid/oid/sub of e-mail — alleen de toestand en
//  tijdstippen. Ontkoppelen: revoking → unlinkIdentity → revoked; mislukt de
//  unlink, dan blijft de binding revoking (hook weigert) en toont de kaart
//  "Opnieuw proberen". Herstel is idempotent (pending + azure-identiteit → active).
// ============================================================================
import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftLoginGeconfigureerd } from "@/core/lib/microsoft-login-config";
import { microsoftLoginActief, microsoftLoginVoorRequest } from "@/core/lib/microsoft-login";
import { microsoftLoginFoutcategorie, PROFIEL_MICROSOFT_LOGIN_MELDINGEN } from "@/core/lib/microsoft-login-error-core";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

async function beschikbaar(fondsId: string | null): Promise<boolean> {
  if (!fondsId || !microsoftLoginGeconfigureerd()) return false;
  const actief = await microsoftLoginActief(fondsId).catch(() => ({ actief: false as const }));
  return actief.actief;
}

export const GET = withFondsRoute(
  { hostGuard: "afdwingen", rateLimit: "geen", audit: "geen", capability: "profile.view.own", schema: "geen-body" },
  async (ctx) => {
    if (!(await beschikbaar(ctx.fondsId))) return NextResponse.json({ beschikbaar: false }, { headers: NO_STORE });
    try {
      const flow = await microsoftLoginVoorRequest();
      const status = await flow.status({ userId: ctx.gebruikerId });
      return NextResponse.json({ beschikbaar: true, ...status }, { headers: NO_STORE });
    } catch (e) {
      console.warn(`[MICROSOFT-LOGIN] status mislukt: ${microsoftLoginFoutcategorie(e)}`);
      return NextResponse.json({ beschikbaar: true, status: "onbekend" }, { status: 503, headers: NO_STORE });
    }
  },
);

export const DELETE = withFondsRoute(
  // rateLimit "geen" (beoordeeld): eigen account, één GoTrue-unlink per aanroep, idempotent.
  { hostGuard: "afdwingen", rateLimit: "geen", audit: { handeling: "microsoft-login.koppeling.ontkoppelen" }, capability: "profile.manage.own", schema: "geen-body" },
  async (ctx) => {
    if (!(await beschikbaar(ctx.fondsId))) {
      return NextResponse.json({ error: "Microsoft-login is niet beschikbaar voor dit fonds." }, { status: 404, headers: NO_STORE });
    }
    try {
      const flow = await microsoftLoginVoorRequest();
      await flow.ontkoppel({ fondsId: ctx.fondsId!, userId: ctx.gebruikerId });
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    } catch (e) {
      const categorie = microsoftLoginFoutcategorie(e);
      console.warn(`[MICROSOFT-LOGIN] ontkoppelen mislukt: ${categorie}`);
      if (categorie === "onbekende_binding") return NextResponse.json({ error: "Er is geen Microsoft-koppeling." }, { status: 404, headers: NO_STORE });
      return NextResponse.json({ error: PROFIEL_MICROSOFT_LOGIN_MELDINGEN.ontkoppelen }, { status: 409, headers: NO_STORE });
    }
  },
);

export const POST = withFondsRoute(
  // rateLimit "geen" (beoordeeld): idempotente herstelroute zonder externe aanroep.
  { hostGuard: "afdwingen", rateLimit: "geen", audit: { handeling: "microsoft-login.koppeling.herstellen" }, capability: "profile.manage.own", schema: "geen-body" },
  async (ctx) => {
    if (!(await beschikbaar(ctx.fondsId))) {
      return NextResponse.json({ error: "Microsoft-login is niet beschikbaar voor dit fonds." }, { status: 404, headers: NO_STORE });
    }
    try {
      const flow = await microsoftLoginVoorRequest();
      const r = await flow.herstel({ userId: ctx.gebruikerId });
      return NextResponse.json(r, { headers: NO_STORE });
    } catch (e) {
      const categorie = microsoftLoginFoutcategorie(e);
      console.warn(`[MICROSOFT-LOGIN] herstel mislukt: ${categorie}`);
      if (categorie === "onbekende_binding") return NextResponse.json({ error: "Er is geen Microsoft-koppeling." }, { status: 404, headers: NO_STORE });
      return NextResponse.json({ error: PROFIEL_MICROSOFT_LOGIN_MELDINGEN.koppelen }, { status: 409, headers: NO_STORE });
    }
  },
);
