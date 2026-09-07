// ============================================================================
//  GET /api/microsoft-login/koppelen/start — een INGELOGDE gebruiker koppelt zijn
//  Microsoft-account aan zijn eigen portaalaccount (fase 1B, #335 T2; ontwerp §3.5).
// ----------------------------------------------------------------------------
//  hostGuard "afdwingen": de koppeling hoort bij het fonds van de host én van het
//  profiel (de DB eist dat opnieuw in reserveer_identiteit). rateLimit
//  microsoft_login_start (V9, per gebruiker via de DB-teller). Eén levende binding
//  per account: bestaat er al een pending/active/revoking, dan 409.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftLoginGeconfigureerd } from "@/core/lib/microsoft-login-config";
import { microsoftLoginActief, microsoftLoginVoorRequest } from "@/core/lib/microsoft-login";
import { microsoftLoginFoutcategorie } from "@/core/lib/microsoft-login-error-core";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

export const GET = withFondsRoute(
  {
    hostGuard: "afdwingen",
    rateLimit: "microsoft_login_start",
    audit: { handeling: "microsoft-login.koppeling.start" },
    capability: "profile.manage.own",
    schema: "geen-body",
    label: "microsoft-login.koppelen.start",
  },
  async (ctx, req: NextRequest) => {
    if (!ctx.fondsId || !microsoftLoginGeconfigureerd()) {
      return NextResponse.json({ error: "Microsoft-login is niet beschikbaar voor dit fonds." }, { status: 404, headers: NO_STORE });
    }
    const actief = await microsoftLoginActief(ctx.fondsId).catch(() => ({ actief: false as const }));
    if (!actief.actief) {
      return NextResponse.json({ error: "Microsoft-login is niet beschikbaar voor dit fonds." }, { status: 404, headers: NO_STORE });
    }
    try {
      const flow = await microsoftLoginVoorRequest();
      const status = await flow.status({ userId: ctx.gebruikerId });
      if (status.status !== "geen") {
        return NextResponse.json({ error: "Er is al een Microsoft-koppeling voor dit account." }, { status: 409, headers: NO_STORE });
      }
      const host = req.headers.get("host")?.trim().toLowerCase() ?? "";
      const { url } = await flow.start({ intent: "koppelen", hostFondsId: ctx.fondsId, host, userId: ctx.gebruikerId, next: "/profiel" });
      return NextResponse.redirect(url, { headers: NO_STORE });
    } catch (e) {
      console.warn(`[MICROSOFT-LOGIN] koppelen starten mislukt: ${microsoftLoginFoutcategorie(e)}`);
      return NextResponse.json({ error: "Microsoft-login kan nu niet worden gestart." }, { status: 503, headers: NO_STORE });
    }
  },
);
