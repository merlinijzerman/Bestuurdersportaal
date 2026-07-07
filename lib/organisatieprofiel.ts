// ============================================================================
//  Organisatieprofiel — OP-2 (FO Organisatieprofiel v0.4 §2, §6, §7, §8).
//  Gedeelde helper, analoog aan lib/profielsturing.ts, die het generieke
//  contextprofiel van een organisatie (1-op-1 met fondsen) ophaalt en omzet
//  naar een prompt-blok + aspecten-metadata.
//
//  KERNPRINCIPE: het profiel is CONTEXT, geen bron-filter. Het grondt AI-duiding
//  met organisatiespecifieke feiten + strategie (voorkomt sectoraannames) en
//  gaat vóór algemene sectorkennis, maar NOOIT vóór wet/regelgeving, formele
//  organisatiedocumenten of actuele vergaderstukken (§7, bronhiërarchie).
//
//  Eén afnemer-vorm (OP-3): alle organisatiegebonden /ai-modi met een geldige
//  fonds_id-binding injecteren hetzelfde blok. Leeg/ontbrekend profiel → null.
// ============================================================================

import type { createServerSupabase } from "@/lib/supabase-server";
import type { RetrievalMeta } from "@/lib/rag";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabase>>;

// Welke veldgroepen het blok voedden (alleen metadata, geen inhoud) — gebruikt
// door het onderbouwingspaneel/governance-log van de chat (§8).
export type OrganisatieprofielAspecten = NonNullable<
  RetrievalMeta["organisatieprofiel_aspecten"]
>;

// Genormaliseerde profielvelden; lege strings zijn naar null herleid, zodat de
// blokbouw en aspecten één definitie van "ingevuld" hanteren.
export interface Organisatieprofiel {
  organisatietype: string | null;
  uitvoerendePartijen: string | null;
  omvang: string | null;
  kernfeiten: string | null;
  missie: string | null;
  visie: string | null;
  strategischeSpeerpunten: string | null;
  risicohouding: string | null;
  peildatum: string | null;
}

// Trim → null bij lege/whitespace-only waarde.
function tekstOfNull(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

// ── Data-ophaling ───────────────────────────────────────────────────────────
// Haalt het profiel voor één organisatie op via fonds_id (1-op-1). Retourneert
// null als er geen rij is. "Leeg profiel" (rij bestaat, alles null) bepaalt de
// blokbouw via bouwOrganisatieprofielBlok().
export async function haalOrganisatieprofiel(
  supabase: SupabaseClient,
  fondsId: string
): Promise<Organisatieprofiel | null> {
  const { data: p } = await supabase
    .from("organisatie_profielen")
    .select(
      "organisatietype, uitvoerende_partijen, omvang, kernfeiten, missie, visie, strategische_speerpunten, risicohouding, peildatum"
    )
    .eq("fonds_id", fondsId)
    .single();
  if (!p) return null;

  return {
    organisatietype: tekstOfNull(p.organisatietype),
    uitvoerendePartijen: tekstOfNull(p.uitvoerende_partijen),
    omvang: tekstOfNull(p.omvang),
    kernfeiten: tekstOfNull(p.kernfeiten),
    missie: tekstOfNull(p.missie),
    visie: tekstOfNull(p.visie),
    strategischeSpeerpunten: tekstOfNull(p.strategische_speerpunten),
    risicohouding: tekstOfNull(p.risicohouding),
    peildatum: tekstOfNull(p.peildatum),
  };
}

// ── Hulpfuncties ─────────────────────────────────────────────────────────────
function aspectenVan(p: Organisatieprofiel): OrganisatieprofielAspecten {
  return {
    organisatietype: !!p.organisatietype,
    uitvoerende_partijen: !!p.uitvoerendePartijen,
    omvang: !!p.omvang,
    kernfeiten: !!p.kernfeiten,
    missie: !!p.missie,
    visie: !!p.visie,
    strategische_speerpunten: !!p.strategischeSpeerpunten,
    risicohouding: !!p.risicohouding,
    peildatum: p.peildatum,
  };
}

// Bouwt de "Feiten:"-regel; laat lege deelvelden weg. Null als geen enkel feit.
function feitenRegel(p: Organisatieprofiel): string | null {
  const delen: string[] = [];
  if (p.organisatietype) delen.push(`type ${p.organisatietype}`);
  if (p.uitvoerendePartijen) delen.push(`uitvoerende partijen ${p.uitvoerendePartijen}`);
  if (p.omvang) delen.push(`omvang ${p.omvang}`);
  if (p.kernfeiten) delen.push(`overige feiten ${p.kernfeiten}`);
  return delen.length ? `Feiten: ${delen.join("; ")}.` : null;
}

// ── Blokbouw (FO §7) ─────────────────────────────────────────────────────────
// Zet het profiel om naar het prompt-blok + aspecten. Retourneert null als geen
// enkel veld is ingevuld (leeg profiel → geen blok, gedrag als nu). De vaste
// GEBRUIK-VAN-DIT-PROFIEL-regels (bronhiërarchie, markeer, conflictregel,
// niet-aanvullen) staan altíjd in het blok zodra er inhoud is.
export function bouwOrganisatieprofielBlok(
  p: Organisatieprofiel
): { tekst: string; aspecten: OrganisatieprofielAspecten } | null {
  const inhoudsRegels: string[] = [];

  const feiten = feitenRegel(p);
  if (feiten) inhoudsRegels.push(feiten);
  if (p.missie) inhoudsRegels.push(`Missie: ${p.missie}`);
  if (p.visie) inhoudsRegels.push(`Visie: ${p.visie}`);
  if (p.strategischeSpeerpunten)
    inhoudsRegels.push(`Strategische speerpunten: ${p.strategischeSpeerpunten}`);
  if (p.risicohouding) inhoudsRegels.push(`Risicohouding: ${p.risicohouding}`);

  // Niets ingevuld → geen blok (het bestaande [Algemene kennis]-gedrag blijft).
  if (inhoudsRegels.length === 0) return null;

  const kop = p.peildatum
    ? `=== ORGANISATIEPROFIEL (contextprofiel, peildatum ${p.peildatum}) ===`
    : `=== ORGANISATIEPROFIEL (contextprofiel) ===`;

  const tekst = `${kop}
${inhoudsRegels.join("\n")}

GEBRUIK VAN DIT PROFIEL:
- Dit is organisatiespecifieke context voor déze organisatie en gaat vóór algemene sectorkennis.
- Het vervangt GEEN wet- en regelgeving, formele organisatiedocumenten (statuten, reglementen, beleidsstukken, bestuursbesluiten) of actuele vergaderstukken — die gaan vóór dit profiel.
- Baseer je een bewering op dit profiel, markeer die direct met [Organisatieprofiel].
- Gebruik missie, visie, speerpunten en risicohouding uitsluitend voor duiding, aandachtspunten en vergadervragen — nooit als harde besluitregel. Formuleer in termen van "dit lijkt aan te sluiten bij", "dit kan spanning geven met", "dit vraagt bestuurlijke toetsing op" of een bespreekvraag voor bestuur/commissie. Je vervangt geen bestuurlijk besluit.
- CONFLICTREGEL: spreekt een formeler of recenter stuk dit profiel tegen, benoem dan het verschil, noem (indien aanwezig) de peildatum van het profiel, geef aan welke bron formeler of recenter lijkt, en formuleer een verificatievraag. Kies nooit stilzwijgend één bron.
- Vul ontbrekende juridische, reglementaire, actuariële of uitvoeringsspecifieke details NIET aan vanuit dit profiel; benoem onzekerheid als die details ontbreken.`;

  return { tekst, aspecten: aspectenVan(p) };
}

// ── Gemaksfunctie: ophalen + bouwen in één stap (voor OP-3) ───────────────────
// Retourneert null bij ontbrekend of leeg profiel; anders het blok + aspecten.
// De afnemer (route) zet op basis hiervan retrieval_meta.organisatieprofiel op
// 'actief' (blok !== null) of 'geen-profiel' (null).
export async function bouwOrganisatieprofiel(
  supabase: SupabaseClient,
  fondsId: string
): Promise<{ tekst: string; aspecten: OrganisatieprofielAspecten } | null> {
  const p = await haalOrganisatieprofiel(supabase, fondsId);
  if (!p) return null;
  return bouwOrganisatieprofielBlok(p);
}
