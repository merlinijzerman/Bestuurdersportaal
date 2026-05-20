import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { notifyByRole } from "@/lib/notifications";
import {
  DEFAULT_ALTERNATIEVEN,
  isAlternatievenArray,
  type Alternatief,
  type VereisteMeerderheid,
} from "@/lib/stemming";

const TOEGESTANE_MEERDERHEDEN: VereisteMeerderheid[] = [
  "gewone",
  "gekwalificeerd_twee_derde",
  "unaniem",
];

// ============================================================
//  POST /api/stemmingen — start een stemronde op een agendapunt.
//
//  Rechten: voorzitter / beheerder / aanmaker van het agendapunt.
//  Voorwaarden:
//    • agendapunt heeft categorie 'besluitvorming'
//    • indien gekoppeld aan een procedure-stap: die stap is niet 'afgerond'
//    • geen openstaande stemming op hetzelfde agendapunt (DB-unique + check)
//
//  decision_id wordt afgeleid via agendapunt → procedure-stap → procedure.
// ============================================================
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json()) as {
      agendapunt_id?: string;
      vraag?: string;
      alternatieven?: unknown;
      vereist_quorum?: number | null;
      vereiste_meerderheid?: string | null;
    };

    if (!body.agendapunt_id || !body.vraag?.trim()) {
      return NextResponse.json(
        { error: "agendapunt_id en vraag zijn verplicht" },
        { status: 400 }
      );
    }

    // Agendapunt + vergadering (fonds) ophalen
    const { data: agendapunt } = await supabase
      .from("agendapunten")
      .select(
        "id, vergadering_id, categorie, procedure_stap_id, aangemaakt_door, verwijderd_op"
      )
      .eq("id", body.agendapunt_id)
      .maybeSingle();

    if (!agendapunt) {
      return NextResponse.json({ error: "Agendapunt niet gevonden" }, { status: 404 });
    }
    const ap = agendapunt as {
      id: string;
      vergadering_id: string;
      categorie: string;
      procedure_stap_id: string | null;
      aangemaakt_door: string | null;
      verwijderd_op: string | null;
    };

    if (ap.verwijderd_op) {
      return NextResponse.json(
        { error: "Agendapunt is verwijderd" },
        { status: 400 }
      );
    }
    if (ap.categorie !== "besluitvorming") {
      return NextResponse.json(
        { error: "Een stemronde kan alleen op een besluitvormings-agendapunt" },
        { status: 400 }
      );
    }

    const { data: verg } = await supabase
      .from("vergaderingen")
      .select("fonds_id")
      .eq("id", ap.vergadering_id)
      .maybeSingle();
    if (!verg) {
      return NextResponse.json({ error: "Vergadering niet gevonden" }, { status: 404 });
    }
    const fondsId = (verg as { fonds_id: string }).fonds_id;

    // Rolcheck: voorzitter/beheerder/aanmaker
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, rol")
      .eq("id", user.id)
      .maybeSingle();
    const rol = (profiel as { rol?: string } | null)?.rol;
    const isPrivileged = rol === "voorzitter" || rol === "beheerder";
    const isAanmaker = ap.aangemaakt_door === user.id;
    if (!isPrivileged && !isAanmaker) {
      return NextResponse.json(
        {
          error:
            "Alleen voorzitter, beheerder of de aanmaker van het agendapunt mag een stemronde starten",
        },
        { status: 403 }
      );
    }

    // decision_id afleiden via procedure-stap → procedure, plus guard op afgeronde stap
    let decisionId: string | null = null;
    if (ap.procedure_stap_id) {
      const { data: stap } = await supabase
        .from("procedure_stappen")
        .select("id, status, procedure_id")
        .eq("id", ap.procedure_stap_id)
        .maybeSingle();
      if (stap) {
        const s = stap as { status: string; procedure_id: string };
        if (s.status === "afgerond") {
          return NextResponse.json(
            {
              error:
                "De gekoppelde procedure-stap is afgerond; er kan geen nieuwe stemronde op worden gestart",
            },
            { status: 400 }
          );
        }
        const { data: proc } = await supabase
          .from("procedures")
          .select("decision_id")
          .eq("id", s.procedure_id)
          .maybeSingle();
        decisionId = (proc as { decision_id: string | null } | null)?.decision_id ?? null;
      }
    }

    // Alternatieven valideren (default als niet/ongeldig meegegeven)
    let alternatieven: Alternatief[] = DEFAULT_ALTERNATIEVEN;
    if (body.alternatieven !== undefined && body.alternatieven !== null) {
      if (!isAlternatievenArray(body.alternatieven)) {
        return NextResponse.json(
          {
            error:
              "Ongeldige alternatieven — minimaal 2 items met unieke code + label",
          },
          { status: 400 }
        );
      }
      alternatieven = body.alternatieven;
    }

    // Meerderheid valideren
    let meerderheid: VereisteMeerderheid | null = null;
    if (body.vereiste_meerderheid) {
      if (!TOEGESTANE_MEERDERHEDEN.includes(body.vereiste_meerderheid as VereisteMeerderheid)) {
        return NextResponse.json(
          { error: "Ongeldige meerderheidseis" },
          { status: 400 }
        );
      }
      meerderheid = body.vereiste_meerderheid as VereisteMeerderheid;
    }

    let quorum: number | null = null;
    if (body.vereist_quorum !== undefined && body.vereist_quorum !== null) {
      const q = Number(body.vereist_quorum);
      if (!Number.isInteger(q) || q < 1) {
        return NextResponse.json(
          { error: "Quorum moet een positief geheel getal zijn" },
          { status: 400 }
        );
      }
      quorum = q;
    }

    // Insert — DB-unique index voorkomt een tweede open stemming
    const { data: stemming, error: insertFout } = await supabase
      .from("stemmingen")
      .insert({
        fonds_id: fondsId,
        agendapunt_id: ap.id,
        decision_id: decisionId,
        vraag: body.vraag.trim(),
        alternatieven,
        vereist_quorum: quorum,
        vereiste_meerderheid: meerderheid,
        status: "open",
        geopend_door: user.id,
      })
      .select()
      .single();

    if (insertFout) {
      // 23505 = unique_violation (er staat al een open stemming)
      if ((insertFout as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "Er staat al een open stemronde op dit agendapunt" },
          { status: 409 }
        );
      }
      console.error("Stemming aanmaken fout:", insertFout);
      return NextResponse.json({ error: "Stemronde starten mislukt" }, { status: 500 });
    }

    // Notificatie naar alle bestuurders + voorzitters van het fonds
    const actorNaam = (profiel as { naam?: string | null } | null)?.naam ?? "Een collega";
    await notifyByRole(
      supabase,
      "stemronde_geopend",
      ["bestuurder", "voorzitter"],
      fondsId,
      {
        type: "stemronde_geopend",
        agendapunt_titel: body.vraag.trim().slice(0, 120),
        vraag: body.vraag.trim(),
        actor_naam: actorNaam,
        vergadering_id: ap.vergadering_id,
      },
      {
        gerelateerd_aan_type: "agendapunt",
        gerelateerd_aan_id: ap.id,
        actor_naam: actorNaam,
        actor_id: user.id,
      }
    );

    return NextResponse.json({ stemming });
  } catch (e) {
    console.error("Fout in POST /api/stemmingen:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
