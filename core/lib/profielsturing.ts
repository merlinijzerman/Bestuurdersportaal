// ============================================================================
//  Profielsturing — Increment F (FO §14). Gedeelde helper die het persoonlijk
//  profiel van een lezer ophaalt en omzet naar een prioriterend prompt-blok.
//
//  KERNPRINCIPE: het profiel PRIORITEERT (volgorde/nadruk), het FILTERT NIET.
//  De gedeelde, collectieve feitenbasis blijft voor iedereen gelijk en compleet;
//  alleen de presentatie/nadruk schuift mee met de expertise, gremia,
//  focusgebieden en voorkeuren van de lezer.
//
//  Twee afnemers:
//   - AI-assistent (app/api/chat/route.ts) — vrije-tekst-antwoord.
//   - Agenda-voorbereiding (app/api/agendapunten/[id]/voorbereiding/route.ts) —
//     gestructureerde lenzen/vragen (JSON).
//  De data-ophaling is gedeeld; de instructietekst verschilt per afnemer.
// ============================================================================

import type { createServerSupabase } from "@/core/lib/supabase-server";
import type { RetrievalMeta } from "@/core/lib/rag";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabase>>;

// Welke profielvelden de prioritering voedden (alleen metadata, geen inhoud) —
// gebruikt door het herleidbaarheidspaneel/governance-log van de chat.
export type ProfielsturingAspecten = NonNullable<
  RetrievalMeta["profielsturing_aspecten"]
>;

// Genormaliseerde, naar leesbare namen herleide profielvoorkeuren.
export interface ProfielVoorkeuren {
  bestuurlijkeRol: string | null;
  primaireExpertiseNaam: string | null;
  secundaireNamen: string[];
  gremiaNamen: string[];
  focusNamenLijst: string[];
  antwoordvoorkeur: string | null;
  detailniveau: string | null;
}

// ── Data-ophaling ───────────────────────────────────────────────────────────
// Haalt het profiel + gekoppelde catalogus-namen op. Retourneert null als er
// geen profiel is. Let op: dit zegt nog niets over "leeg" — dat bepaalt de
// afnemer via heeftSturing().
export async function haalProfielVoorkeuren(
  supabase: SupabaseClient,
  userId: string
): Promise<ProfielVoorkeuren | null> {
  const { data: p } = await supabase
    .from("profielen")
    .select(
      "bestuurlijke_rol, primaire_expertise_id, antwoordvoorkeur, detailniveau"
    )
    .eq("id", userId)
    .single();
  if (!p) return null;

  const [expR, gremR, focusR] = await Promise.all([
    supabase.from("profiel_expertises").select("expertise_id").eq("profiel_id", userId),
    supabase.from("profiel_gremia").select("gremium_id").eq("profiel_id", userId),
    supabase.from("profiel_focusgebieden").select("focusgebied_id").eq("profiel_id", userId),
  ]);
  const secExpIds = (expR.data ?? []).map((r) => r.expertise_id as string);
  const gremIds = (gremR.data ?? []).map((r) => r.gremium_id as string);
  const focusIds = (focusR.data ?? []).map((r) => r.focusgebied_id as string);

  const primExpId = p.primaire_expertise_id as string | null;
  const expIds = Array.from(new Set([...(primExpId ? [primExpId] : []), ...secExpIds]));

  const leeg = { data: [] as { id: string; naam: string }[] };
  const [expNamen, gremNamen, focusNamen] = await Promise.all([
    expIds.length
      ? supabase.from("expertises").select("id, naam").in("id", expIds)
      : Promise.resolve(leeg),
    gremIds.length
      ? supabase.from("gremia").select("id, naam").in("id", gremIds)
      : Promise.resolve(leeg),
    focusIds.length
      ? supabase.from("kritische_focusgebieden").select("id, naam").in("id", focusIds)
      : Promise.resolve(leeg),
  ]);

  const naam = (rij: { data: { id: string; naam: string }[] | null }, id: string) =>
    (rij.data ?? []).find((r) => r.id === id)?.naam ?? null;

  const bestuurlijkeRol =
    typeof p.bestuurlijke_rol === "string" && p.bestuurlijke_rol.trim().length > 0
      ? p.bestuurlijke_rol.trim()
      : null;
  const primaireExpertiseNaam = primExpId ? naam(expNamen, primExpId) : null;
  const secundaireNamen = secExpIds
    .map((id) => naam(expNamen, id))
    .filter((n): n is string => !!n);
  const gremiaNamen = gremIds.map((id) => naam(gremNamen, id)).filter((n): n is string => !!n);
  const focusNamenLijst = focusIds
    .map((id) => naam(focusNamen, id))
    .filter((n): n is string => !!n);
  const antwoordvoorkeur =
    typeof p.antwoordvoorkeur === "string" && p.antwoordvoorkeur.trim().length > 0
      ? p.antwoordvoorkeur.trim()
      : null;
  const detailniveau =
    typeof p.detailniveau === "string" && p.detailniveau.trim().length > 0
      ? p.detailniveau.trim()
      : null;

  return {
    bestuurlijkeRol,
    primaireExpertiseNaam,
    secundaireNamen,
    gremiaNamen,
    focusNamenLijst,
    antwoordvoorkeur,
    detailniveau,
  };
}

// ── Hulpfuncties ─────────────────────────────────────────────────────────────
function profielRegels(v: ProfielVoorkeuren): string[] {
  const regels: string[] = [];
  if (v.bestuurlijkeRol) regels.push(`bestuurlijke rol: ${v.bestuurlijkeRol}`);
  if (v.primaireExpertiseNaam) regels.push(`primaire expertise: ${v.primaireExpertiseNaam}`);
  if (v.secundaireNamen.length)
    regels.push(`secundaire expertise: ${v.secundaireNamen.join(", ")}`);
  if (v.gremiaNamen.length) regels.push(`actief in: ${v.gremiaNamen.join(", ")}`);
  if (v.focusNamenLijst.length)
    regels.push(`kritische focusgebieden: ${v.focusNamenLijst.join(", ")}`);
  return regels;
}

function voorkeurRegels(v: ProfielVoorkeuren): string[] {
  const regels: string[] = [];
  if (v.antwoordvoorkeur) regels.push(`antwoordvoorkeur "${v.antwoordvoorkeur}"`);
  if (v.detailniveau) regels.push(`detailniveau "${v.detailniveau}"`);
  return regels;
}

function aspectenVan(v: ProfielVoorkeuren): ProfielsturingAspecten {
  return {
    bestuurlijke_rol: !!v.bestuurlijkeRol,
    primaire_expertise: !!v.primaireExpertiseNaam,
    secundaire_expertises: v.secundaireNamen.length,
    gremia: v.gremiaNamen.length,
    focusgebieden: v.focusNamenLijst.length,
    antwoordvoorkeur: v.antwoordvoorkeur,
    detailniveau: v.detailniveau,
  };
}

// ── Afnemer 1: AI-assistent (vrije tekst) ────────────────────────────────────
export async function bouwProfielsturing(
  supabase: SupabaseClient,
  userId: string
): Promise<{ tekst: string; aspecten: ProfielsturingAspecten } | null> {
  const v = await haalProfielVoorkeuren(supabase, userId);
  if (!v) return null;

  const pRegels = profielRegels(v);
  const vRegels = voorkeurRegels(v);
  // Niets ingevuld → geen sturing (collectieve weergave is dan de natuurlijke staat).
  if (pRegels.length === 0 && vRegels.length === 0) return null;

  const tekst = `PERSOONLIJK PROFIEL VAN DE LEZER — UITSLUITEND VOOR PRIORITERING, NOOIT VOOR FILTERING.
Profiel: ${pRegels.join("; ") || "geen specifieke aandachtsgebieden opgegeven"}.${
    vRegels.length ? ` Voorkeuren: ${vRegels.join(", ")}.` : ""
  }
Stem de VOLGORDE en NADRUK van je antwoord hierop af: behandel wat voor deze focusgebieden/expertise relevant is als eerste en het uitgebreidst. Je mag NIETS weglaten, inkorten of verbergen uit de gedeelde feitenbasis — de volledige, collectieve onderbouwing blijft intact en zichtbaar voor iedereen. Verwijs in je antwoord NIET naar dit profiel, naar "algemeen perspectief" of naar het feit dát je op het profiel hebt geprioriteerd — die transparantie regelt de interface apart, in het paneel "Onderbouwing en bronnen". Geef simpelweg het antwoord in de op het profiel afgestemde volgorde, zonder erover te editorialiseren.`;

  return { tekst, aspecten: aspectenVan(v) };
}

// ── Afnemer 2: Agenda-voorbereiding (gestructureerde lenzen/vragen) ───────────
// Geeft een prompt-blok dat de lenskeuze en vraagformulering kleurt naar de
// expertise/focusgebieden van de lezer, ZONDER de collectieve dekking te
// versmallen: de gedeelde lenzen en vragen blijven volledig, het profiel voegt
// een persoonlijke nadruk toe. Retourneert ook de aspecten voor herleidbaarheid.
export async function bouwProfielsturingAgenda(
  supabase: SupabaseClient,
  userId: string
): Promise<{ tekst: string; aspecten: ProfielsturingAspecten } | null> {
  const v = await haalProfielVoorkeuren(supabase, userId);
  if (!v) return null;

  const pRegels = profielRegels(v);
  const vRegels = voorkeurRegels(v);
  if (pRegels.length === 0 && vRegels.length === 0) return null;

  const tekst = `=== PERSOONLIJK PROFIEL VAN DEZE BESTUURDER — VOOR NADRUK, NIET VOOR INPERKING ===
Profiel: ${pRegels.join("; ") || "geen specifieke aandachtsgebieden opgegeven"}.${
    vRegels.length ? ` Voorkeuren: ${vRegels.join(", ")}.` : ""
  }
Laat dit profiel de SELECTIE en SCHERPTE van de lenzen en vragen kleuren: geef extra gewicht aan invalshoeken die raken aan de expertise, gremia en kritische focusgebieden van deze bestuurder, en formuleer minstens één lens of vergadervraag die expliciet vanuit die focus vertrekt. Maar versmal de dekking NIET tot alleen het profiel: de bestuurlijk noodzakelijke lenzen (stakeholder-impact, financierbaarheid, uitvoerbaarheid, beheerst besluitvormingsproces, evenwichtige belangenafweging) blijven leidend waar het stuk daarom vraagt — ook als ze buiten het profiel van deze lezer vallen. Verwijs in de output NIET expliciet naar "het profiel"; verwerk de nadruk in de inhoud.`;

  return { tekst, aspecten: aspectenVan(v) };
}
