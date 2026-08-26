import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { notifyUser } from "@/core/lib/notifications";
import { isBureauRol, BUREAU_WEIGERING } from "@/core/lib/bureau-gate";
import { z } from "zod";

export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "inbreng.post" }, capability: "inbreng.manage", schema: z.object({ "agendapunt_id": z.unknown().optional(), "tekst": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest) => {
  try {
    const supabase = ctx.supabase;

    const body = (await req.json()) as {
      agendapunt_id?: string;
      tekst?: string;
    };
    const { agendapunt_id, tekst } = body;

    if (!agendapunt_id || !tekst || tekst.trim().length === 0) {
      return NextResponse.json(
        { error: "agendapunt_id en tekst zijn verplicht" },
        { status: 400 }
      );
    }

    // T1 bureau-rol (§5.3): geen inbreng. De harde weigering staat in de
    // RLS-policy "eigen inbreng schrijven"; deze check levert een leesbare
    // melding in plaats van een kale insert-fout.
    if (isBureauRol(ctx.rol)) {
      return NextResponse.json({ error: BUREAU_WEIGERING.inbreng }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("agendapunt_inbreng")
      .insert({
        agendapunt_id,
        gebruiker_id: ctx.gebruikerId,
        gebruiker_naam: ctx.naam || ctx.email,
        tekst: tekst.trim(),
      })
      .select()
      .single();

    if (error) {
      console.error("Inbreng toevoegen fout:", error);
      return NextResponse.json({ error: "Inbreng toevoegen mislukt" }, { status: 500 });
    }

    // ── Iteratie 3-A: notificatie naar de vergadering-organisator ──
    // Bewust niet aan álle bestuursleden geüpdaten — dat zou de homepage
    // overspoelen bij een drukke vergadering. De organisator is degene
    // die zicht houdt op de voorbereiding van de vergadering en
    // baat heeft bij signaal "iemand heeft input geleverd".
    if (ctx.fondsId) {
      const { data: agendapunt } = await supabase
        .from("agendapunten")
        .select("titel, vergadering_id, vergaderingen(aangemaakt_door)")
        .eq("id", agendapunt_id)
        .maybeSingle();

      const vergRel = agendapunt?.vergaderingen as
        | { aangemaakt_door: string | null }
        | { aangemaakt_door: string | null }[]
        | null
        | undefined;
      const vergObj = Array.isArray(vergRel) ? vergRel[0] : vergRel;
      const organisatorId = vergObj?.aangemaakt_door ?? null;

      if (organisatorId && agendapunt?.titel && agendapunt.vergadering_id) {
        await notifyUser(
          supabase,
          "inbreng_geplaatst",
          organisatorId,
          ctx.fondsId,
          {
            type: "inbreng_geplaatst",
            agendapunt_titel: agendapunt.titel,
            actor_naam: ctx.naam || ctx.email || "Een collega",
            vergadering_id: agendapunt.vergadering_id,
          },
          {
            gerelateerd_aan_type: "agendapunt",
            gerelateerd_aan_id: agendapunt_id,
            // BESLUIT (W4): `|| null` -> `|| undefined`. Zonder gegenereerde
            // Supabase-types was `profiel.naam` hier `any`, dus compileerde
            // `|| null`; `ctx.naam` is `string | null` en dat botst met
            // `NotifyOpts.actor_naam?: string`. Waarde-identiek: notifyUser doet
            // `opts.actor_naam ?? null` (core/lib/notifications.ts:149), dus
            // null en undefined komen allebei als null in de kolom. En `||`
            // blijft `||`, zodat een lege naam net als voorheen wegvalt.
            actor_naam: ctx.naam || undefined,
          }
        );
      }
    }

    return NextResponse.json({ inbreng: data });
  } catch (e) {
    console.error("Fout in /api/inbreng:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
