// ============================================================================
//  POST /api/microsoft-login/verhoging — opent het activeringsvenster van een
//  break-glasssessie (Microsoft-loginbeleid fase 1C, #344; besluit 0212 D12).
// ----------------------------------------------------------------------------
//  Waarom een aparte route en geen bijwerking van de guard: de Auth-hook geeft de
//  normale rol pas als het venster ER AL IS. Zou het venster als neveneffect van
//  een willekeurig verzoek ontstaan, dan kan een client de app overslaan en
//  rechtstreeks bij GoTrue refreshen — en volledige tokens krijgen zonder venster
//  en zonder auditregel (reviewbevinding P1). Nu is verhogen één expliciete,
//  geaudite handeling die moet slagen vóór er ook maar één volledig token bestaat.
//
//  De aanroeper is per definitie een BEPERKTE sessie (rol portaal_beperkt) die de
//  MFA-stap heeft afgerond; daarom staat deze route op de smalle allowlist van
//  paden die zo'n sessie mag raken. Na een geslaagde opening vernieuwt de client
//  zijn token; de hook geeft dán pas de normale rol.
// ============================================================================
import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftLoginGeconfigureerd } from "@/core/lib/microsoft-login-config";
import { openBreakglassVenster, sessiebeleid } from "@/core/lib/microsoft-login-gateway";
import { microsoftLoginFoutcategorie } from "@/core/lib/microsoft-login-error-core";
import { huidigAccessToken } from "@/core/lib/microsoft-login-sessieguard";
import { aalUitAccessToken, mfaVerificatieUitAccessToken } from "@/core/lib/microsoft-login-sessieguard-core";
import { BREAKGLASS_VENSTER_SECONDEN, magBreakglassVerhogen } from "@/core/lib/microsoft-login-beleid-core";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

export const POST = withFondsRoute(
  // rateLimit "geen" (beoordeeld): één DB-insert per verhoging, alleen mogelijk
  // voor een account met een levende noodtoegangsaanwijzing én een AAL2-sessie.
  { hostGuard: "afdwingen", rateLimit: "geen", audit: { handeling: "microsoft-login.breakglass.verhoging" }, capability: "profile.manage.own", schema: "geen-body" },
  async (ctx) => {
    if (!ctx.fondsId || !microsoftLoginGeconfigureerd()) {
      return NextResponse.json({ error: "Noodtoegang is niet beschikbaar." }, { status: 404, headers: NO_STORE });
    }
    try {
      const token = await huidigAccessToken(ctx.supabase);
      const aal = aalUitAccessToken(token);
      // De verhoging hangt aan ÉÉN MFA-verificatie. Zonder tijdstip is er niets om
      // haar aan te hangen; de database weigert dat ook, dit is de vroege poort.
      const mfaGeverifieerdOp = mfaVerificatieUitAccessToken(token);
      const beleid = await sessiebeleid(ctx.gebruikerId);
      if (!magBreakglassVerhogen({ beleid, aal, mfaGeverifieerdOp })) {
        // Geen aanwijzing, nog geen AAL2, of er loopt al een venster: in alle drie
        // de gevallen valt er niets te openen. Eén neutrale melding.
        return NextResponse.json({ error: "Noodtoegang kan nu niet worden geopend." }, { status: 403, headers: NO_STORE });
      }
      const r = await openBreakglassVenster({
        userId: ctx.gebruikerId,
        mfaGeverifieerdOp: mfaGeverifieerdOp!,
        vensterSeconden: BREAKGLASS_VENSTER_SECONDEN,
        correlatieId: crypto.randomUUID(),
      });
      if ("categorie" in r) {
        // De database is hier de autoriteit: zij weigert een ontbrekende, verlopen
        // of reeds gebruikte MFA-verificatie — ook als deze route zou worden omzeild.
        console.warn(`[MICROSOFT-LOGIN] verhoging geweigerd: ${r.categorie}`);
        return NextResponse.json({ error: "Noodtoegang kan nu niet worden geopend." }, { status: 403, headers: NO_STORE });
      }
      return NextResponse.json({ ok: true, vensterTot: r.vensterTot.toISOString() }, { headers: NO_STORE });
    } catch (e) {
      console.warn(`[MICROSOFT-LOGIN] verhoging mislukt: ${microsoftLoginFoutcategorie(e)}`);
      return NextResponse.json({ error: "Noodtoegang kan nu niet worden geopend." }, { status: 503, headers: NO_STORE });
    }
  },
);
