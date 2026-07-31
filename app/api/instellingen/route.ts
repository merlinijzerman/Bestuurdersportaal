import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { requireCapability } from "@/core/lib/capabilities";
import { errorResponse } from "@/core/lib/api-errors";
import {
  haalFondsConfig,
  haalConfigHistorie,
  hybrideZoekenAan,
  schrijfFlag,
  schrijfManifestModule,
  schrijfTheming,
  schrijfOverride,
  herstelConfig,
} from "@/core/lib/fonds-config";
import { isModuleKey, beheerbareModules } from "@/core/lib/module-registry";
import type { JsonWaarde } from "@/core/lib/fonds-config-core";

// ============================================================
//  /api/instellingen — fonds-configuratielaag (T8, generalisatie).
//
//  GET  : theming + manifest + flags + historie van het EIGEN fonds, plus
//         mag_beheren (capability). hybride_zoeken blijft in de respons voor
//         backward-compat.
//  POST : config-schrijfacties (flag/manifest/theming/override/herstel),
//         capability-gated (fonds.config.manage), server-side afgeleid fonds_id,
//         append-only gelogd + geversioneerd. { hybride_zoeken: boolean } blijft
//         als legacy-vorm ondersteund.
//  RLS beperkt alles tot het eigen fonds; de schrijf-rolgate zit óók in de DB.
// ============================================================

async function fondsVanGebruiker() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profiel: null };
  const { data: profiel } = await supabase
    .from("profielen")
    .select("naam, fonds_id, rol")
    .eq("id", user.id)
    .single();
  return { supabase, user, profiel };
}

export async function GET() {
  try {
    const { user, profiel } = await fondsVanGebruiker();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    if (!profiel?.fonds_id)
      return NextResponse.json({ error: "Geen fonds" }, { status: 400 });

    const magBeheren = await requireCapability(user.id, "fonds.config.manage");
    const config = await haalFondsConfig(profiel.fonds_id);
    const historie = await haalConfigHistorie(profiel.fonds_id, 50);

    return NextResponse.json({
      mag_beheren: magBeheren,
      hybride_zoeken: await hybrideZoekenAan(profiel.fonds_id),
      theming: config.themingTokens,
      // Beheerbare modules met effectieve beschikbaarheid (registry ⊕ manifest).
      modules: beheerbareModules().map((m) => ({
        key: m.key,
        label: m.label,
        beschikbaar: config.beschikbareModules.has(m.key),
      })),
      flags: Object.fromEntries(config.flags),
      overrides: Object.fromEntries(config.overrides),
      historie,
    });
  } catch (e) {
    console.error("Instellingen GET fout:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, profiel } = await fondsVanGebruiker();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    if (!profiel?.fonds_id)
      return NextResponse.json({ error: "Geen fonds" }, { status: 400 });

    // Autorisatie: server-side capability-gate (naast de RLS-rolgate op de tabellen).
    const magBeheren = await requireCapability(user.id, "fonds.config.manage");
    if (!magBeheren)
      return NextResponse.json({ error: "Onvoldoende rechten" }, { status: 403 });

    const fondsId = profiel.fonds_id; // server-side afgeleid, nooit uit de body
    const actor = { id: user.id, naam: profiel.naam ?? null };
    const body = (await req.json()) as Record<string, unknown>;

    // ── Legacy-vorm: { hybride_zoeken: boolean } → feature-flag-write ──────────
    if (typeof body.hybride_zoeken === "boolean" && body.type === undefined) {
      const { versie } = await schrijfFlag(fondsId, "hybride_zoeken", body.hybride_zoeken, actor);
      return NextResponse.json({ hybride_zoeken: body.hybride_zoeken, versie });
    }

    switch (body.type) {
      case "flag": {
        if (typeof body.key !== "string" || body.key.length === 0)
          return NextResponse.json({ error: "key (string) vereist" }, { status: 400 });
        // waarde is jsonb-generiek; accepteer boolean/string/number/null.
        const { versie } = await schrijfFlag(
          fondsId, body.key, (body.waarde ?? null) as JsonWaarde, actor
        );
        return NextResponse.json({ ok: true, versie });
      }
      case "manifest": {
        if (typeof body.module_key !== "string" || !isModuleKey(body.module_key))
          return NextResponse.json({ error: "onbekende module_key" }, { status: 400 });
        if (typeof body.actief !== "boolean")
          return NextResponse.json({ error: "actief (boolean) vereist" }, { status: 400 });
        const { versie } = await schrijfManifestModule(fondsId, body.module_key, body.actief, actor);
        return NextResponse.json({ ok: true, versie });
      }
      case "theming": {
        const { versie, genegeerd } = await schrijfTheming(fondsId, body.tokens, actor);
        return NextResponse.json({ ok: true, versie, genegeerd });
      }
      case "override": {
        if (typeof body.sleutel !== "string" || typeof body.waarde !== "string")
          return NextResponse.json({ error: "sleutel en waarde (string) vereist" }, { status: 400 });
        const { versie } = await schrijfOverride(fondsId, body.sleutel, body.waarde, actor);
        return NextResponse.json({ ok: true, versie });
      }
      case "herstel": {
        if (typeof body.log_id !== "string")
          return NextResponse.json({ error: "log_id (string) vereist" }, { status: 400 });
        const { versie } = await herstelConfig(fondsId, body.log_id, actor);
        return NextResponse.json({ ok: true, versie });
      }
      default:
        return NextResponse.json({ error: "Onbekende of ontbrekende 'type'" }, { status: 400 });
    }
  } catch (e) {
    // M-13 (review 2026-07-30): `e.message` (incl. Supabase-detail) ging
    // rechtstreeks naar de client. Nu server-side loggen, generiek antwoorden.
    return errorResponse("instellingen.POST", e);
  }
}
