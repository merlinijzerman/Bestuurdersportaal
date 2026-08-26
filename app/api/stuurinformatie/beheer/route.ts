import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute, type FondsContext } from "@/core/lib/route-wrapper";
import { requireCapability } from "@/core/lib/capabilities";
import { weigerAlsModuleUit } from "@/core/lib/module-guard";
import { errorResponse, badRequest } from "@/core/lib/api-errors";
import { haalStuurinfoInvoer } from "@/core/lib/stuurinfo-beheer-bron";
import { z } from "zod";
import {
  schrijfPeriode,
  slaBalansReservesOp,
  schrijfSpreiding,
  slaSolidariteitOp,
  slaOperationeelOp,
  slaPremieOp,
  slaBiometrieOp,
} from "@/core/lib/stuurinfo-beheer";
import {
  valideerBalansInvoer,
  valideerPeriodeInvoer,
  valideerSpreidingInvoer,
  valideerSolidariteitInvoer,
  valideerOperationeelInvoer,
  valideerPremieInvoer,
  valideerBiometrieInvoer,
} from "@/core/lib/stuurinfo-invoer";

// ============================================================
//  /api/stuurinformatie/beheer — beheer-invoerlaag stuurinformatie (T14 + T15).
//
//  GET  : invoerdata van het eigen fonds voor de gekozen periode (ruwe leaves,
//         referentie = voorgaande periode, recente wijzigingshistorie).
//  POST : { type: "periode" }        → nieuwe rapportageperiode in de registry;
//         { type: "balans_reserves" } → atomische save (RPC) van balans +
//         reserves + financieringsgraad, na harde validatie (allowlist 400,
//         balansevenwicht 422);
//         { type: "spreiding" }       → tab 4 (T15): vijf uitkeringsfase-kpi's
//         in één batch-upsert (allowlist 400, voorziening ≤ 0 → 422);
//         { type: "solidariteit" }    → tab 5 (T15): atomische save (RPC) van
//         vulling + uitdeling + bandgrenzen, met HARDE eindstand-consistentie
//         (SOLI_EINDSTAND_ONGELIJK → 422, decisions/0076);
//         { type: "operationeel" }    → tab 6 (T16): atomische save (RPC) van
//         mutatiebronnen + kostendetail + norm/band, met HARDE mutatie-
//         consistentie (OPER_MUTATIE_ONGELIJK → 422, decisions/0077);
//         { type: "premie" }          → tab 7 (T16): atomische save (RPC) van
//         premiecomponenten (€+%) + depot-mutaties + kpi's, met HARDE
//         mutatie-consistentie (COMP_MUTATIE_ONGELIJK → 422); de
//         uitputtingsprognose is seed/upload-only (geen handinvoer);
//         { type: "biometrie" }       → tab 3 (T17): vijf reeks-rijen
//         (langleven + toegekende dekkingen) in één batch-upsert (allowlist
//         400; tekenconventies 422). Afgeleiden (netto langleven, resultaten)
//         en de risicopremies (tab 7 — één bron) bestaan niet in de vorm.
//         Opslaan publiceert direct naar het dashboard (geen vier-ogen —
//         bewust besluit, decisions/0075); elke mutatie wordt door de
//         DB-trigger append-only gelogd.
//
//  Gates op ELKE method: auth → capability stuurinformatie.manage (403) →
//  module-beschikbaarheid (403). fonds_id server-side afgeleid, nooit uit de
//  body; de RLS-rolgate (voorzitter/beheerder, WITH CHECK) dubbelt dit in de DB.
// ============================================================

type Gate =
  | { ok: true; fondsId: string }
  | { ok: false; res: NextResponse };

// HANDWERK (W4): de auth-preambule zat in `fondsVanGebruiker()` en de poorten in
// `gate()`, geen van beide in een handler. De wrapper doet de preambule; `gate()`
// krijgt de context mee en houdt zijn eigen `!fondsId`-tak (§7).
async function gate(ctx: FondsContext): Promise<Gate> {
  if (!ctx.fondsId)
    return { ok: false, res: NextResponse.json({ error: "Geen fonds" }, { status: 400 }) };

  // Autorisatie: schrijf-capability, server-side (naast de RLS-rolgate in de DB).
  const magBeheren = await requireCapability(ctx.gebruikerId, "stuurinformatie.manage");
  if (!magBeheren)
    return { ok: false, res: NextResponse.json({ error: "Onvoldoende rechten" }, { status: 403 }) };

  // Beschikbaarheid: module 'stuurinformatie' moet aanstaan voor dit fonds.
  const fondsId = ctx.fondsId; // server-side afgeleid, nooit uit de body
  const weigering = await weigerAlsModuleUit(fondsId, "stuurinformatie");
  if (weigering) return { ok: false, res: weigering };

  return { ok: true, fondsId };
}

export const GET = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: "geen", capability: "stuurinformatie.manage", schema: "geen-body" }, async (ctx, req: NextRequest) => {
  try {
    const g = await gate(ctx);
    if (!g.ok) return g.res;

    // ?periode= wordt uitsluitend gevalideerd tegen de eigen registry
    // (kiesPeriode: onbekend → nieuwste); nooit een tenant-vector.
    const periodeParam = req.nextUrl.searchParams.get("periode") ?? undefined;
    const data = await haalStuurinfoInvoer(g.fondsId, periodeParam);
    return NextResponse.json(data);
  } catch (e) {
    return errorResponse("stuurinformatie.beheer.GET", e);
  }
});

export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "stuurinformatie.beheer.aanmaken" }, capability: "stuurinformatie.manage", schema: z.object({ "type": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest) => {
  try {
    const g = await gate(ctx);
    if (!g.ok) return g.res;

    const body = (await req.json()) as Record<string, unknown>;

    switch (body.type) {
      case "periode": {
        const check = valideerPeriodeInvoer(body);
        if (!check.ok) return badRequest("stuurinformatie.beheer.POST", check.fout);
        const resultaat = await schrijfPeriode(g.fondsId, check.invoer);
        if (!resultaat.ok) return badRequest("stuurinformatie.beheer.POST", resultaat.fout, 409);
        return NextResponse.json({ ok: true, periode: check.invoer.periode });
      }
      case "balans_reserves": {
        // Harde validatie: exhaustieve key-allowlist (afgeleide velden bestaan
        // niet in de payload-vorm → 400) en balansevenwicht (422). De RPC
        // herhaalt beide checks op DB-niveau (defense-in-depth).
        const check = valideerBalansInvoer(body);
        if (!check.ok) return badRequest("stuurinformatie.beheer.POST", check.fout, check.status);
        const resultaat = await slaBalansReservesOp(check.invoer);
        if (!resultaat.ok)
          return badRequest("stuurinformatie.beheer.POST", resultaat.fout, resultaat.status);
        return NextResponse.json({ ok: true, evenwicht: check.evenwicht });
      }
      case "spreiding": {
        // Tab 4 (T15): allowlist-400 (spreidingsvermogen/FG bestaan niet in de
        // vorm — afgeleid); 422 bij onbruikbare FG-noemer. Eén batch-upsert,
        // fonds_id server-side.
        const check = valideerSpreidingInvoer(body);
        if (!check.ok) return badRequest("stuurinformatie.beheer.POST", check.fout, check.status);
        const resultaat = await schrijfSpreiding(g.fondsId, check.invoer);
        if (!resultaat.ok)
          return badRequest("stuurinformatie.beheer.POST", resultaat.fout, resultaat.status);
        return NextResponse.json({ ok: true });
      }
      case "solidariteit": {
        // Tab 5 (T15): allowlist-400 (netto vulling/begin-/eindstand bestaan
        // niet in de vorm — afgeleid). De RPC herhaalt de checks en dwingt de
        // eindstand-consistentie hard af (SOLI_EINDSTAND_ONGELIJK → 422).
        const check = valideerSolidariteitInvoer(body);
        if (!check.ok) return badRequest("stuurinformatie.beheer.POST", check.fout, check.status);
        const resultaat = await slaSolidariteitOp(check.invoer);
        if (!resultaat.ok)
          return badRequest("stuurinformatie.beheer.POST", resultaat.fout, resultaat.status);
        return NextResponse.json({ ok: true });
      }
      case "operationeel": {
        // Tab 6 (T16): allowlist-400 (totaal mutatie/primo/ultimo bestaan
        // niet in de vorm — afgeleid). De RPC herhaalt de checks en dwingt de
        // mutatie-consistentie hard af (OPER_MUTATIE_ONGELIJK → 422).
        const check = valideerOperationeelInvoer(body);
        if (!check.ok) return badRequest("stuurinformatie.beheer.POST", check.fout, check.status);
        const resultaat = await slaOperationeelOp(check.invoer);
        if (!resultaat.ok)
          return badRequest("stuurinformatie.beheer.POST", resultaat.fout, resultaat.status);
        return NextResponse.json({ ok: true });
      }
      case "biometrie": {
        // Tab 3 (T17): allowlist-400 (netto langleven/resultaten en de
        // risicopremies uit tab 7 bestaan niet in de vorm — afgeleid resp.
        // één bron); tekenconventies 422 (vrijval ≥ 0, toegekend ≤ 0). De
        // doorwerking naar tabs 5/6 wordt door de soli-/oper-RPC's getoetst.
        const check = valideerBiometrieInvoer(body);
        if (!check.ok) return badRequest("stuurinformatie.beheer.POST", check.fout, check.status);
        const resultaat = await slaBiometrieOp(g.fondsId, check.invoer);
        if (!resultaat.ok)
          return badRequest("stuurinformatie.beheer.POST", resultaat.fout, resultaat.status);
        return NextResponse.json({ ok: true });
      }
      case "premie": {
        // Tab 7 (T16): allowlist-400 (totaal premie/totaal mutatie/primo/
        // ultimo bestaan niet in de vorm — afgeleid; de prognose-reeks is
        // seed/upload-only). De RPC dwingt de mutatie-consistentie hard af
        // (COMP_MUTATIE_ONGELIJK → 422).
        const check = valideerPremieInvoer(body);
        if (!check.ok) return badRequest("stuurinformatie.beheer.POST", check.fout, check.status);
        const resultaat = await slaPremieOp(check.invoer);
        if (!resultaat.ok)
          return badRequest("stuurinformatie.beheer.POST", resultaat.fout, resultaat.status);
        return NextResponse.json({ ok: true });
      }
      default:
        return badRequest("stuurinformatie.beheer.POST", "Onbekende of ontbrekende 'type'");
    }
  } catch (e) {
    return errorResponse("stuurinformatie.beheer.POST", e, {
      userMessage: "Opslaan mislukt. Controleer de invoer en probeer het opnieuw.",
    });
  }
});
