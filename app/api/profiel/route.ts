// ============================================================================
//  /api/profiel — Increment F: persoonlijk bestuurdersprofiel (FO §14)
//
//  GET   — eigen profiel + gekoppelde expertises/gremia/focusgebieden.
//  PATCH — eigen profiel bijwerken (velden + koppelingen).
//
//  STRIKT ZELFBEHEER (besluit 0017): de capability profile.manage.own dekt het
//  beheren van het EIGEN profiel. Er is geen profile.manage.all; een gebruiker
//  kan andermans profiel niet muteren. RLS borgt dit op id=auth.uid() (profielen)
//  resp. profiel_id=auth.uid() (join-tabellen). Tenant-isolatie + fondsconsistentie
//  via composite-FK; uitsluitend anon-key, geen service-role.
//
//  AANTAL-grenzen en toegestane tekstwaarden zijn app-validatie (hier), geen
//  DB-check. Elke mutatie landt append-only in profiel_log.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { requireCapability } from "@/lib/capabilities";
import { ANTWOORDMODI, type Antwoordmodus } from "@/lib/vraagtype";

export const dynamic = "force-dynamic";

const MAX_SECUNDAIRE_EXPERTISES = 3;
const MIN_FOCUSGEBIEDEN = 3;
const MAX_FOCUSGEBIEDEN = 5;

const DETAILNIVEAUS = ["beknopt", "standaard", "uitgebreid"] as const;
const ANTWOORDVOORKEUREN = ["kern-eerst", "puntsgewijs", "lopende tekst"] as const;

interface PatchBody {
  bestuurlijke_rol?: string | null;
  primaire_expertise_id?: string | null;
  antwoordvoorkeur?: string | null;
  standaard_ai_modus?: string | null;
  detailniveau?: string | null;
  secundaire_expertise_ids?: string[];
  gremium_ids?: string[];
  focusgebied_ids?: string[];
}

function schoonTekst(waarde: string | null | undefined): string | null {
  if (waarde === null || waarde === undefined) return null;
  const t = String(waarde).trim();
  return t.length > 0 ? t : null;
}

function uniekeIds(ruw: unknown): string[] {
  if (!Array.isArray(ruw)) return [];
  const ids = ruw.filter((x): x is string => typeof x === "string" && x.length > 0);
  return Array.from(new Set(ids));
}

export async function GET() {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    const { data: profiel } = await supabase
      .from("profielen")
      .select(
        "id, naam, rol, fonds_id, bestuurlijke_rol, primaire_expertise_id, antwoordvoorkeur, standaard_ai_modus, detailniveau"
      )
      .eq("id", user.id)
      .single();

    if (!profiel) return NextResponse.json({ error: "Profiel niet gevonden" }, { status: 404 });

    const [exp, grem, focus] = await Promise.all([
      supabase.from("profiel_expertises").select("expertise_id").eq("profiel_id", user.id),
      supabase.from("profiel_gremia").select("gremium_id").eq("profiel_id", user.id),
      supabase.from("profiel_focusgebieden").select("focusgebied_id").eq("profiel_id", user.id),
    ]);

    return NextResponse.json({
      profiel,
      secundaire_expertise_ids: (exp.data ?? []).map((r) => r.expertise_id),
      gremium_ids: (grem.data ?? []).map((r) => r.gremium_id),
      focusgebied_ids: (focus.data ?? []).map((r) => r.focusgebied_id),
    });
  } catch (e) {
    console.error("Fout in GET /api/profiel:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    // Strikt zelfbeheer: capability dekt het EIGEN profiel; RLS dwingt de rij af.
    if (!(await requireCapability(user.id, "profile.manage.own"))) {
      return NextResponse.json(
        { error: "Geen rechten om het profiel te beheren (profile.manage.own)" },
        { status: 403 }
      );
    }

    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam, fonds_id")
      .eq("id", user.id)
      .single();
    if (!profiel?.fonds_id) {
      return NextResponse.json(
        { error: "Profiel heeft nog geen fonds; koppeling/profielbeheer niet mogelijk." },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as PatchBody;

    // ── Validatie tekstvelden ──────────────────────────────────────────────
    const detailniveau = schoonTekst(body.detailniveau);
    if (detailniveau && !DETAILNIVEAUS.includes(detailniveau as (typeof DETAILNIVEAUS)[number])) {
      return NextResponse.json({ error: `Ongeldig detailniveau: ${detailniveau}` }, { status: 400 });
    }
    const antwoordvoorkeur = schoonTekst(body.antwoordvoorkeur);
    if (
      antwoordvoorkeur &&
      !ANTWOORDVOORKEUREN.includes(antwoordvoorkeur as (typeof ANTWOORDVOORKEUREN)[number])
    ) {
      return NextResponse.json(
        { error: `Ongeldige antwoordvoorkeur: ${antwoordvoorkeur}` },
        { status: 400 }
      );
    }
    const standaardAiModus = schoonTekst(body.standaard_ai_modus);
    if (standaardAiModus && !ANTWOORDMODI.includes(standaardAiModus as Antwoordmodus)) {
      return NextResponse.json(
        { error: `Ongeldige standaard_ai_modus: ${standaardAiModus}` },
        { status: 400 }
      );
    }
    const bestuurlijkeRol = schoonTekst(body.bestuurlijke_rol);

    // ── Validatie koppelingen (aantal + onderlinge consistentie) ───────────
    const primaireExpertiseId = schoonTekst(body.primaire_expertise_id);
    const secundaire = uniekeIds(body.secundaire_expertise_ids);
    const gremia = uniekeIds(body.gremium_ids);
    const focus = uniekeIds(body.focusgebied_ids);

    if (secundaire.length > MAX_SECUNDAIRE_EXPERTISES) {
      return NextResponse.json(
        { error: `Maximaal ${MAX_SECUNDAIRE_EXPERTISES} secundaire expertises toegestaan.` },
        { status: 400 }
      );
    }
    if (primaireExpertiseId && secundaire.includes(primaireExpertiseId)) {
      return NextResponse.json(
        { error: "Primaire expertise mag niet ook als secundaire expertise gekozen zijn." },
        { status: 400 }
      );
    }
    if (focus.length > 0 && (focus.length < MIN_FOCUSGEBIEDEN || focus.length > MAX_FOCUSGEBIEDEN)) {
      return NextResponse.json(
        { error: `Kies ${MIN_FOCUSGEBIEDEN} tot ${MAX_FOCUSGEBIEDEN} kritische focusgebieden.` },
        { status: 400 }
      );
    }

    // ── Opslaan via transactionele RPC ─────────────────────────────────────
    // Velden + 3 koppeling-sets + append-only audit landen in ÉÉN transactie
    // (functie profiel_opslaan, SECURITY INVOKER zodat RLS onverkort geldt).
    // Faalt één statement — bijv. een composite-FK-weigering (expertise/gremium/
    // focusgebied van een ander fonds of een globale template) of de audit-insert
    // — dan rolt alles terug: geen half doorgevoerde profielstaat, geen
    // ontbrekende auditregel.
    const { error: rpcFout } = await supabase.rpc("profiel_opslaan", {
      p_bestuurlijke_rol: bestuurlijkeRol,
      p_primaire_expertise_id: primaireExpertiseId,
      p_antwoordvoorkeur: antwoordvoorkeur,
      p_standaard_ai_modus: standaardAiModus,
      p_detailniveau: detailniveau,
      p_secundaire_expertise_ids: secundaire,
      p_gremium_ids: gremia,
      p_focusgebied_ids: focus,
    });
    if (rpcFout) {
      console.error("Profiel opslaan (RPC) fout:", rpcFout);
      return NextResponse.json(
        {
          error:
            "Opslaan mislukt — koppel uitsluitend expertises, gremia en focusgebieden uit de eigen fonds-catalogus.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Fout in PATCH /api/profiel:", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
