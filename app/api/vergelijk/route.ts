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
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { weigerAlsModuleUit } from "@/core/lib/module-guard";
import { errorResponse, badRequest, rateLimited } from "@/core/lib/api-errors";
import { controleerLimiet, LIMIETEN } from "@/core/lib/rate-limit";
import {
  preflight,
  preflightRespons,
  rondAf,
  sleutelUitRequest,
  vingerafdruk,
} from "@/core/lib/ai-preflight";
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

export const POST = withFondsRoute({ capability: "vergelijk.use", hostGuard: true, label: "vergelijk.POST" }, async (ctx, req: NextRequest) => {
  try {
    // 0. Feature-flag: uit = feature niet beschikbaar (chat-ingang doet ook niets).
    if (!vergelijkmodusAan()) {
      return NextResponse.json({ error: "Vergelijkmodus is niet actief." }, { status: 404 });
    }

    // 1. Auth — nu door withFondsRoute.
    const supabase = ctx.supabase;

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
    const fondsId = ctx.fondsId;
    // BESLUIT (W4 §7): deze tak BLIJFT staan, maar de host-guard draait er sinds
    // de migratie VOOR — de wrapper doet hem vóór de handler. Onder
    // TENANT_ENFORCE≠on is dat transparant en dus byte-identiek. Onder
    // TENANT_ENFORCE=on krijgt een gebruiker ZONDER fonds voortaan
    // "Dit webadres hoort niet bij uw fonds." (403) in plaats van
    // "Geen fonds gekoppeld aan dit account" (403): zelfde status, andere body.
    // Dezelfde afweging als in W3 bij `aqlab/assurance` en `zoeken`.
    if (!fondsId) {
      return NextResponse.json({ error: "Geen fonds gekoppeld aan dit account" }, { status: 403 });
    }

    // 5. Module-beschikbaarheid (AI). BESCHIKBAARHEID ≠ AUTORISATIE.
    const moduleWeigering = await weigerAlsModuleUit(fondsId, "ai");
    if (moduleWeigering) return moduleWeigering;

    // 5a. Burstlimiet. Deze route had er als enige kostendragende route géén
    //     (besluit 0180): per aanroep N × Opus plus 2N embeddings. Het
    //     maandquotum hieronder begrenst de HOEVEELHEID, niet het TEMPO — zonder
    //     deze limiet kan één gebruiker zijn hele maandtegoed in een minuut op
    //     de duurste route verbranden. Fail-closed.
    const limiet = await controleerLimiet(supabase, LIMIETEN.vergelijk, { failClosed: true });
    if (!limiet.toegestaan) return rateLimited("vergelijk.POST", limiet.resetAt);

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

    // 6a. AI-preflight (besluit 0180). Eén vergelijking = één AI-actie, ook al
    //     doet de service N modelcalls (één per dimensie) plus 2N embeddings.
    const idempotentie = sleutelUitRequest(req, "vergelijken");
    if (!idempotentie) {
      return badRequest(
        "vergelijk.POST",
        "Verzoek mist een geldige Idempotency-Key. Vernieuw de pagina en probeer het opnieuw."
      );
    }
    const pf = await preflight(supabase, {
      actietype: "vergelijken",
      provider: "anthropic",
      model: VERGELIJK_VERSIES.model,
      idempotentie,
      vingerafdruk: vingerafdruk({ bronId, doelId, extraDimensies: extraDimensies ?? null }),
    });
    const blokkade = preflightRespons("vergelijk.POST", pf);
    if (blokkade) return blokkade;
    const actieId = pf.uitkomst === "nieuw" ? pf.actieId : null;

    // 7. Delegeren naar de service (alle logica zit daar).
    let resultaat;
    try {
      resultaat = await voerVergelijkingUit(
        {
          mode: "symmetrisch",
          bronDocumentId: bronId,
          doelDocumentId: doelId,
          extraDimensies,
          versies: VERGELIJK_VERSIES,
        },
        productieDeps({ supabase, fondsId })
      );
    } catch (e) {
      // Reservering blijft staan: het verbruik is gemaakt. Alleen de
      // levenscyclus gaat op `mislukt`.
      await rondAf(supabase, actieId, "mislukt");
      throw e;
    }

    await rondAf(
      supabase,
      actieId,
      "voltooid",
      resultaat.comparison_run_id ? `comparison_run:${resultaat.comparison_run_id}` : null
    );
    return NextResponse.json(resultaat);
  } catch (error) {
    return errorResponse("vergelijk.POST", error);
  }
});
