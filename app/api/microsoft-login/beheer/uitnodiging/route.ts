// ============================================================================
//  /api/microsoft-login/beheer/uitnodiging — beperkte koppel-/herstelsessie
//  (fase 1C, #344 PR-B; ontwerp §6.2, besluit 0212 D4).
// ----------------------------------------------------------------------------
//  POST   geeft een opaak token uit voor exact één account. Alleen sha256(token)
//         gaat naar de database; het token zelf verlaat de server PRECIES ÉÉN KEER,
//         in deze respons, en staat daarna nergens: niet in log, audit of URL-pad.
//         De link zet het token in het URL-FRAGMENT (`/koppelen#<token>`), dat de
//         browser niet naar de server stuurt (geen Vercel-/proxylog, referrer of
//         analytics). Eerdere open uitnodigingen van dat account vervallen (DB).
//  DELETE trekt de open uitnodiging van een account in.
//  Het token authenticeert niet: de gebruiker heeft daarnaast zijn wachtwoord nodig.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { microsoftLoginConfig } from "@/core/lib/microsoft-login-config";
import { maakUitnodiging, trekUitnodigingIn } from "@/core/lib/microsoft-login-gateway";
import { HERKOPPEL_GELDIGHEID_SECONDEN } from "@/core/lib/microsoft-login-beleid-core";
import { canoniekeFondsHost, origineVoorHost } from "@/core/lib/microsoft-login-flow-core";
import { bouwUitnodigingsLink, herkoppelTokenHash, maakHerkoppelToken, UITNODIGING_SCHEMA } from "@/core/lib/microsoft-login-beheer-core";
import { microsoftLoginFoutcategorie } from "@/core/lib/microsoft-login-error-core";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;
const GEEN_RECHTEN = { error: "Geen rechten om het loginbeleid te beheren (login.beleid.manage)" } as const;

export const POST = withFondsRoute(
  // rateLimit "geen" (beoordeeld): beheeractie, capability-gated; per account
  // hoogstens één open uitnodiging (de database vervangt de vorige).
  { hostGuard: "afdwingen", rateLimit: "geen", audit: { handeling: "microsoft-login.uitnodiging.uitgeven" }, capability: "login.beleid.manage", schema: UITNODIGING_SCHEMA, label: "microsoft-login.beheer.uitnodiging" },
  async (ctx, req: NextRequest) => {
    if (!(await requireCapability(ctx.gebruikerId, "login.beleid.manage"))) return NextResponse.json(GEEN_RECHTEN, { status: 403, headers: NO_STORE });
    let config;
    try {
      config = microsoftLoginConfig();
    } catch {
      return NextResponse.json({ error: "Microsoft-login is niet beschikbaar voor dit fonds." }, { status: 404, headers: NO_STORE });
    }
    if (!ctx.fondsId) return NextResponse.json({ error: "Microsoft-login is niet beschikbaar voor dit fonds." }, { status: 404, headers: NO_STORE });
    const body = UITNODIGING_SCHEMA.safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400, headers: NO_STORE });
    // De link draagt de CANONIEKE fondshost (de wrapper heeft host↔fonds al afgedwongen).
    const host = canoniekeFondsHost(req.headers.get("host"), { lokaalToegestaan: config.lokaalToegestaan });
    if (!host) return NextResponse.json({ error: "Microsoft-login is niet beschikbaar voor dit fonds." }, { status: 404, headers: NO_STORE });
    try {
      const token = maakHerkoppelToken();
      const categorie = await maakUitnodiging({
        fondsId: ctx.fondsId,
        doelUserId: body.data.doelUserId,
        tokenHash: herkoppelTokenHash(token),
        geldigSeconden: HERKOPPEL_GELDIGHEID_SECONDEN,
        actorId: ctx.gebruikerId,
        correlatieId: ctx.requestId,
      });
      if (categorie) {
        console.warn(`[MICROSOFT-LOGIN] uitnodiging uitgeven geweigerd: ${categorie}`);
        return NextResponse.json({ error: "De uitnodiging kan niet worden uitgegeven.", categorie }, { status: 409, headers: NO_STORE });
      }
      const verlooptOp = new Date(Date.now() + HERKOPPEL_GELDIGHEID_SECONDEN * 1000).toISOString();
      // Eenmalig: dit is het enige moment waarop het token bestaat buiten het geheugen van de client.
      return NextResponse.json(
        { ok: true, link: bouwUitnodigingsLink(origineVoorHost(host, { lokaalToegestaan: config.lokaalToegestaan }), token), verlooptOp },
        { headers: NO_STORE },
      );
    } catch (e) {
      console.warn(`[MICROSOFT-LOGIN] uitnodiging uitgeven mislukt: ${microsoftLoginFoutcategorie(e)}`);
      return NextResponse.json({ error: "De uitnodiging kan nu niet worden uitgegeven." }, { status: 503, headers: NO_STORE });
    }
  },
);

export const DELETE = withFondsRoute(
  // rateLimit "geen" (beoordeeld): beheeractie, capability-gated, DB-gelockt.
  { hostGuard: "afdwingen", rateLimit: "geen", audit: { handeling: "microsoft-login.uitnodiging.intrekken" }, capability: "login.beleid.manage", schema: UITNODIGING_SCHEMA, label: "microsoft-login.beheer.uitnodiging" },
  async (ctx, req: NextRequest) => {
    if (!(await requireCapability(ctx.gebruikerId, "login.beleid.manage"))) return NextResponse.json(GEEN_RECHTEN, { status: 403, headers: NO_STORE });
    if (!ctx.fondsId) return NextResponse.json({ error: "Microsoft-login is niet beschikbaar voor dit fonds." }, { status: 404, headers: NO_STORE });
    const body = UITNODIGING_SCHEMA.safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400, headers: NO_STORE });
    try {
      const categorie = await trekUitnodigingIn({ fondsId: ctx.fondsId, doelUserId: body.data.doelUserId, actorId: ctx.gebruikerId, correlatieId: ctx.requestId });
      if (categorie) {
        console.warn(`[MICROSOFT-LOGIN] uitnodiging intrekken geweigerd: ${categorie}`);
        return NextResponse.json({ error: "Er is geen open uitnodiging voor dit account.", categorie }, { status: 409, headers: NO_STORE });
      }
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    } catch (e) {
      console.warn(`[MICROSOFT-LOGIN] uitnodiging intrekken mislukt: ${microsoftLoginFoutcategorie(e)}`);
      return NextResponse.json({ error: "De uitnodiging kan nu niet worden ingetrokken." }, { status: 503, headers: NO_STORE });
    }
  },
);
