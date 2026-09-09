// ============================================================================
//  POST /api/microsoft-login/beheer/breakglass — een DUURZAME noodtoegangs-
//  aanwijzing verlenen (fase 1C, #344 PR-B; ontwerp §6.1, besluit 0212 D11).
// ----------------------------------------------------------------------------
//  Niet zelf toe te kennen (de database weigert actor = doel), pas werkzaam met
//  een geverifieerde MFA-factor (de Auth-hook toetst dat), en met een
//  herzieningsdatum voor de verloopbewaking — geen einddatum. Intrekken:
//  DELETE …/breakglass/[id].
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { microsoftLoginGeconfigureerd } from "@/core/lib/microsoft-login-config";
import { verleenBreakGlass } from "@/core/lib/microsoft-login-gateway";
import { BREAKGLASS_HERZIEN_OVER_DAGEN, BREAKGLASS_SCHEMA } from "@/core/lib/microsoft-login-beheer-core";
import { microsoftLoginFoutcategorie } from "@/core/lib/microsoft-login-error-core";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

export const POST = withFondsRoute(
  // rateLimit "geen" (beoordeeld): beheeractie, capability-gated, DB-gelockt.
  { hostGuard: "afdwingen", rateLimit: "geen", audit: { handeling: "microsoft-login.breakglass.verlenen" }, capability: "login.beleid.manage", schema: BREAKGLASS_SCHEMA, label: "microsoft-login.beheer.breakglass" },
  async (ctx, req: NextRequest) => {
    if (!(await requireCapability(ctx.gebruikerId, "login.beleid.manage"))) {
      return NextResponse.json({ error: "Geen rechten om het loginbeleid te beheren (login.beleid.manage)" }, { status: 403, headers: NO_STORE });
    }
    if (!ctx.fondsId || !microsoftLoginGeconfigureerd()) return NextResponse.json({ error: "Microsoft-login is niet beschikbaar voor dit fonds." }, { status: 404, headers: NO_STORE });
    const body = BREAKGLASS_SCHEMA.safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400, headers: NO_STORE });
    try {
      const r = await verleenBreakGlass({
        fondsId: ctx.fondsId,
        doelUserId: body.data.doelUserId,
        reden: body.data.reden,
        actorId: ctx.gebruikerId,
        herzienOverDagen: body.data.herzienOverDagen ?? BREAKGLASS_HERZIEN_OVER_DAGEN,
        correlatieId: ctx.requestId,
      });
      if ("categorie" in r) {
        console.warn(`[MICROSOFT-LOGIN] break-glass verlenen geweigerd: ${r.categorie}`);
        const tekst = r.categorie === "zelf_toekennen" ? "Noodtoegang kan niet aan uzelf worden toegekend." : "Noodtoegang kan niet worden verleend.";
        return NextResponse.json({ error: tekst, categorie: r.categorie }, { status: 409, headers: NO_STORE });
      }
      return NextResponse.json({ ok: true, id: r.id }, { headers: NO_STORE });
    } catch (e) {
      console.warn(`[MICROSOFT-LOGIN] break-glass verlenen mislukt: ${microsoftLoginFoutcategorie(e)}`);
      return NextResponse.json({ error: "Noodtoegang kan nu niet worden verleend." }, { status: 503, headers: NO_STORE });
    }
  },
);
