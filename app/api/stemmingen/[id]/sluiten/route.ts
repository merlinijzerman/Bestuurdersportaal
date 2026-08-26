import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { notifyUser } from "@/core/lib/notifications";
import { isBureauRol, BUREAU_WEIGERING } from "@/core/lib/bureau-gate";
import { weigerAlsModuleUit } from "@/core/lib/module-guard";
import {
  berekenUitslag,
  uitslagSamenvatting,
  type Alternatief,
  type StemRij,
  type VereisteMeerderheid,
} from "@/core/lib/stemming";

// ============================================================
//  POST /api/stemmingen/[id]/sluiten — sluit een open stemronde.
//
//  Rechten: starter (geopend_door) / voorzitter / beheerder.
//  Berekent de uitslag, bevriest die in stemmingen.uitslag, en — als het
//  agendapunt aan een procedure-stap hangt — schrijft een stemverslag-
//  bewijs in procedure_bewijs met expliciete stemming_id-FK.
//  Notificeert starter + tegen-stemmers.
// ============================================================
export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "stemmingen.id.sluiten.post" }, capability: "stemming.deelname", schema: "geen-body" }, async (ctx, _req: NextRequest, params) => {
  try {
    const { id: stemmingId } = params as { id: string };
    const supabase = ctx.supabase;

    // VEN-2 — BESCHIKBAARHEIDSGATE (nadrukkelijk GÉÉN autorisatie). De module
    // 'stemmingen' staat registry-breed uit (defaultActief=false,
    // manifestBeheerbaar=false), dus deze route weigert voor elk fonds met 403.
    // Bewust hier, als eerste stap ná de auth-preambule van withFondsRoute en
    // VÓÓR body-validatie en resource-lookups: anders hangt de weigering af van
    // een geldige body of een bestaand record, en levert een directe API-call
    // een 400/404 op in plaats van het bedoelde 403.
    // `ctx.fondsId` is server-side afgeleid uit het eigen profiel — nooit uit de
    // request-body, en nooit uit het aangesproken record.
    const moduleWeigering = await weigerAlsModuleUit(ctx.fondsId, "stemmingen");
    if (moduleWeigering) return moduleWeigering;

    const { data: stemming } = await supabase
      .from("stemmingen")
      .select(
        "id, status, alternatieven, vereist_quorum, vereiste_meerderheid, fonds_id, agendapunt_id, decision_id, vraag, geopend_door"
      )
      .eq("id", stemmingId)
      .maybeSingle();
    if (!stemming) {
      return NextResponse.json({ error: "Stemming niet gevonden" }, { status: 404 });
    }
    const st = stemming as {
      id: string;
      status: string;
      alternatieven: Alternatief[];
      vereist_quorum: number | null;
      vereiste_meerderheid: VereisteMeerderheid | null;
      fonds_id: string;
      agendapunt_id: string;
      decision_id: string | null;
      vraag: string;
      geopend_door: string;
    };

    if (st.status !== "open") {
      return NextResponse.json(
        { error: "Deze stemronde is al gesloten of ingetrokken" },
        { status: 400 }
      );
    }

    // Rolcheck
    const rol = ctx.rol;
    // T1 bureau-rol (§5.3): geen stemronde sluiten. Vóór de starter-tak, om
    // dezelfde reden als bij het openen (zie /api/stemmingen POST).
    if (isBureauRol(rol)) {
      return NextResponse.json({ error: BUREAU_WEIGERING.stemronde }, { status: 403 });
    }
    const isPrivileged = rol === "voorzitter" || rol === "beheerder";
    if (st.geopend_door !== ctx.gebruikerId && !isPrivileged) {
      return NextResponse.json(
        { error: "Alleen de starter, voorzitter of beheerder mag de stemronde sluiten" },
        { status: 403 }
      );
    }

    // Stemmen ophalen
    const { data: stemmenRaw } = await supabase
      .from("stem_uitbrengingen")
      .select(
        "stemgerechtigde_id, uitgebracht_door, keuze, motivering, is_volmacht, volmacht_toelichting"
      )
      .eq("stemming_id", stemmingId);
    const stemmenRows = (stemmenRaw || []) as {
      stemgerechtigde_id: string;
      uitgebracht_door: string;
      keuze: string;
      motivering: string | null;
      is_volmacht: boolean;
      volmacht_toelichting: string | null;
    }[];

    // Namen ophalen voor alle betrokken gebruikers
    const userIds = new Set<string>();
    for (const r of stemmenRows) {
      userIds.add(r.stemgerechtigde_id);
      userIds.add(r.uitgebracht_door);
    }
    const naamMap = new Map<string, string | null>();
    if (userIds.size > 0) {
      const { data: profielen } = await supabase
        .from("profielen")
        .select("id, naam")
        .in("id", Array.from(userIds));
      for (const p of (profielen || []) as { id: string; naam: string | null }[]) {
        naamMap.set(p.id, p.naam);
      }
    }

    const stemmen: StemRij[] = stemmenRows.map((r) => ({
      stemgerechtigde_id: r.stemgerechtigde_id,
      stemgerechtigde_naam: naamMap.get(r.stemgerechtigde_id) ?? null,
      uitgebracht_door: r.uitgebracht_door,
      uitgebracht_door_naam: naamMap.get(r.uitgebracht_door) ?? null,
      keuze: r.keuze,
      motivering: r.motivering,
      is_volmacht: r.is_volmacht,
      volmacht_toelichting: r.volmacht_toelichting,
    }));

    // Totaal stemgerechtigde bestuursleden van het fonds
    const { count: totaalBestuursleden } = await supabase
      .from("profielen")
      .select("id", { count: "exact", head: true })
      .eq("fonds_id", st.fonds_id)
      .in("rol", ["bestuurder", "voorzitter"]);

    const uitslag = berekenUitslag(
      st.alternatieven,
      stemmen,
      totaalBestuursleden ?? 0,
      st.vereist_quorum,
      st.vereiste_meerderheid
    );

    // Stemming sluiten
    const { data: gesloten, error: updFout } = await supabase
      .from("stemmingen")
      .update({
        status: "gesloten",
        gesloten_op: new Date().toISOString(),
        gesloten_door: ctx.gebruikerId,
        uitslag,
      })
      .eq("id", stemmingId)
      .select()
      .single();
    if (updFout) {
      console.error("Stemming sluiten fout:", updFout);
      return NextResponse.json({ error: "Sluiten mislukt" }, { status: 500 });
    }

    // Stemverslag-bewijs schrijven als er een procedure-stap-koppeling is
    const { data: agendapunt } = await supabase
      .from("agendapunten")
      .select("procedure_stap_id, vergadering_id")
      .eq("id", st.agendapunt_id)
      .maybeSingle();
    const stapId = (agendapunt as { procedure_stap_id?: string | null } | null)
      ?.procedure_stap_id;
    const vergaderingId = (agendapunt as { vergadering_id?: string } | null)
      ?.vergadering_id ?? "";

    if (stapId) {
      const samenvatting = uitslagSamenvatting(uitslag, st.alternatieven);
      const winnaarLabel = uitslag.winnend_alternatief
        ? st.alternatieven.find((a) => a.code === uitslag.winnend_alternatief)?.label ??
          uitslag.winnend_alternatief
        : "geen eenduidige uitslag";
      await supabase.from("procedure_bewijs").insert({
        stap_id: stapId,
        stemming_id: stemmingId,
        titel: `Stemverslag — ${st.vraag.slice(0, 160)}`,
        beschrijving: `Uitslag: ${winnaarLabel} (${samenvatting}). Quorum: ${uitslag.quorum_status}, meerderheid: ${uitslag.meerderheid_status}.`,
        toegevoegd_door: ctx.gebruikerId,
      });
    }

    // Notificatie: starter + tegen-stemmers
    const samenvatting = uitslagSamenvatting(uitslag, st.alternatieven);
    const ontvangers = new Set<string>();
    ontvangers.add(st.geopend_door);
    for (const r of stemmenRows) {
      if (r.keuze === "tegen") ontvangers.add(r.stemgerechtigde_id);
    }
    await Promise.all(
      Array.from(ontvangers).map((ontvangerId) =>
        notifyUser(
          supabase,
          "stemronde_gesloten",
          ontvangerId,
          st.fonds_id,
          {
            type: "stemronde_gesloten",
            agendapunt_titel: st.vraag.slice(0, 120),
            winnend_alternatief: uitslag.winnend_alternatief,
            uitslag_samenvatting: samenvatting,
            quorum_status: uitslag.quorum_status,
            meerderheid_status: uitslag.meerderheid_status,
            vergadering_id: vergaderingId,
          },
          {
            gerelateerd_aan_type: "agendapunt",
            gerelateerd_aan_id: st.agendapunt_id,
            actor_id: ctx.gebruikerId,
          }
        )
      )
    );

    return NextResponse.json({ stemming: gesloten, uitslag });
  } catch (e) {
    console.error("Fout in POST /api/stemmingen/[id]/sluiten:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
