// ============================================================================
//  DELETE /api/gesprekken/[id] — een gesprek definitief verwijderen (plateau A)
// ----------------------------------------------------------------------------
//  Vervangt het oude "archiveren" (`gearchiveerd = true`), dat de chatinhoud
//  liet staan én de auditregels onaangeroerd liet — terwijl de knop een
//  prullenbak toonde.
//
//  DEZE ROUTE DOET ZELF NIETS. Zij roept uitsluitend `verwijder_gesprek()` aan:
//  één transactie die de chatinhoud opruimt, het gesprek verwijdert en een
//  redactieregel schrijft. Autorisatie, eigenaarschap, idempotentie en de
//  volgorde zitten in die functie, niet hier — governance-logica hoort niet
//  uitsluitend in de applicatielaag.
//
//  GEEN SERVICE-ROLE. De route gebruikt de anon-key mét de sessie van de
//  gebruiker (`createServerSupabase()`); `verwijder_gesprek` is SECURITY DEFINER
//  en bepaalt `auth.uid()` intern. Het gesprek-id uit de URL wordt dus nooit
//  vertrouwd voor autorisatie.
//
//  IDEMPOTENT. De client stuurt een `request_id` mee. Een netwerkretry of een
//  dubbelklik levert daardoor één redactieregel en hetzelfde antwoord — niet een
//  tweede, lege verwijdering.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "gesprekken.id.delete" }, capability: "gesprekken.manage", schema: z.object({ "request_id": z.unknown().optional() }).passthrough() }, async (ctx, req: NextRequest, params) => {
  try {
    const { id } = params as { id: string };
    if (!UUID.test(id)) {
      return NextResponse.json({ error: "Ongeldig gesprek-id" }, { status: 400 });
    }

    // De client levert het request_id; ontbreekt of deugt het niet, dan maken we
    // er zelf één. Idempotentie over een retry heen vraagt wél om een STABIEL
    // id van de client — daarom stuurt AssistentClient hem mee.
    let requestId: string | null = null;
    try {
      const body = (await req.json()) as { request_id?: unknown };
      if (typeof body?.request_id === "string" && UUID.test(body.request_id)) {
        requestId = body.request_id;
      }
    } catch {
      // Geen of ongeldige body: geen bezwaar, we vallen terug op een nieuw id.
    }
    if (!requestId) requestId = crypto.randomUUID();

    const supabase = ctx.supabase;

    const { data, error } = await supabase.rpc("verwijder_gesprek", {
      p_gesprek_id: id,
      p_request_id: requestId,
    });

    if (error) {
      // De RPC gebruikt functionele foutcodes; die vertalen we naar HTTP zonder
      // ooit inhoud of details van andermans gesprek terug te geven.
      const code = error.message ?? "";
      if (code.includes("geen_eigenaar")) {
        return NextResponse.json({ error: "Geen rechten" }, { status: 403 });
      }
      if (code.includes("gesprek_niet_gevonden")) {
        return NextResponse.json({ error: "Gesprek niet gevonden" }, { status: 404 });
      }
      if (code.includes("niet_geauthenticeerd")) {
        return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
      }
      console.error("DELETE gesprek (RPC) mislukt:", error);
      return NextResponse.json({ error: "Verwijderen mislukt" }, { status: 500 });
    }

    // `data` is {status: 'verwijderd'|'reeds_uitgevoerd', aantal_regels: n}.
    return NextResponse.json({ success: true, ...(data ?? {}) });
  } catch (e) {
    console.error("Fout in DELETE /api/gesprekken/[id]:", e);
    return NextResponse.json({ error: "Interne fout" }, { status: 500 });
  }
});
