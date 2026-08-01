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

// ── Schrijfvoorkeuren: van etiket naar instructie (31-07-2026) ───────────────
// WAAROM: tot nu toe landde de voorkeur als losse woordgroep in de prompt
// (`antwoordvoorkeur "puntsgewijs", detailniveau "beknopt"`) zonder dat ergens
// stond wat die waarde betékent. Het model kreeg dus een etiket zonder gedrag,
// terwijl TOON_BLOK (statisch, uitvoerig, dwingend: "lopende tekst is de
// standaard, niet bullets") wél concreet was. Resultaat: het wisselen van de
// voorkeur in het profiel maakte geen zichtbaar verschil in het antwoord.
// Hieronder krijgt elke toegestane waarde een expliciete gedragsinstructie die,
// waar nodig, de standaardvorm uit TOON_BLOK bewust overschrijft.
//
// GRENS (bestuurlijk/compliance): "beknopt" mag uitweidingen en voorbeelden
// kosten, NOOIT de bronmarkeringen, de benoemde aannames/onzekerheden of een
// relevante kanttekening. Kort is een vormkeuze van de lezer; onderbouwing en
// onzekerheid zijn dat niet.
//
// De toegestane waarden zijn server-side gevalideerd in app/api/profiel/route.ts
// (DETAILNIVEAUS / ANTWOORDVOORKEUREN). Een onbekende waarde valt hier stil
// terug op géén instructie — nooit op een gok.
const DETAILNIVEAU_INSTRUCTIE: Record<string, string> = {
  beknopt:
    "Detailniveau: BEKNOPT. Kom snel tot de kern en beperk u tot wat nodig is om de vraag te beantwoorden — als richtlijn één tot twee alinea's, en gebruikt u een raamwerk, dan uitsluitend de onderdelen die er werkelijk toe doen. Wat u inkort zijn uitweidingen, voorbeelden en zijpaden. Wat ook in een kort antwoord blijft staan: de inline bronmarkeringen, de aannames en onzekerheden, en een kanttekening die de lezer bestuurlijk nodig heeft.",
  standaard: "",
  uitgebreid:
    "Detailniveau: UITGEBREID. Neem ruimer de tijd: werk de redenering en de afwegingen uit, benoem relevante nuances en varianten, en behandel ook aanpalende punten die voor deze vraag bestuurlijk van belang zijn. Uitgebreid betekent meer diepgang, niet meer herhaling of vulling.",
};

const ANTWOORDVOORKEUR_INSTRUCTIE: Record<string, string> = {
  "kern-eerst":
    "Vorm: KERN EERST. Zet de kernboodschap in de eerste zinnen, vóór de onderbouwing — de lezer moet na twee zinnen weten waar het op neerkomt. Daarna pas de redenering, de nuances en de context.",
  puntsgewijs:
    "Vorm: PUNTSGEWIJS. Deze lezer leest liever gestructureerd. U mag hier afwijken van de standaardregel dat lopende tekst boven opsommingen gaat: presenteer de hoofdpunten als korte opsomming. Elk punt bevat een volledige gedachte (geen losse trefwoorden), en de samenhang tussen de punten schrijft u in lopende tekst eromheen — redenering en nuance horen niet in een bullet geperst.",
  "lopende tekst":
    "Vorm: LOPENDE TEKST. Schrijf volledig in doorlopende alinea's en vermijd opsommingen, ook waar u die normaal zou gebruiken; giet een vergelijking of reeks liever in een zin dan in een lijst.",
};

// Bouwt de operationele voorkeurinstructies. Leeg = geen sturing (de natuurlijke
// stijl uit TOON_BLOK blijft dan ongemoeid).
export function voorkeurInstructies(v: ProfielVoorkeuren): string[] {
  const regels: string[] = [];
  const vorm = v.antwoordvoorkeur ? ANTWOORDVOORKEUR_INSTRUCTIE[v.antwoordvoorkeur] : "";
  const detail = v.detailniveau ? DETAILNIVEAU_INSTRUCTIE[v.detailniveau] : "";
  if (vorm) regels.push(vorm);
  if (detail) regels.push(detail);
  return regels;
}

// Korte, leesbare weergave van de gekozen voorkeuren — gebruikt door de
// agenda-afnemer, die een JSON-structuur oplevert en dus geen vorminstructies
// voor vrije tekst kan gebruiken.
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
  const vInstructies = voorkeurInstructies(v);
  // Niets ingevuld → geen sturing (collectieve weergave is dan de natuurlijke staat).
  if (pRegels.length === 0 && vInstructies.length === 0) return null;

  const tekst = `PERSOONLIJK PROFIEL VAN DE LEZER — UITSLUITEND VOOR PRIORITERING, NOOIT VOOR FILTERING.
Profiel: ${pRegels.join("; ") || "geen specifieke aandachtsgebieden opgegeven"}.
Stem de VOLGORDE en NADRUK van je antwoord hierop af: behandel wat voor deze focusgebieden/expertise relevant is als eerste en het uitgebreidst. Je mag uit de gedeelde feitenbasis NIETS wegfilteren of verbergen omdat het buiten het profiel van deze lezer valt — de collectieve onderbouwing blijft voor iedereen intact en zichtbaar. Dat gaat over DEKKING, niet over lengte of vorm: hoe uitgebreid en in welke vorm de lezer het antwoord wil, staat hieronder en is zijn eigen keuze. Verwijs in je antwoord NIET naar dit profiel, naar "algemeen perspectief" of naar het feit dát je op het profiel hebt geprioriteerd — die transparantie regelt de interface apart, in het paneel "Onderbouwing en bronnen". Geef simpelweg het antwoord in de op het profiel afgestemde volgorde, zonder erover te editorialiseren.${
    vInstructies.length
      ? `

SCHRIJFVOORKEUREN VAN DEZE LEZER — deze gaan VÓÓR de algemene stijlregels waar ze elkaar tegenspreken:
${vInstructies.map((r) => `- ${r}`).join("\n")}
Ook hier geldt: de vorm en de lengte veranderen, de feitelijke dekking en de bronvermelding niet.`
      : ""
  }`;

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
