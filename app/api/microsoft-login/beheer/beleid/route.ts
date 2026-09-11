// ============================================================================
//  /api/microsoft-login/beheer/beleid — beheer van het organisatiebrede
//  Microsoft-loginbeleid (fase 1C, #344 PR-B; besluit 0212).
// ----------------------------------------------------------------------------
//  GET   modus, of er een tenant is (nooit de tenant-id zelf), preflight met
//        blokkeeroverzicht, dekkingslijst en break-glass-overzicht. Geen tid/oid/
//        sub, geen e-mail: alleen naam, rol, status en tijdstippen.
//  PATCH modus zetten. `verplicht` slaagt uitsluitend als de databasepreflight
//        binnen dezelfde transactie groen is (zet_modus, advisory lock); de route
//        vertaalt alleen de categorie naar een neutrale tekst.
//  Bevoegdheid: capability `login.beleid.manage` (alleen beheerder), dubbel:
//  wrapper-poort én inline requireCapability (patroon /api/profiel).
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { microsoftLoginGeconfigureerd } from "@/core/lib/microsoft-login-config";
import { activeringPreflight, breakglassOverzicht, dekkingsrapport, leesConfig, zetModus } from "@/core/lib/microsoft-login-gateway";
import { activeringWeigering, magActiveren } from "@/core/lib/microsoft-login-beleid-core";
import { BELEID_PATCH_SCHEMA, bouwBeheerBeleidRespons } from "@/core/lib/microsoft-login-beheer-core";
import { microsoftLoginFoutcategorie } from "@/core/lib/microsoft-login-error-core";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;
const GEEN_RECHTEN = { error: "Geen rechten om het loginbeleid te beheren (login.beleid.manage)" } as const;

export const GET = withFondsRoute(
  { hostGuard: "afdwingen", rateLimit: "geen", audit: "geen", capability: "login.beleid.manage", schema: "geen-body", label: "microsoft-login.beheer.beleid" },
  async (ctx) => {
    if (!(await requireCapability(ctx.gebruikerId, "login.beleid.manage"))) return NextResponse.json(GEEN_RECHTEN, { status: 403, headers: NO_STORE });
    if (!ctx.fondsId || !microsoftLoginGeconfigureerd()) return NextResponse.json({ beschikbaar: false }, { headers: NO_STORE });
    try {
      const [config, preflight, dekking, breakglass] = await Promise.all([
        leesConfig(ctx.fondsId),
        activeringPreflight(ctx.fondsId),
        dekkingsrapport(ctx.fondsId),
        breakglassOverzicht(ctx.fondsId),
      ]);
      if (!config) return NextResponse.json({ beschikbaar: false }, { headers: NO_STORE });
      const respons = bouwBeheerBeleidRespons({
        modus: config.modus,
        entraTenantId: config.entraTenantId,
        preflight,
        dekking,
        breakglass,
        magActiveren,
        activeringWeigering,
      });
      return NextResponse.json({ beschikbaar: true, ...respons }, { headers: NO_STORE });
    } catch (e) {
      console.warn(`[MICROSOFT-LOGIN] beheer beleid lezen mislukt: ${microsoftLoginFoutcategorie(e)}`);
      return NextResponse.json({ error: "Het loginbeleid kan nu niet worden opgehaald." }, { status: 503, headers: NO_STORE });
    }
  },
);

export const PATCH = withFondsRoute(
  // rateLimit "geen" (beoordeeld): één beheeractie, capability-gated, DB-gelockt.
  { hostGuard: "afdwingen", rateLimit: "geen", audit: { handeling: "microsoft-login.beleid.wijzigen" }, capability: "login.beleid.manage", schema: BELEID_PATCH_SCHEMA, label: "microsoft-login.beheer.beleid" },
  async (ctx, req: NextRequest) => {
    if (!(await requireCapability(ctx.gebruikerId, "login.beleid.manage"))) return NextResponse.json(GEEN_RECHTEN, { status: 403, headers: NO_STORE });
    if (!ctx.fondsId || !microsoftLoginGeconfigureerd()) return NextResponse.json({ error: "Microsoft-login is niet beschikbaar voor dit fonds." }, { status: 404, headers: NO_STORE });
    const body = BELEID_PATCH_SCHEMA.safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400, headers: NO_STORE });
    try {
      const categorie = await zetModus({ fondsId: ctx.fondsId, modus: body.data.modus, actorId: ctx.gebruikerId, correlatieId: ctx.requestId });
      if (categorie) {
        // De database is de autoriteit (preflight in dezelfde transactie); hier alleen een neutrale tekst.
        const preflight = await activeringPreflight(ctx.fondsId).catch(() => null);
        return NextResponse.json({ error: activeringWeigering(categorie, preflight?.ongedekteAccounts ?? 0), categorie }, { status: 409, headers: NO_STORE });
      }
      return NextResponse.json({ ok: true, modus: body.data.modus }, { headers: NO_STORE });
    } catch (e) {
      console.warn(`[MICROSOFT-LOGIN] beheer modus zetten mislukt: ${microsoftLoginFoutcategorie(e)}`);
      return NextResponse.json({ error: "Het loginbeleid kan nu niet worden gewijzigd." }, { status: 503, headers: NO_STORE });
    }
  },
);
