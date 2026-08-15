// ============================================================================
//  verbruik-bundel-lees.ts — leeslaag voor de weergave "Verbruik & bundel"
// ----------------------------------------------------------------------------
//  De SupabaseClient wordt INGESPOTEN, niet hier gemaakt: zo draait dezelfde
//  functie binnen de callback van withPlatformRead en kan de leeskant nooit
//  buiten de capability- en auditwrapper om (patroon monitoring-lees.ts).
//
//  DATABRON (besluit 0178, B-1 = pad 2, live aggregatie). De maand-in/out per
//  fonds komt UITSLUITEND uit `governance_log.retrieval_meta->tokens = {in,out}`
//  — de append-only, in/out-gesplitste per-aanroepbron. `platform_signal_snapshots`
//  is hiervoor ONGESCHIKT (trend-%, gecombineerde 24u-som, geen maandbucket,
//  180 dagen retentie). Er wordt GEEN nieuw verbruik-DB-object toegevoegd.
//
//  ONDERGRENS (B-4). Deze tokens zijn een ondergrens: de routes `voorbereiding`
//  en `besluit-concept` schrijven geen governance_log-regel; reranker,
//  query-reformulatie en web_search tellen niet mee. `dekkingIndicatief` is
//  daarom ALTIJD true en de weergave labelt dat prominent. `afgekapt` markeert
//  bovendien een undercount als de leeslimiet is geraakt (zonder de door pad 2
//  bewust niet gekozen materialisatie is dat het schaalplafond).
//
//  FONDS_ID = null → platformbreed (B-4/AC4). Aanroepen zonder fonds landen in
//  het niet-toewijsbare blok en worden NOOIT doorbelast.
//
//  PRIVACY. Alleen aggregaten: som van tokens per fonds per maand. Geen
//  gespreks-, document- of gebruikersgegevens verlaten deze laag.
// ============================================================================

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEESLIMIET } from "@/platform/lib/monitoring-queries";
import {
  berekenJaar,
  berekenMaand,
  startMaandIndex,
  type JaarBerekening,
  type LicentieConfig,
  type MaandBerekening,
  type MaandInvoer,
} from "@/core/lib/verbruik-bundel-core";

/** Referentietarief voor het NIET-doorbelaste platformblok (indicatief). Het
 *  platform heeft geen eigen licentie; we prijzen zijn tokens tegen het
 *  gemiddelde van de geconfigureerde fondstarieven, met deze vaste fallback als
 *  er nog geen enkele licentie is. Uitsluitend voor weergave — niet doorbelast. */
const FALLBACK_TARIEF = { in: 5.32, uit: 26.63 } as const;

export type FondsVerbruik = {
  fondsId: string;
  fondsNaam: string;
  /** null = nog geen licentie geconfigureerd in fonds_licentie. */
  licentie: LicentieConfig | null;
  /** null als er geen licentie is (bundel/tarief onbekend → niets te rekenen). */
  jaar: JaarBerekening | null;
  /** Index 0..peilIdx. null = vóór ingangsdatum of geen data (n.v.t.). */
  maanden: (MaandBerekening | null)[];
  /** Ruwe maand-euro (input+output) voor de sparkline; null = n.v.t. */
  maandKosten: (number | null)[];
  /** Of er in dit jaar überhaupt tokens voor dit fonds gemeten zijn. */
  heeftData: boolean;
};

export type PlatformVerbruik = {
  /** Input-tokens per maand (miljoenen), index 0..peilIdx. */
  inMlnPerMaand: number[];
  /** Output-tokens per maand (miljoenen). */
  uitMlnPerMaand: number[];
  /** Indicatieve euro per maand tegen het referentietarief. */
  eurPerMaand: number[];
  ytdInMln: number;
  ytdUitMln: number;
  /** Indicatieve euro year-to-date. Niet doorbelast. */
  ytdEur: number;
};

export type VerbruikBundelOverzicht = {
  jaar: number;
  /** 0-based maandindex van de peilmaand (huidige maand, of 11 bij een afgesloten jaar). */
  peilIdx: number;
  peildatum: string;
  fondsen: FondsVerbruik[];
  platform: PlatformVerbruik;
  /** Som van de toewijsbare fonds-YTD in euro. */
  toewijsbaarEur: number;
  /** Leeslimiet geraakt → de euro's zijn een undercount. Zie kop. */
  afgekapt: boolean;
  /** Aantal gelezen governance_log-rijen; gaat als effect het auditspoor in. */
  gelezenRijen: number;
  /** B-4: dekking is altijd indicatief zolang het dekkingsgat openstaat. */
  dekkingIndicatief: true;
};

function getal(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Maandindex (0..11) uit een ISO-timestamptz. UTC-maand; op de maandgrens is
 *  het verschil met Europe/Amsterdam verwaarloosbaar voor een aggregaat. */
function maandVanIso(iso: string): number {
  return Math.min(11, Math.max(0, Number(iso.slice(5, 7)) - 1));
}

export async function haalVerbruikBundelOverzicht(
  svc: SupabaseClient,
  opties?: { nu?: Date }
): Promise<VerbruikBundelOverzicht> {
  const nu = opties?.nu ?? new Date();
  const jaar = nu.getFullYear();
  const peilIdx = nu.getMonth(); // 0..11
  const aantalMaanden = peilIdx + 1;

  const jaarStart = `${jaar}-01-01T00:00:00.000Z`;
  const jaarEind = `${jaar + 1}-01-01T00:00:00.000Z`;

  // ── Fondsen, licenties en governance_log parallel lezen ───────────────────
  const [fondsenRes, licentieRes, logRes] = await Promise.all([
    svc.from("fondsen").select("id, naam"),
    svc
      .from("fonds_licentie")
      .select("fonds_id, bundel_eur_jaar, tarief_in_eur_mln, tarief_uit_eur_mln, contract_start"),
    svc
      .from("governance_log")
      .select("fonds_id, aangemaakt, tokens:retrieval_meta->tokens")
      // Zonder .order() zou een afkapping op de leeslimiet de maandtoewijzing
      // willekeurig maken; met desc houden we in elk geval de recentste maanden.
      .order("aangemaakt", { ascending: false })
      .gte("aangemaakt", jaarStart)
      .lt("aangemaakt", jaarEind)
      .limit(LEESLIMIET),
  ]);

  if (fondsenRes.error) throw fondsenRes.error;
  if (licentieRes.error) throw licentieRes.error;
  if (logRes.error) throw logRes.error;

  const fondsen = (fondsenRes.data ?? []) as Array<{ id: string; naam: string }>;
  const licentieRijen = (licentieRes.data ?? []) as Array<{
    fonds_id: string;
    bundel_eur_jaar: number;
    tarief_in_eur_mln: number;
    tarief_uit_eur_mln: number;
    contract_start: string;
  }>;
  const logRijen = (logRes.data ?? []) as Array<{
    fonds_id: string | null;
    aangemaakt: string;
    tokens: { in?: unknown; out?: unknown } | null;
  }>;
  const afgekapt = logRijen.length >= LEESLIMIET;

  const licentiePerFonds = new Map<string, LicentieConfig>();
  for (const r of licentieRijen) {
    licentiePerFonds.set(r.fonds_id, {
      bundelEurJaar: getal(r.bundel_eur_jaar),
      tariefInEurMln: getal(r.tarief_in_eur_mln),
      tariefUitEurMln: getal(r.tarief_uit_eur_mln),
      contractStart: r.contract_start,
    });
  }

  // ── Tokens per fonds per maand (miljoenen), plus platformbreed (fonds = null)
  type MaandBak = { inMln: number[]; uitMln: number[] };
  const nieuweBak = (): MaandBak => ({
    inMln: Array(aantalMaanden).fill(0),
    uitMln: Array(aantalMaanden).fill(0),
  });
  const perFonds = new Map<string, MaandBak>();
  for (const f of fondsen) perFonds.set(f.id, nieuweBak());
  const platformBak = nieuweBak();

  for (const rij of logRijen) {
    const m = maandVanIso(rij.aangemaakt);
    if (m > peilIdx) continue; // buiten het peilvenster (defensief)
    const inMln = getal(rij.tokens?.in) / 1_000_000;
    const uitMln = getal(rij.tokens?.out) / 1_000_000;
    if (inMln + uitMln <= 0) continue; // gesprekken van vóór P5 dragen geen tokens
    const bak = rij.fonds_id === null ? platformBak : perFonds.get(rij.fonds_id);
    if (!bak) continue; // fonds bestaat niet meer
    bak.inMln[m] += inMln;
    bak.uitMln[m] += uitMln;
  }

  // ── Per fonds de jaar- en maandberekening draaien ─────────────────────────
  const fondsenUit: FondsVerbruik[] = fondsen.map((f) => {
    const bak = perFonds.get(f.id)!;
    const licentie = licentiePerFonds.get(f.id) ?? null;

    if (!licentie) {
      const heeftData =
        bak.inMln.reduce((a, v) => a + v, 0) +
          bak.uitMln.reduce((a, v) => a + v, 0) >
        0;
      return { fondsId: f.id, fondsNaam: f.naam, licentie: null, jaar: null, maanden: [], maandKosten: [], heeftData };
    }

    const si = startMaandIndex(licentie.contractStart, jaar);
    // Verbruik vóór de contract-ingangsmaand hoort niet bij deze bundel. Voor
    // contracten uit eerdere jaren is si=0; voor toekomstige contracten si=12.
    const inMlnYtd = bak.inMln.slice(si).reduce((a, v) => a + v, 0);
    const uitMlnYtd = bak.uitMln.slice(si).reduce((a, v) => a + v, 0);
    const heeftData = inMlnYtd + uitMlnYtd > 0;
    const jaarBer = berekenJaar(
      { inMln: inMlnYtd, uitMln: uitMlnYtd },
      licentie,
      peilIdx,
      jaar
    );

    // Maand-euro opbouwen: vóór ingangsdatum → null (n.v.t.); anders het echte
    // (mogelijk 0) verbruik van die maand tegen de fondstarieven.
    const maandInvoer: MaandInvoer[] = [];
    const maandKosten: (number | null)[] = [];
    for (let m = 0; m < aantalMaanden; m++) {
      if (m < si) {
        maandInvoer.push({ kostIn: null, kostUit: null });
        maandKosten.push(null);
        continue;
      }
      const kostIn = bak.inMln[m] * licentie.tariefInEurMln;
      const kostUit = bak.uitMln[m] * licentie.tariefUitEurMln;
      maandInvoer.push({ kostIn, kostUit });
      maandKosten.push(kostIn + kostUit);
    }

    const maanden = maandInvoer.map((_, m) =>
      berekenMaand(maandInvoer, m, licentie, jaarBer, jaar)
    );
    return { fondsId: f.id, fondsNaam: f.naam, licentie, jaar: jaarBer, maanden, maandKosten, heeftData };
  });

  // ── Platformbreed blok (indicatief geprijsd, niet doorbelast) ─────────────
  const refTarief = referentieTarief(licentiePerFonds);
  const eurPerMaand = platformBak.inMln.map(
    (v, m) => v * refTarief.in + platformBak.uitMln[m] * refTarief.uit
  );
  const ytdInMln = platformBak.inMln.reduce((a, v) => a + v, 0);
  const ytdUitMln = platformBak.uitMln.reduce((a, v) => a + v, 0);
  const platform: PlatformVerbruik = {
    inMlnPerMaand: platformBak.inMln,
    uitMlnPerMaand: platformBak.uitMln,
    eurPerMaand,
    ytdInMln,
    ytdUitMln,
    ytdEur: eurPerMaand.reduce((a, v) => a + v, 0),
  };

  const toewijsbaarEur = fondsenUit.reduce((a, f) => a + (f.jaar?.ytd ?? 0), 0);

  return {
    jaar,
    peilIdx,
    peildatum: nu.toISOString(),
    fondsen: fondsenUit,
    platform,
    toewijsbaarEur,
    afgekapt,
    gelezenRijen: logRijen.length,
    dekkingIndicatief: true,
  };
}

/** Gemiddelde van de geconfigureerde fondstarieven; vaste fallback zonder data. */
function referentieTarief(
  licenties: Map<string, LicentieConfig>
): { in: number; uit: number } {
  if (licenties.size === 0) return { ...FALLBACK_TARIEF };
  let sIn = 0;
  let sUit = 0;
  for (const l of licenties.values()) {
    sIn += l.tariefInEurMln;
    sUit += l.tariefUitEurMln;
  }
  return { in: sIn / licenties.size, uit: sUit / licenties.size };
}
