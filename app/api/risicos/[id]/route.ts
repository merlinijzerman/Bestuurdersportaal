import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import {
  bouwRisicoWijziging,
  RISICO_VELD_LABEL,
  type RisicoHuidig,
  type RisicoVeld,
} from "@/core/lib/risico-wijziging";

// ============================================================================
//  PATCH /api/risicos/[id] — een bestaand risico wijzigen (besluit 0141)
// ----------------------------------------------------------------------------
//  Tot 0141 kon een risico alleen worden AANGEMAAKT en GESLOTEN. Een verkeerd
//  ingeschatte kans of een gewijzigde titel was daarmee onherstelbaar: de enige
//  uitweg was sluiten en opnieuw aanmaken, wat de geschiedenis van dat risico
//  in tweeën knipt en het logboek onbruikbaar maakt voor de vraag "hoe heeft dit
//  risico zich ontwikkeld?".
//
//  REDENPLICHT OP DE WEGING. Kans, impact en niveau bepalen de plek in de
//  heatmap en dus de bestuurlijke prioritering; die verzetten zonder motivering
//  is achteraf niet te reconstrueren. Titel en toelichting corrigeren mag wél
//  zonder. De regel zelf staat in core/lib/risico-wijziging.ts (puur + getest),
//  niet hier — zodat de bewerkmodal dezelfde eis vooraf kan tonen.
//
//  NIVEAU WORDT SERVER-SIDE AFGELEID uit kans × impact, tenzij
//  `niveau_handmatig` aanstaat. Een client kan het niveau dus niet losweken van
//  de heatmap zonder dat daar bewust voor gekozen is.
//
//  RECHTEN: iedereen binnen het eigen fonds, gelijk aan het aanmaken van een
//  risico (POST /api/risicos kent ook geen rolgate). Tenantgrens via RLS, plus
//  een expliciete fondscheck voor een leesbare 403. Sluiten houdt zijn eigen
//  route en eigen motiveringsplicht.
//
//  AUDIT: append-only regel in risico_log met event_type 'risico_gewijzigd',
//  de volledige diff (oud → nieuw per veld), de motivering en de vlag
//  `raakt_weging`. Die vlag maakt later filterbaar wélke wijzigingen de
//  bestuurlijke weging hebben geraakt.
// ============================================================================

type RisicoRij = RisicoHuidig & { id: string; fonds_id: string; status: string };

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

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, fonds_id")
      .eq("id", user.id)
      .single();

    const { data: rij } = await supabase
      .from("risicos")
      .select(
        "id, fonds_id, status, titel, toelichting, categorie, kans, impact, niveau, niveau_handmatig, type_risico, eigenaar_naam, volgende_beoordeling"
      )
      .eq("id", id)
      .maybeSingle();

    if (!rij) {
      return NextResponse.json({ error: "Risico niet gevonden" }, { status: 404 });
    }
    const risico = rij as RisicoRij;

    if (!profiel?.fonds_id || risico.fonds_id !== profiel.fonds_id) {
      return NextResponse.json(
        { error: "Dit risico hoort niet bij uw fonds." },
        { status: 403 }
      );
    }

    // Een gesloten risico ligt vast. Het staat in het archief als vastlegging
    // van hoe het bestuur het destijds heeft gewogen; dat achteraf bijstellen
    // zou die vastlegging waardeloos maken. Heropenen is een aparte handeling
    // die (bewust) nog niet bestaat.
    if (risico.status === "gesloten") {
      return NextResponse.json(
        {
          error:
            "Een gesloten risico kan niet worden gewijzigd. Het archief legt vast hoe het risico destijds is gewogen.",
          foutcode: "risico_gesloten",
        },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const uitkomst = bouwRisicoWijziging(risico, {
      titel: body.titel as string | undefined,
      toelichting: body.toelichting as string | null | undefined,
      categorie: body.categorie as string | undefined,
      kans: body.kans as number | undefined,
      impact: body.impact as number | undefined,
      niveau: body.niveau as string | undefined,
      niveau_handmatig: body.niveau_handmatig as boolean | undefined,
      type_risico: body.type_risico as string | undefined,
      eigenaar_naam: body.eigenaar_naam as string | null | undefined,
      volgende_beoordeling: body.volgende_beoordeling as string | null | undefined,
      reden: body.reden as string | undefined,
    });

    if (!uitkomst.ok) {
      const status = uitkomst.foutcode === "geen_wijziging" ? 200 : 400;
      return NextResponse.json(
        { error: uitkomst.melding, foutcode: uitkomst.foutcode },
        { status }
      );
    }

    const { data: updated, error: updFout } = await supabase
      .from("risicos")
      .update(uitkomst.update)
      .eq("id", id)
      .select(
        "id, titel, toelichting, categorie, kans, impact, niveau, niveau_handmatig, type_risico, eigenaar_naam, volgende_beoordeling"
      )
      .single();

    if (updFout) {
      console.error("PATCH risico fout:", updFout);
      return NextResponse.json(
        { error: "Wijzigen is niet gelukt. Probeer het opnieuw." },
        { status: 500 }
      );
    }

    // Append-only log NA de mutatie (guardrail). Best-effort.
    const { error: logFout } = await supabase.from("risico_log").insert({
      risico_id: id,
      event_type: "risico_gewijzigd",
      actor_id: user.id,
      actor_naam: profiel?.naam ?? null,
      payload: {
        velden: uitkomst.gewijzigdeVelden,
        // Leesbare labels erbij zodat het logboek zonder de code te kennen
        // te volgen is ("Kans" i.p.v. "kans").
        veld_labels: uitkomst.gewijzigdeVelden.map(
          (v: RisicoVeld) => RISICO_VELD_LABEL[v]
        ),
        diff: uitkomst.diff,
        motivering: uitkomst.reden,
        raakt_weging: uitkomst.raaktWeging,
      },
    });
    if (logFout) {
      console.error("risico_log insert fout (wijziging):", logFout);
    }

    return NextResponse.json({ risico: updated });
  } catch (e) {
    console.error("Fout in PATCH /api/risicos/[id]:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
