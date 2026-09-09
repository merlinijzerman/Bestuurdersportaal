// ============================================================================
//  /api/microsoft-login/koppeling — status (GET), ontkoppelen (DELETE) en herstel
//  (POST) van de Microsoft-login-koppeling van het EIGEN account (fase 1B, #335 T2;
//  ontwerp §3.8). Strikt zelfbeheer: profile.view.own / profile.manage.own.
// ----------------------------------------------------------------------------
//  De statusrespons draagt nooit tid/oid/sub of e-mail — alleen de toestand,
//  tijdstippen en of de HUIDIGE sessie via Microsoft is ingelogd (zodat de kaart
//  vooraf kan zeggen wat ontkoppelen betekent). Ontkoppelen is deterministisch
//  (reviewbevinding PR #339): is de huidige sessie een oauth-sessie, dan wordt zij
//  na `revoked` server-side beëindigd en meldt de respons `uitgelogd: true`; de
//  kaart stuurt dan naar /login. Een wachtwoordsessie blijft (`uitgelogd: false`).
//  Mislukt de unlink, dan blijft de binding revoking (hook weigert) en biedt de
//  kaart "Opnieuw proberen". Herstel is idempotent (pending + azure → active).
//
//  Fase 1C (#344): de respons draagt de fondsmodus en de kaartstand, zodat de UI
//  per modus de juiste actie toont. In modus `verplicht` weigert DELETE hier én in
//  de database (login_private.start_intrekking) — de UI omzeilen helpt niet. De
//  uitzondering is een geopende koppel-/herstelsessie: daarbinnen MOET de oude
//  identiteit juist los kunnen.
// ============================================================================
import { NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { microsoftLoginGeconfigureerd } from "@/core/lib/microsoft-login-config";
import { microsoftLoginActief, microsoftLoginVoorRequest } from "@/core/lib/microsoft-login";
import { microsoftLoginFoutcategorie, PROFIEL_MICROSOFT_LOGIN_MELDINGEN } from "@/core/lib/microsoft-login-error-core";
import { beeindigSessie, huidigAccessToken } from "@/core/lib/microsoft-login-sessieguard";
import { sessieIsOAuth } from "@/core/lib/microsoft-login-sessieguard-core";
import { sessiebeleid } from "@/core/lib/microsoft-login-gateway";
import { magZelfKoppelen, magZelfOntkoppelen, profielkaartStand, type Sessiebeleid } from "@/core/lib/microsoft-login-beleid-core";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

async function beschikbaar(fondsId: string | null): Promise<boolean> {
  if (!fondsId || !microsoftLoginGeconfigureerd()) return false;
  const actief = await microsoftLoginActief(fondsId).catch(() => ({ actief: false as const }));
  return actief.actief;
}

/** Het beleid van dit account, of null als het niet te bepalen is (fail-closed
 *  voor de persoonlijke acties: zonder beleid geen ontkoppeling). */
async function beleidVoor(gebruikerId: string): Promise<Sessiebeleid | null> {
  return await sessiebeleid(gebruikerId).catch(() => null);
}

export const GET = withFondsRoute(
  { hostGuard: "afdwingen", rateLimit: "geen", audit: "geen", capability: "profile.view.own", schema: "geen-body" },
  async (ctx) => {
    if (!(await beschikbaar(ctx.fondsId))) return NextResponse.json({ beschikbaar: false }, { headers: NO_STORE });
    try {
      const flow = await microsoftLoginVoorRequest();
      const status = await flow.status({ userId: ctx.gebruikerId });
      const sessieViaMicrosoft = sessieIsOAuth(await huidigAccessToken(ctx.supabase));
      const beleid = await beleidVoor(ctx.gebruikerId);
      const modus = beleid?.modus ?? "optioneel";
      const linkOnly = beleid?.linkOnly === true;
      return NextResponse.json(
        {
          beschikbaar: true,
          sessieViaMicrosoft,
          modus,
          stand: profielkaartStand(modus, linkOnly),
          magKoppelen: magZelfKoppelen(modus, linkOnly),
          magOntkoppelen: magZelfOntkoppelen(modus, linkOnly),
          ...status,
        },
        { headers: NO_STORE },
      );
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
      // Modus `verplicht`: de lifecycle ligt bij het fondsbeheer. De weigering komt
      // BEWUST uit de database (login_private.start_intrekking) en niet uit een
      // vroege poort hier: die functie schrijft namelijk ook de auditregel
      // `ontkoppelen.geweigerd`. Een 403 vóór de gatewayaanroep zou de weigering
      // stil laten verdwijnen — precies wat de Preview-smoke van scenario 5 aan
      // het licht bracht. De app beslist hier dus niets; zij vertaalt alleen.
      // Vóór de intrekking bepalen: is DEZE sessie via Microsoft ingelogd?
      const viaMicrosoft = sessieIsOAuth(await huidigAccessToken(ctx.supabase));
      const flow = await microsoftLoginVoorRequest();
      await flow.ontkoppel({ fondsId: ctx.fondsId!, userId: ctx.gebruikerId });
      if (viaMicrosoft) {
        // Deterministisch: de oauth-sessie hoort niet voort te leven zonder binding.
        await beeindigSessie(ctx.supabase);
        return NextResponse.json({ ok: true, uitgelogd: true }, { headers: NO_STORE });
      }
      return NextResponse.json({ ok: true, uitgelogd: false }, { headers: NO_STORE });
    } catch (e) {
      const categorie = microsoftLoginFoutcategorie(e);
      console.warn(`[MICROSOFT-LOGIN] ontkoppelen mislukt: ${categorie}`);
      if (categorie === "onbekende_binding") return NextResponse.json({ error: "Er is geen Microsoft-koppeling." }, { status: 404, headers: NO_STORE });
      // Backstop: de database weigerde de intrekking op grond van het beleid.
      if (categorie === "ontkoppelen_verplicht") return NextResponse.json({ error: PROFIEL_MICROSOFT_LOGIN_MELDINGEN.beheer }, { status: 403, headers: NO_STORE });
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
