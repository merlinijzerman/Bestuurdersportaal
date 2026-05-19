import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { notifyAgendapuntBijdragers } from "@/lib/notifications";

const TOEGESTANE_CATEGORIEEN = [
  "beeldvorming",
  "oordeelsvorming",
  "besluitvorming",
  "informatie",
];
const MOTIVERING_MIN = 10;

type AgendapuntRow = {
  id: string;
  vergadering_id: string;
  titel: string;
  beschrijving: string | null;
  categorie: string;
  tijdsduur_minuten: number | null;
  verantwoordelijke: string | null;
  volgorde: number;
  aangemaakt_door: string | null;
  verwijderd_op: string | null;
};

type VergaderingMeta = {
  fonds_id: string;
  datum: string;
};

async function haalAgendapuntMetFonds(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  id: string
): Promise<{ agendapunt: AgendapuntRow; fonds_id: string } | null> {
  const { data: agendapunt } = await supabase
    .from("agendapunten")
    .select(
      "id, vergadering_id, titel, beschrijving, categorie, tijdsduur_minuten, verantwoordelijke, volgorde, aangemaakt_door, verwijderd_op"
    )
    .eq("id", id)
    .maybeSingle();

  if (!agendapunt) return null;

  const { data: verg } = await supabase
    .from("vergaderingen")
    .select("fonds_id, datum")
    .eq("id", (agendapunt as AgendapuntRow).vergadering_id)
    .maybeSingle();

  if (!verg) return null;

  return {
    agendapunt: agendapunt as AgendapuntRow,
    fonds_id: (verg as VergaderingMeta).fonds_id,
  };
}

// ============================================================
//  PATCH /api/agendapunten/[id]
//  Wijzigen, verplaatsen, of verschuiven van een agendapunt.
//  Rechten: eigenaar (aangemaakt_door) + voorzitter/beheerder.
//  Motivering verplicht bij ≥1 bijdrager (min 10 tekens).
// ============================================================
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const meta = await haalAgendapuntMetFonds(supabase, id);
    if (!meta) {
      return NextResponse.json({ error: "Agendapunt niet gevonden" }, { status: 404 });
    }
    const { agendapunt, fonds_id } = meta;

    if (agendapunt.verwijderd_op) {
      return NextResponse.json(
        { error: "Agendapunt is verwijderd; eerst herstellen voordat wijzigen mogelijk is" },
        { status: 400 }
      );
    }

    // Profiel + rol
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, rol, fonds_id")
      .eq("id", user.id)
      .single();

    const isEigenaar = agendapunt.aangemaakt_door === user.id;
    const isPrivileged =
      profiel?.rol === "voorzitter" || profiel?.rol === "beheerder";

    if (!isEigenaar && !isPrivileged) {
      return NextResponse.json(
        { error: "U heeft geen recht om dit agendapunt te wijzigen" },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      titel?: string;
      beschrijving?: string | null;
      categorie?: string;
      tijdsduur_minuten?: number | null;
      verantwoordelijke?: string | null;
      vergadering_id?: string;
      volgorde?: number;
      motivering?: string;
    };

    // ── Bouw update-payload + diff ───────────────────────────
    const betekenisvolleVelden: string[] = [];
    const updatePayload: Record<string, unknown> = {};
    const diff: Record<string, { oud: unknown; nieuw: unknown }> = {};

    if (body.titel !== undefined && body.titel !== agendapunt.titel) {
      if (!body.titel.trim()) {
        return NextResponse.json({ error: "Titel mag niet leeg zijn" }, { status: 400 });
      }
      updatePayload.titel = body.titel.trim();
      diff.titel = { oud: agendapunt.titel, nieuw: body.titel.trim() };
      betekenisvolleVelden.push("titel");
    }
    if (body.beschrijving !== undefined && body.beschrijving !== agendapunt.beschrijving) {
      const nieuw = body.beschrijving || null;
      updatePayload.beschrijving = nieuw;
      diff.beschrijving = { oud: agendapunt.beschrijving, nieuw };
      betekenisvolleVelden.push("beschrijving");
    }
    if (body.categorie !== undefined && body.categorie !== agendapunt.categorie) {
      if (!TOEGESTANE_CATEGORIEEN.includes(body.categorie)) {
        return NextResponse.json({ error: "Ongeldige categorie" }, { status: 400 });
      }
      updatePayload.categorie = body.categorie;
      diff.categorie = { oud: agendapunt.categorie, nieuw: body.categorie };
      betekenisvolleVelden.push("categorie");
    }
    if (
      body.tijdsduur_minuten !== undefined &&
      body.tijdsduur_minuten !== agendapunt.tijdsduur_minuten
    ) {
      updatePayload.tijdsduur_minuten = body.tijdsduur_minuten;
      diff.tijdsduur_minuten = {
        oud: agendapunt.tijdsduur_minuten,
        nieuw: body.tijdsduur_minuten,
      };
      betekenisvolleVelden.push("tijdsduur_minuten");
    }
    if (
      body.verantwoordelijke !== undefined &&
      body.verantwoordelijke !== agendapunt.verantwoordelijke
    ) {
      const nieuw = body.verantwoordelijke || null;
      updatePayload.verantwoordelijke = nieuw;
      diff.verantwoordelijke = { oud: agendapunt.verantwoordelijke, nieuw };
      betekenisvolleVelden.push("verantwoordelijke");
    }

    // ── Verplaatsen (vergadering_id wijziging) ──────────────
    let isVerplaatsen = false;
    if (
      body.vergadering_id !== undefined &&
      body.vergadering_id !== agendapunt.vergadering_id
    ) {
      isVerplaatsen = true;
      const { data: doelVerg } = await supabase
        .from("vergaderingen")
        .select("id, fonds_id, datum")
        .eq("id", body.vergadering_id)
        .maybeSingle();

      if (!doelVerg) {
        return NextResponse.json(
          { error: "Doel-vergadering bestaat niet" },
          { status: 400 }
        );
      }
      const doel = doelVerg as { id: string; fonds_id: string; datum: string };
      if (doel.fonds_id !== fonds_id) {
        return NextResponse.json(
          { error: "Doel-vergadering hoort bij een ander fonds" },
          { status: 400 }
        );
      }
      if (new Date(doel.datum) <= new Date()) {
        return NextResponse.json(
          { error: "Doel-vergadering moet in de toekomst liggen" },
          { status: 400 }
        );
      }

      updatePayload.vergadering_id = body.vergadering_id;
      diff.vergadering_id = {
        oud: agendapunt.vergadering_id,
        nieuw: body.vergadering_id,
      };
      betekenisvolleVelden.push("vergadering_id");

      // Nieuwe volgorde: aan eind van doel-vergadering
      const { data: laatste } = await supabase
        .from("agendapunten")
        .select("volgorde")
        .eq("vergadering_id", body.vergadering_id)
        .is("verwijderd_op", null)
        .order("volgorde", { ascending: false })
        .limit(1);
      const laatsteVolgorde = (laatste?.[0]?.volgorde as number | undefined) ?? 0;
      updatePayload.volgorde = laatsteVolgorde + 1;
    }

    // ── Volgorde-wissel (binnen zelfde vergadering) ─────────
    let isAlleenVolgordeWissel = false;
    if (
      body.volgorde !== undefined &&
      !isVerplaatsen &&
      body.volgorde !== agendapunt.volgorde
    ) {
      // Wissel met buurpunt op die volgorde
      const { data: buurpunten } = await supabase
        .from("agendapunten")
        .select("id, volgorde")
        .eq("vergadering_id", agendapunt.vergadering_id)
        .is("verwijderd_op", null)
        .eq("volgorde", body.volgorde);

      if (buurpunten && buurpunten.length > 0) {
        const buur = buurpunten[0] as { id: string; volgorde: number };
        await supabase
          .from("agendapunten")
          .update({ volgorde: agendapunt.volgorde })
          .eq("id", buur.id);
      }
      updatePayload.volgorde = body.volgorde;
      isAlleenVolgordeWissel = Object.keys(updatePayload).length === 1;
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json(
        { error: "Geen wijzigingen meegegeven" },
        { status: 400 }
      );
    }

    // ── Motivering-trigger ──────────────────────────────────
    let motiveringVereist = false;
    if (!isAlleenVolgordeWissel) {
      const [{ count: inbrengCount }, { count: voorbCount }] = await Promise.all([
        supabase
          .from("agendapunt_inbreng")
          .select("id", { count: "exact", head: true })
          .eq("agendapunt_id", id),
        supabase
          .from("voorbereidingen")
          .select("id", { count: "exact", head: true })
          .eq("agendapunt_id", id),
      ]);
      motiveringVereist = (inbrengCount ?? 0) + (voorbCount ?? 0) > 0;
    }

    const motivering = (body.motivering ?? "").trim();
    if (motiveringVereist && motivering.length < MOTIVERING_MIN) {
      return NextResponse.json(
        {
          error: `Motivering verplicht (minimaal ${MOTIVERING_MIN} tekens) omdat er al inbreng of voorbereidingen op dit punt staan`,
        },
        { status: 400 }
      );
    }

    // ── Audit-velden + update ───────────────────────────────
    updatePayload.gewijzigd_op = new Date().toISOString();
    updatePayload.gewijzigd_door = user.id;

    const { data: updated, error: updFout } = await supabase
      .from("agendapunten")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (updFout) {
      console.error("PATCH agendapunt fout:", updFout);
      return NextResponse.json({ error: "Wijzigen mislukt" }, { status: 500 });
    }

    // ── Log + notificatie ───────────────────────────────────
    if (!isAlleenVolgordeWissel) {
      const event_type = isVerplaatsen
        ? "agendapunt_verplaatst"
        : "agendapunt_gewijzigd";
      await supabase.from("agendapunt_log").insert({
        agendapunt_id: id,
        event_type,
        actor_id: user.id,
        payload: {
          velden: betekenisvolleVelden,
          diff,
          motivering: motivering || null,
        },
      });

      const actorNaam = (profiel as { naam?: string | null } | null)?.naam ?? "Een collega";
      const huidigeTitel =
        (updatePayload.titel as string | undefined) ?? agendapunt.titel;
      const huidigeVergadering =
        (updatePayload.vergadering_id as string | undefined) ??
        agendapunt.vergadering_id;

      if (isVerplaatsen) {
        await notifyAgendapuntBijdragers(
          supabase,
          id,
          fonds_id,
          "agendapunt_verplaatst",
          {
            type: "agendapunt_verplaatst",
            agendapunt_titel: huidigeTitel,
            oude_vergadering_id: agendapunt.vergadering_id,
            nieuwe_vergadering_id: updatePayload.vergadering_id as string,
            motivering: motivering || "",
            actor_naam: actorNaam,
            vergadering_id: huidigeVergadering,
          },
          {
            gerelateerd_aan_type: "agendapunt",
            gerelateerd_aan_id: id,
            actor_naam: actorNaam,
            actor_id: user.id,
          }
        );
      } else {
        await notifyAgendapuntBijdragers(
          supabase,
          id,
          fonds_id,
          "agendapunt_gewijzigd",
          {
            type: "agendapunt_gewijzigd",
            agendapunt_titel: huidigeTitel,
            velden: betekenisvolleVelden,
            motivering: motivering || "",
            actor_naam: actorNaam,
            vergadering_id: huidigeVergadering,
          },
          {
            gerelateerd_aan_type: "agendapunt",
            gerelateerd_aan_id: id,
            actor_naam: actorNaam,
            actor_id: user.id,
          }
        );
      }
    }

    return NextResponse.json({ agendapunt: updated });
  } catch (e) {
    console.error("Fout in PATCH /api/agendapunten/[id]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}

// ============================================================
//  DELETE /api/agendapunten/[id]
//  Soft-delete. Rechten: eigenaar + voorzitter/beheerder.
//  Verplichte reden (min 10 tekens).
// ============================================================
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const meta = await haalAgendapuntMetFonds(supabase, id);
    if (!meta) {
      return NextResponse.json({ error: "Agendapunt niet gevonden" }, { status: 404 });
    }
    const { agendapunt, fonds_id } = meta;

    if (agendapunt.verwijderd_op) {
      return NextResponse.json(
        { error: "Agendapunt is al verwijderd" },
        { status: 400 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, rol")
      .eq("id", user.id)
      .single();

    const isEigenaar = agendapunt.aangemaakt_door === user.id;
    const isPrivileged =
      profiel?.rol === "voorzitter" || profiel?.rol === "beheerder";

    if (!isEigenaar && !isPrivileged) {
      return NextResponse.json(
        { error: "U heeft geen recht om dit agendapunt te verwijderen" },
        { status: 403 }
      );
    }

    let body: { reden?: string } = {};
    try {
      body = (await req.json()) as { reden?: string };
    } catch {
      body = {};
    }
    const reden = (body.reden ?? "").trim();
    if (reden.length < MOTIVERING_MIN) {
      return NextResponse.json(
        { error: `Reden verplicht (minimaal ${MOTIVERING_MIN} tekens)` },
        { status: 400 }
      );
    }

    const { data: updated, error: updFout } = await supabase
      .from("agendapunten")
      .update({
        verwijderd_op: new Date().toISOString(),
        verwijderd_door: user.id,
        verwijder_reden: reden,
      })
      .eq("id", id)
      .select()
      .single();

    if (updFout) {
      console.error("DELETE agendapunt fout:", updFout);
      return NextResponse.json({ error: "Verwijderen mislukt" }, { status: 500 });
    }

    await supabase.from("agendapunt_log").insert({
      agendapunt_id: id,
      event_type: "agendapunt_verwijderd",
      actor_id: user.id,
      payload: { motivering: reden },
    });

    const actorNaam = (profiel as { naam?: string | null } | null)?.naam ?? "Een collega";
    await notifyAgendapuntBijdragers(
      supabase,
      id,
      fonds_id,
      "agendapunt_verwijderd",
      {
        type: "agendapunt_verwijderd",
        agendapunt_titel: agendapunt.titel,
        motivering: reden,
        actor_naam: actorNaam,
        vergadering_id: agendapunt.vergadering_id,
      },
      {
        gerelateerd_aan_type: "agendapunt",
        gerelateerd_aan_id: id,
        actor_naam: actorNaam,
        actor_id: user.id,
      }
    );

    return NextResponse.json({ agendapunt: updated });
  } catch (e) {
    console.error("Fout in DELETE /api/agendapunten/[id]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
