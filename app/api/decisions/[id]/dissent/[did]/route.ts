// PATCH + DELETE /api/decisions/[id]/dissent/[did]
//
// Bewerken of intrekken van een dissent-notitie.
//
// Autorisatie (defense in depth bovenop RLS):
//   • Auteur kan altijd: standpunt/argument/zichtbaarheid wijzigen
//     binnen 'prive', 'gedeelde_zorg', 'formele_dissent'.
//   • Voorzitter/beheerder kan: bovenstaande + opwaarderen naar
//     'minderheidsnotitie' + zetten van `formeel_vastgesteld`.
//   • Auteur kan eigen dissent intrekken (DELETE). Voorzitter/beheerder
//     kan ook formeel vastgestelde dissent intrekken — met reden in
//     governance_event.
//
// Events:
//   • dissent_gewijzigd          — inhoudelijke wijziging
//   • dissent_zichtbaarheid_gewijzigd — verandering in zichtbaarheid
//   • dissent_formeel_vastgesteld — opwaarderen door voorzitter/beheerder
//   • dissent_ingetrokken         — DELETE (hard delete; logregel blijft)

import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { notifyUser } from "@/core/lib/notifications";
import { isBureauRol, BUREAU_WEIGERING } from "@/core/lib/bureau-gate";
import { z } from "zod";

const ZICHTBAARHEID = [
  "prive",
  "gedeelde_zorg",
  "formele_dissent",
  "minderheidsnotitie",
] as const;

type WijzigBody = Partial<{
  standpunt: string;
  argument: string | null;
  zichtbaarheid: (typeof ZICHTBAARHEID)[number];
  formeel_vastgesteld: boolean;
  gekoppeld_risico_id: string | null;
  gekoppeld_aanname_id: string | null;
  gekoppeld_voorwaarde_id: string | null;
}>;

const INHOUDELIJKE_VELDEN: (keyof WijzigBody)[] = [
  "standpunt",
  "argument",
  "gekoppeld_risico_id",
  "gekoppeld_aanname_id",
  "gekoppeld_voorwaarde_id",
];

export const PATCH = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "decisions.dissent.wijzigen" }, capability: "decisions.manage", schema: z.object({ "formeel_vastgesteld": z.unknown().optional(), "zichtbaarheid": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id: decisionId, did } = params as { id: string; did: string };
    const supabase = ctx.supabase;

    const body = (await req.json()) as WijzigBody;

    if (body.zichtbaarheid && !ZICHTBAARHEID.includes(body.zichtbaarheid)) {
      return NextResponse.json(
        { error: `Ongeldige zichtbaarheid: ${body.zichtbaarheid}` },
        { status: 400 }
      );
    }

    const { data: huidig, error: leesFout } = await supabase
      .from("decision_dissent")
      .select("*")
      .eq("id", did)
      .eq("decision_id", decisionId)
      .maybeSingle();
    if (leesFout || !huidig) {
      return NextResponse.json(
        { error: "Dissent-notitie niet gevonden of geen toegang" },
        { status: 404 }
      );
    }

    const isAuteur = huidig.bestuurder_id === ctx.gebruikerId;
    const isPrivileged =
      ctx.rol === "voorzitter" || ctx.rol === "beheerder";

    // T1 bureau-rol (§5.3): geen dissent vastleggen of wijzigen. Het bureau kan
    // geen auteur zijn (de POST is geweigerd), maar een rolwijziging achteraf zou
    // de auteur-tak anders alsnog openen.
    if (isBureauRol(ctx.rol)) {
      return NextResponse.json({ error: BUREAU_WEIGERING.dissent }, { status: 403 });
    }

    if (!isAuteur && !isPrivileged) {
      return NextResponse.json(
        { error: "Alleen de auteur of voorzitter/beheerder mag wijzigen." },
        { status: 403 }
      );
    }

    // Opwaardering naar 'minderheidsnotitie' of zetten van formeel
    // vastgesteld is voorbehouden aan voorzitter/beheerder.
    if (
      body.zichtbaarheid === "minderheidsnotitie" &&
      huidig.zichtbaarheid !== "minderheidsnotitie" &&
      !isPrivileged
    ) {
      return NextResponse.json(
        {
          error:
            "Opwaardering naar minderheidsnotitie is voorbehouden aan voorzitter/beheerder.",
        },
        { status: 403 }
      );
    }
    if (
      body.formeel_vastgesteld === true &&
      huidig.formeel_vastgesteld !== true &&
      !isPrivileged
    ) {
      return NextResponse.json(
        {
          error:
            "Formele vaststelling is voorbehouden aan voorzitter/beheerder.",
        },
        { status: 403 }
      );
    }

    const wijzigingen: Record<string, unknown> = {};
    const oudeWaarden: Record<string, unknown> = {};
    const nieuweWaarden: Record<string, unknown> = {};
    const inhoudelijkGewijzigd: string[] = [];
    let zichtbaarheidGewijzigd = false;
    let formeelOpgewaardeerd = false;

    for (const veld of INHOUDELIJKE_VELDEN) {
      if (body[veld] === undefined) continue;
      const nieuw =
        veld === "standpunt" || veld === "argument"
          ? typeof body[veld] === "string"
            ? (body[veld] as string).trim() || (veld === "standpunt" ? null : null)
            : body[veld]
          : body[veld];
      const oud = (huidig as Record<string, unknown>)[veld];
      if (nieuw === oud) continue;
      if (veld === "standpunt" && (!nieuw || typeof nieuw !== "string")) {
        return NextResponse.json(
          { error: "Standpunt mag niet leeg zijn" },
          { status: 400 }
        );
      }
      wijzigingen[veld] = nieuw;
      oudeWaarden[veld] = oud;
      nieuweWaarden[veld] = nieuw;
      inhoudelijkGewijzigd.push(veld);
    }

    if (
      body.zichtbaarheid !== undefined &&
      body.zichtbaarheid !== huidig.zichtbaarheid
    ) {
      wijzigingen.zichtbaarheid = body.zichtbaarheid;
      oudeWaarden.zichtbaarheid = huidig.zichtbaarheid;
      nieuweWaarden.zichtbaarheid = body.zichtbaarheid;
      zichtbaarheidGewijzigd = true;
    }

    if (
      body.formeel_vastgesteld !== undefined &&
      body.formeel_vastgesteld !== huidig.formeel_vastgesteld
    ) {
      wijzigingen.formeel_vastgesteld = body.formeel_vastgesteld;
      oudeWaarden.formeel_vastgesteld = huidig.formeel_vastgesteld;
      nieuweWaarden.formeel_vastgesteld = body.formeel_vastgesteld;
      if (body.formeel_vastgesteld === true) {
        formeelOpgewaardeerd = true;
      }
    }

    if (Object.keys(wijzigingen).length === 0) {
      return NextResponse.json({ dissent: huidig, gewijzigd: false });
    }

    const { data: bijgewerkt, error: updFout } = await supabase
      .from("decision_dissent")
      .update(wijzigingen)
      .eq("id", did)
      .select()
      .single();
    if (updFout || !bijgewerkt) {
      console.error("Dissent wijzigen fout:", updFout);
      return NextResponse.json(
        { error: "Update mislukt" },
        { status: 500 }
      );
    }

    const actorNaam = ctx.naam;

    if (inhoudelijkGewijzigd.length > 0) {
      await supabase.from("governance_events").insert({
        decision_id: decisionId,
        event_type: "dissent_gewijzigd",
        actor_id: ctx.gebruikerId,
        actor_naam: actorNaam,
        object_type: "dissent",
        object_id: did,
        // Inhoudelijke velden bewust niet in payload — privacy.
        nieuwe_waarde: {
          velden: inhoudelijkGewijzigd,
        },
      });
    }
    if (zichtbaarheidGewijzigd) {
      await supabase.from("governance_events").insert({
        decision_id: decisionId,
        event_type: "dissent_zichtbaarheid_gewijzigd",
        actor_id: ctx.gebruikerId,
        actor_naam: actorNaam,
        object_type: "dissent",
        object_id: did,
        oude_waarde: { zichtbaarheid: oudeWaarden.zichtbaarheid },
        nieuwe_waarde: { zichtbaarheid: nieuweWaarden.zichtbaarheid },
      });
    }
    if (formeelOpgewaardeerd) {
      await supabase.from("governance_events").insert({
        decision_id: decisionId,
        event_type: "dissent_formeel_vastgesteld",
        actor_id: ctx.gebruikerId,
        actor_naam: actorNaam,
        object_type: "dissent",
        object_id: did,
        nieuwe_waarde: {
          formeel_vastgesteld: true,
          zichtbaarheid: bijgewerkt.zichtbaarheid,
        },
      });

      // ── Iteratie 3-A: notificatie naar de procedure-starter ──
      // Een formeel-vastgestelde dissent is een zwaarwegend signaal
      // voor de procedure-eigenaar — die moet weten dat een
      // minderheidsstandpunt is geformaliseerd op zijn besluit.
      // (Inhoud van de dissent staat bewust niet in de payload —
      // zichtbaarheid blijft via RLS in tact.)
      const { data: decision } = await supabase
        .from("decision_objects")
        .select("besluit_code, titel, procedure_id, fonds_id")
        .eq("id", decisionId)
        .maybeSingle();
      if (decision?.procedure_id && decision.fonds_id) {
        const { data: proc } = await supabase
          .from("procedures")
          .select("gestart_door")
          .eq("id", decision.procedure_id)
          .maybeSingle();
        if (proc?.gestart_door) {
          await notifyUser(
            supabase,
            "dissent_formeel_vastgelegd",
            proc.gestart_door,
            decision.fonds_id,
            {
              type: "dissent_formeel_vastgelegd",
              besluit_code: decision.besluit_code ?? "",
              besluit_titel: decision.titel ?? "Besluit",
              actor_naam: actorNaam || "Voorzitter/beheerder",
            },
            {
              gerelateerd_aan_type: "decision",
              gerelateerd_aan_id: decisionId,
              // BESLUIT (W4): `|| undefined` i.p.v. de kale waarde. `actorNaam`
              // was via de untypeerde .select() `any` en compileerde daarom tegen
              // `NotifyOpts.actor_naam?: string`; via ctx is het `string | null`.
              // Waarde-identiek: notifyUser doet `opts.actor_naam ?? null`
              // (core/lib/notifications.ts:149), dus null en undefined komen
              // allebei als null in de kolom. Zelfde afweging als in inbreng.
              actor_naam: actorNaam || undefined,
            }
          );
        }
      }
    }

    return NextResponse.json({ dissent: bijgewerkt, gewijzigd: true });
  } catch (e) {
    console.error("Fout in PATCH /api/decisions/[id]/dissent/[did]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});

export const DELETE = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "decisions.dissent.verwijderen" }, capability: "decisions.manage", schema: "geen-body" }, async (ctx, req: NextRequest, params) => {
  try {
    const { id: decisionId, did } = params as { id: string; did: string };
    const supabase = ctx.supabase;

    const { data: huidig } = await supabase
      .from("decision_dissent")
      .select("*")
      .eq("id", did)
      .eq("decision_id", decisionId)
      .maybeSingle();
    if (!huidig) {
      return NextResponse.json(
        { error: "Dissent-notitie niet gevonden" },
        { status: 404 }
      );
    }

    const isAuteur = huidig.bestuurder_id === ctx.gebruikerId;
    const isPrivileged =
      ctx.rol === "voorzitter" || ctx.rol === "beheerder";

    // T1 bureau-rol (§5.3): geen dissent intrekken. Zie de PATCH hierboven.
    if (isBureauRol(ctx.rol)) {
      return NextResponse.json({ error: BUREAU_WEIGERING.dissent }, { status: 403 });
    }

    if (!isAuteur && !isPrivileged) {
      return NextResponse.json(
        { error: "Alleen auteur of voorzitter/beheerder mag intrekken." },
        { status: 403 }
      );
    }

    // Vóór delete: log-event schrijven zodat het audit-spoor blijft.
    // We registreren wie wat introk, met zichtbaarheid + formeel-status,
    // maar NIET de inhoudelijke standpunt-tekst (privacy).
    await supabase.from("governance_events").insert({
      decision_id: decisionId,
      event_type: "dissent_ingetrokken",
      actor_id: ctx.gebruikerId,
      actor_naam: ctx.naam ?? null,
      object_type: "dissent",
      object_id: did,
      oude_waarde: {
        bestuurder_naam: huidig.bestuurder_naam,
        zichtbaarheid: huidig.zichtbaarheid,
        formeel_vastgesteld: huidig.formeel_vastgesteld,
      },
    });

    const { error: delFout } = await supabase
      .from("decision_dissent")
      .delete()
      .eq("id", did);
    if (delFout) {
      console.error("Dissent verwijderen fout:", delFout);
      return NextResponse.json({ error: "Verwijderen mislukt" }, { status: 500 });
    }

    return NextResponse.json({ verwijderd: true });
  } catch (e) {
    console.error("Fout in DELETE /api/decisions/[id]/dissent/[did]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
