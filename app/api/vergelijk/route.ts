// app/api/vergelijk/route.ts
// -----------------------------------------------------------------------------
// T5 — Symmetrische documentvergelijking als service achter een API. Deze route is
// de INGANG (getriggerd door de AI-chat, maar bewust ook los aanroepbaar en testbaar
// — de vergelijk-logica zit volledig in core/lib/vergelijk-*). Geen vergelijk-logica
// hier: alleen auth, tenant-poorten, validatie en delegatie naar de service.
//
// Contract: POST { mode:'symmetrisch', bron_document_id, doel_document_id, dimensies? }
//   → { comparison_run_id, mode, bron_document_id, doel_document_id, dimensies[], findings[] }
// fonds_id komt SERVER-SIDE uit het profiel (nooit uit de body). Achter de flag
// VERGELIJKMODUS: staat die uit, dan 404 (feature niet actief) — chat ongewijzigd.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { beoordeelRouteHostToegang } from "@/core/lib/tenant-route-guard";
import { weigerAlsModuleUit } from "@/core/lib/module-guard";
import { errorResponse } from "@/core/lib/api-errors";
import { vergelijkmodusAan } from "@/core/lib/vergelijk-config";
import { voerVergelijkingUit } from "@/core/lib/vergelijk-kern";
import { productieDeps, VERGELIJK_VERSIES } from "@/core/lib/vergelijk-productie";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // meerdere dimensies × retrieval + Opus; ruim genomen.

interface VergelijkBody {
  mode?: unknown;
  bron_document_id?: unknown;
  doel_document_id?: unknown;
  dimensies?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // 0. Feature-flag: uit = feature niet beschikbaar (chat-ingang doet ook niets).
    if (!vergelijkmodusAan()) {
      return NextResponse.json({ error: "Vergelijkmodus is niet actief." }, { status: 404 });
    }

    // 1. Auth.
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    // 2. Body + validatie.
    const body = (await req.json()) as VergelijkBody;
    const mode = body.mode;
    const bronId = typeof body.bron_document_id === "string" ? body.bron_document_id : "";
    const doelId = typeof body.doel_document_id === "string" ? body.doel_document_id : "";
    if (mode !== "symmetrisch") {
      return NextResponse.json({ error: "Alleen mode 'symmetrisch' wordt ondersteund (coverage = T6)." }, { status: 400 });
    }
    if (!bronId || !doelId) {
      return NextResponse.json({ error: "bron_document_id en doel_document_id zijn verplicht." }, { status: 400 });
    }
    if (bronId === doelId) {
      return NextResponse.json({ error: "bron en doel mogen niet hetzelfde document zijn." }, { status: 400 });
    }
    const extraDimensies = Array.isArray(body.dimensies)
      ? body.dimensies.filter((d): d is string => typeof d === "string")
      : undefined;

    // 3. fonds_id — SERVER-SIDE uit het profiel (body wordt nooit vertrouwd).
    const { data: profiel } = await supabase
      .from("profielen")
      .select("fonds_id")
      .eq("id", user.id)
      .single();
    const fondsId = profiel?.fonds_id ?? null;
    if (!fondsId) {
      return NextResponse.json({ error: "Geen fonds gekoppeld aan dit account" }, { status: 403 });
    }

    // 4. Host↔fonds-guard (fail-closed onder TENANT_ENFORCE).
    const hostOordeel = await beoordeelRouteHostToegang({
      sessieFondsId: fondsId,
      gebruikerId: user.id,
      label: "vergelijk.POST",
    });
    if (!hostOordeel.toegestaan) {
      return NextResponse.json({ error: "Dit webadres hoort niet bij uw fonds." }, { status: 403 });
    }

    // 5. Module-beschikbaarheid (AI). BESCHIKBAARHEID ≠ AUTORISATIE.
    const moduleWeigering = await weigerAlsModuleUit(fondsId, "ai");
    if (moduleWeigering) return moduleWeigering;

    // 6. Documenten moeten binnen het eigen fonds bestaan (expliciete blokker vóór de
    //    dure service; RLS + de DEFINER-RPC-guard borgen tenant-isolatie daarnaast).
    const { data: docs } = await supabase
      .from("documenten")
      .select("id")
      .in("id", [bronId, doelId]);
    const gevonden = new Set((docs ?? []).map((d) => d.id));
    if (!gevonden.has(bronId) || !gevonden.has(doelId)) {
      return NextResponse.json(
        { error: "Bron- of doeldocument niet gevonden in dit fonds." },
        { status: 404 }
      );
    }

    // 7. Delegeren naar de service (alle logica zit daar).
    const resultaat = await voerVergelijkingUit(
      {
        mode: "symmetrisch",
        bronDocumentId: bronId,
        doelDocumentId: doelId,
        extraDimensies,
        versies: VERGELIJK_VERSIES,
      },
      productieDeps({ supabase, fondsId })
    );

    return NextResponse.json(resultaat);
  } catch (error) {
    return errorResponse("vergelijk.POST", error);
  }
}
