import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { notifyUser } from "@/lib/notifications";
import type { Alternatief } from "@/lib/stemming";

// ============================================================
//  POST /api/stemmingen/[id]/stemmen — breng een stem uit of wijzig 'm.
//
//  Body:
//    keuze: string                 (verplicht, moet matchen met alternatief)
//    motivering?: string
//    stemgerechtigde_id?: string   (alleen bij volmacht — namens wie)
//    volmacht_toelichting?: string
//
//  Volmacht-regels (server-side, bovenop DB-constraint):
//    • stemgerechtigde_id ≠ auth.uid()  → volmacht; volmacht_bevestigd=true vereist
//    • je mag geen volmacht aan jezelf geven
//    • de stemgerechtigde moet bestuurder/voorzitter van het fonds zijn
//    • één stem per stemgerechtigde (unique); een tweede insert botst
//    • eigen stem geweigerd als er al een volmachtstem voor jou bestaat
//
//  Wijzigen kan alleen vóór sluiting en alleen door de uitbrenger zelf.
// ============================================================
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: stemmingId } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as {
      keuze?: string;
      motivering?: string | null;
      stemgerechtigde_id?: string | null;
      volmacht_bevestigd?: boolean;
      volmacht_toelichting?: string | null;
    };

    if (!body.keuze) {
      return NextResponse.json({ error: "keuze is verplicht" }, { status: 400 });
    }

    // Stemming + status + alternatieven + fonds + agendapunt ophalen
    const { data: stemming } = await supabase
      .from("stemmingen")
      .select("id, status, alternatieven, fonds_id, agendapunt_id, vraag")
      .eq("id", stemmingId)
      .maybeSingle();
    if (!stemming) {
      return NextResponse.json({ error: "Stemming niet gevonden" }, { status: 404 });
    }
    const st = stemming as {
      id: string;
      status: string;
      alternatieven: Alternatief[];
      fonds_id: string;
      agendapunt_id: string;
      vraag: string;
    };
    if (st.status !== "open") {
      return NextResponse.json(
        { error: "Deze stemronde is gesloten of ingetrokken" },
        { status: 400 }
      );
    }

    // Keuze valideren tegen alternatieven
    const geldigeCodes = new Set((st.alternatieven ?? []).map((a) => a.code));
    if (!geldigeCodes.has(body.keuze)) {
      return NextResponse.json(
        { error: "Ongeldige keuze voor deze stemming" },
        { status: 400 }
      );
    }

    const stemgerechtigdeId = body.stemgerechtigde_id || user.id;
    const isVolmacht = stemgerechtigdeId !== user.id;

    // ── Volmacht-validatie ──
    if (isVolmacht) {
      if (body.volmacht_bevestigd !== true) {
        return NextResponse.json(
          {
            error:
              "Bevestig dat u gemachtigd bent om namens deze persoon te stemmen",
          },
          { status: 400 }
        );
      }
      // Stemgerechtigde moet bestuurder/voorzitter van hetzelfde fonds zijn
      const { data: stemgerProfiel } = await supabase
        .from("profielen")
        .select("id, rol, fonds_id")
        .eq("id", stemgerechtigdeId)
        .maybeSingle();
      const sp = stemgerProfiel as
        | { rol: string; fonds_id: string }
        | null;
      if (
        !sp ||
        sp.fonds_id !== st.fonds_id ||
        !["bestuurder", "voorzitter"].includes(sp.rol)
      ) {
        return NextResponse.json(
          { error: "Volmachtgever is geen stemgerechtigd bestuurslid van dit fonds" },
          { status: 400 }
        );
      }
    }

    // Bestaande rij voor deze stemgerechtigde?
    const { data: bestaand } = await supabase
      .from("stem_uitbrengingen")
      .select("id, uitgebracht_door")
      .eq("stemming_id", stemmingId)
      .eq("stemgerechtigde_id", stemgerechtigdeId)
      .maybeSingle();

    if (bestaand) {
      const b = bestaand as { id: string; uitgebracht_door: string };
      // Alleen de uitbrenger zelf mag wijzigen
      if (b.uitgebracht_door !== user.id) {
        if (!isVolmacht) {
          // Eigen stem geweigerd: er bestaat al een volmachtstem voor mij
          return NextResponse.json(
            {
              error:
                "Er is al een volmachtstem namens u uitgebracht. Vraag deze persoon de stem in te trekken, of de starter de stemming opnieuw te openen, voordat u zelf stemt.",
            },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: "Deze stem is door iemand anders uitgebracht en kan alleen door diegene worden gewijzigd" },
          { status: 403 }
        );
      }
      // Update (wijzigen vóór sluiting)
      const { data: gewijzigd, error: updFout } = await supabase
        .from("stem_uitbrengingen")
        .update({
          keuze: body.keuze,
          motivering: body.motivering ?? null,
          volmacht_toelichting: isVolmacht ? body.volmacht_toelichting ?? null : null,
          uitgebracht_op: new Date().toISOString(),
        })
        .eq("id", b.id)
        .select()
        .single();
      if (updFout) {
        console.error("Stem wijzigen fout:", updFout);
        return NextResponse.json({ error: "Stem wijzigen mislukt" }, { status: 500 });
      }
      return NextResponse.json({ stem: gewijzigd, gewijzigd: true });
    }

    // Nieuwe stem insert
    const { data: nieuw, error: insFout } = await supabase
      .from("stem_uitbrengingen")
      .insert({
        stemming_id: stemmingId,
        uitgebracht_door: user.id,
        stemgerechtigde_id: stemgerechtigdeId,
        keuze: body.keuze,
        motivering: body.motivering ?? null,
        volmacht_bevestigd: isVolmacht,
        volmacht_toelichting: isVolmacht ? body.volmacht_toelichting ?? null : null,
      })
      .select()
      .single();

    if (insFout) {
      if ((insFout as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "Er is al een stem uitgebracht voor deze stemgerechtigde" },
          { status: 409 }
        );
      }
      console.error("Stem uitbrengen fout:", insFout);
      return NextResponse.json({ error: "Stem uitbrengen mislukt" }, { status: 500 });
    }

    // Bij volmacht: notificatie naar de volmachtgever
    if (isVolmacht) {
      const { data: agendapunt } = await supabase
        .from("agendapunten")
        .select("vergadering_id")
        .eq("id", st.agendapunt_id)
        .maybeSingle();
      const vergaderingId =
        (agendapunt as { vergadering_id?: string } | null)?.vergadering_id ?? "";
      const { data: actorProfiel } = await supabase
        .from("profielen")
        .select("naam")
        .eq("id", user.id)
        .maybeSingle();
      const actorNaam = (actorProfiel as { naam?: string | null } | null)?.naam ?? "Een collega";
      const keuzeLabel =
        st.alternatieven.find((a) => a.code === body.keuze)?.label ?? body.keuze;

      await notifyUser(
        supabase,
        "volmachtstem_uitgebracht",
        stemgerechtigdeId,
        st.fonds_id,
        {
          type: "volmachtstem_uitgebracht",
          agendapunt_titel: st.vraag.slice(0, 120),
          vraag: st.vraag,
          uitgebracht_door_naam: actorNaam,
          keuze: keuzeLabel,
          volmacht_toelichting: body.volmacht_toelichting ?? null,
          vergadering_id: vergaderingId,
        },
        {
          gerelateerd_aan_type: "agendapunt",
          gerelateerd_aan_id: st.agendapunt_id,
          actor_naam: actorNaam,
          actor_id: user.id,
        }
      );
    }

    return NextResponse.json({ stem: nieuw, gewijzigd: false });
  } catch (e) {
    console.error("Fout in POST /api/stemmingen/[id]/stemmen:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
