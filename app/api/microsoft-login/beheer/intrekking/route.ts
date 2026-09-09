// ============================================================================
//  POST /api/microsoft-login/beheer/intrekking — beheerintrekking van een
//  Microsoft-koppeling (fase 1C, #344 PR-B; ontwerp §8).
// ----------------------------------------------------------------------------
//  Standaard → `revoking`: de hook weigert direct, het levende slot blijft bezet
//  zodat de gebruiker de GoTrue-identiteit zelf nog netjes kan losmaken.
//  `afronden: true` → direct `revoked` (vertrokken gebruiker). De UI vraagt daar
//  een aparte, nadrukkelijke bevestiging voor: de GoTrue-identiteit blijft achter
//  en kan hergebruik van hetzelfde Microsoft-account blokkeren.
//  De database neemt de fondslock en audit (`beheer.ingetrokken`); de route
//  vertaalt alleen categorieën.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { microsoftLoginGeconfigureerd } from "@/core/lib/microsoft-login-config";
import { beheerIntrekking } from "@/core/lib/microsoft-login-gateway";
import { INTREKKING_SCHEMA } from "@/core/lib/microsoft-login-beheer-core";
import { microsoftLoginFoutcategorie } from "@/core/lib/microsoft-login-error-core";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

export const POST = withFondsRoute(
  // rateLimit "geen" (beoordeeld): beheeractie, capability-gated, DB-gelockt.
  { hostGuard: "afdwingen", rateLimit: "geen", audit: { handeling: "microsoft-login.beheer.intrekken" }, capability: "login.beleid.manage", schema: INTREKKING_SCHEMA, label: "microsoft-login.beheer.intrekking" },
  async (ctx, req: NextRequest) => {
    if (!(await requireCapability(ctx.gebruikerId, "login.beleid.manage"))) {
      return NextResponse.json({ error: "Geen rechten om het loginbeleid te beheren (login.beleid.manage)" }, { status: 403, headers: NO_STORE });
    }
    if (!ctx.fondsId || !microsoftLoginGeconfigureerd()) return NextResponse.json({ error: "Microsoft-login is niet beschikbaar voor dit fonds." }, { status: 404, headers: NO_STORE });
    const body = INTREKKING_SCHEMA.safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400, headers: NO_STORE });
    try {
      const r = await beheerIntrekking({
        fondsId: ctx.fondsId,
        doelUserId: body.data.doelUserId,
        actorId: ctx.gebruikerId,
        afronden: body.data.afronden === true,
        correlatieId: ctx.requestId,
      });
      if ("categorie" in r) {
        console.warn(`[MICROSOFT-LOGIN] beheerintrekking geweigerd: ${r.categorie}`);
        return NextResponse.json({ error: "De intrekking kan niet worden uitgevoerd.", categorie: r.categorie }, { status: 409, headers: NO_STORE });
      }
      return NextResponse.json({ ok: true, afgerond: body.data.afronden === true }, { headers: NO_STORE });
    } catch (e) {
      console.warn(`[MICROSOFT-LOGIN] beheerintrekking mislukt: ${microsoftLoginFoutcategorie(e)}`);
      return NextResponse.json({ error: "De intrekking kan nu niet worden uitgevoerd." }, { status: 503, headers: NO_STORE });
    }
  },
);
