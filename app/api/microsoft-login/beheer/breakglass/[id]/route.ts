// ============================================================================
//  DELETE /api/microsoft-login/beheer/breakglass/[id] — een noodtoegangs-
//  aanwijzing intrekken (fase 1C, #344 PR-B). Intrekken beëindigt lopende
//  activeringsvensters direct (0212 D14); de database audit en vergrendelt.
// ============================================================================
import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { microsoftLoginGeconfigureerd } from "@/core/lib/microsoft-login-config";
import { trekBreakGlassIn } from "@/core/lib/microsoft-login-gateway";
import { microsoftLoginFoutcategorie } from "@/core/lib/microsoft-login-error-core";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE = withFondsRoute(
  // rateLimit "geen" (beoordeeld): beheeractie, capability-gated, DB-gelockt.
  { hostGuard: "afdwingen", rateLimit: "geen", audit: { handeling: "microsoft-login.breakglass.intrekken" }, capability: "login.beleid.manage", schema: "geen-body", label: "microsoft-login.beheer.breakglass" },
  async (ctx, _req, params) => {
    if (!(await requireCapability(ctx.gebruikerId, "login.beleid.manage"))) {
      return NextResponse.json({ error: "Geen rechten om het loginbeleid te beheren (login.beleid.manage)" }, { status: 403, headers: NO_STORE });
    }
    if (!ctx.fondsId || !microsoftLoginGeconfigureerd()) return NextResponse.json({ error: "Microsoft-login is niet beschikbaar voor dit fonds." }, { status: 404, headers: NO_STORE });
    const id = (params as { id?: string } | undefined)?.id ?? "";
    if (!UUID.test(id)) return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400, headers: NO_STORE });
    try {
      const categorie = await trekBreakGlassIn({ id, fondsId: ctx.fondsId, actorId: ctx.gebruikerId, correlatieId: ctx.requestId });
      if (categorie) {
        console.warn(`[MICROSOFT-LOGIN] break-glass intrekken geweigerd: ${categorie}`);
        return NextResponse.json({ error: "De noodtoegangsaanwijzing kan niet worden ingetrokken.", categorie }, { status: 409, headers: NO_STORE });
      }
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    } catch (e) {
      console.warn(`[MICROSOFT-LOGIN] break-glass intrekken mislukt: ${microsoftLoginFoutcategorie(e)}`);
      return NextResponse.json({ error: "De noodtoegangsaanwijzing kan nu niet worden ingetrokken." }, { status: 503, headers: NO_STORE });
    }
  },
);
