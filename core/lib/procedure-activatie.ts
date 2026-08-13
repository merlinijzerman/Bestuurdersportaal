// Procedure-activatie — deterministische, parallelle activatielogica (D6).
//
// Kernprincipe (PROCEDURE-ENGINE-V2-ONTWERP §3): een procedure is
// standaard PARALLEL. Elke stap is activeerbaar zodra haar (eventuele)
// blokkerende afhankelijkheden zijn afgerond. Een stap zonder
// afhankelijkheden is dus vanaf de start activeerbaar. Sequentieel gedrag
// is geen engine-default meer, maar het gevolg van het declareren van een
// afhankelijkheidsketen.
//
// Alle functies hier zijn PUUR en IDEMPOTENT: dezelfde input geeft dezelfde
// output, en ze kunnen altijd opnieuw worden gedraaid (resume/herstel).
//
// Statusmodel (nieuw): 'geblokkeerd' | 'actief' | 'afgerond' | 'heropend'.
// Backwards-compat: de legacy-status 'open' blijft geldig in de DB-CHECK;
// deze module raakt 'open'-stappen NIET (die horen bij het oude,
// sequentiële pad in de route). Zo verandert een lopende legacy-procedure
// niet van gedrag (snapshot-integriteit).

export type StapStatus =
  | "open" // legacy (sequentieel pad); niet door deze module aangeraakt
  | "geblokkeerd"
  | "actief"
  | "afgerond"
  | "heropend";

export interface StapActivatieState {
  volgorde: number;
  status: StapStatus;
  blokkerende_afhankelijkheden: number[];
}

/**
 * Een stap is activeerbaar zodra ELKE blokkerende afhankelijkheid een stap
 * met status 'afgerond' is. Geen afhankelijkheden = altijd activeerbaar.
 */
export function isActiveerbaar(
  deps: number[],
  statusByVolgorde: Map<number, StapStatus>
): boolean {
  for (const v of deps) {
    if (statusByVolgorde.get(v) !== "afgerond") return false;
  }
  return true;
}

/**
 * Initiële stap-statussen bij `procedure_start` (nieuw model): elke stap
 * waarvan de afhankelijkheden (nog) niet allemaal afgerond zijn wordt
 * 'geblokkeerd', de rest 'actief'. Bij start is niets afgerond, dus dit
 * komt neer op: geen afhankelijkheden → 'actief'; wél afhankelijkheden →
 * 'geblokkeerd'. Een parallelle procedure (alle deps leeg) start dus met
 * ALLE stappen 'actief'.
 */
export function beginStatussen(
  stappen: { volgorde: number; blokkerende_afhankelijkheden: number[] }[]
): Map<number, "actief" | "geblokkeerd"> {
  const statusByVolgorde = new Map<number, StapStatus>(); // alles nog "niet afgerond"
  const uit = new Map<number, "actief" | "geblokkeerd">();
  for (const s of stappen) {
    uit.set(
      s.volgorde,
      isActiveerbaar(s.blokkerende_afhankelijkheden ?? [], statusByVolgorde)
        ? "actief"
        : "geblokkeerd"
    );
  }
  return uit;
}

/**
 * Herbereken activeerbaarheid ná een statuswijziging (typisch: een stap is
 * afgerond). Retourneert de volgordes van stappen die nu van 'geblokkeerd'
 * naar 'actief' mogen. Raakt bewust NIET 'actief'/'afgerond'/'heropend' aan
 * (geen cascade-terugzetting) en NIET 'open' (legacy). Idempotent: is er
 * niets te activeren, dan is de uitkomst leeg.
 */
export function herberekenActiveerbaarheid(stappen: StapActivatieState[]): number[] {
  const statusByVolgorde = new Map<number, StapStatus>();
  for (const s of stappen) statusByVolgorde.set(s.volgorde, s.status);

  const teActiveren: number[] = [];
  for (const s of stappen) {
    if (s.status !== "geblokkeerd") continue;
    if (isActiveerbaar(s.blokkerende_afhankelijkheden ?? [], statusByVolgorde)) {
      teActiveren.push(s.volgorde);
    }
  }
  return teActiveren;
}

/**
 * Bij het heropenen van een afgeronde stap: welke ANDERE, reeds afgeronde
 * stappen hangen (direct) van de heropende stap af? Die krijgen een
 * zichtbaar, niet-blokkerend signaal `herbevestiging_nodig = true` — ze
 * worden NIET automatisch teruggezet (voorkomt cascade-churn en audit-ruis;
 * OB-E1). Het bestuur beoordeelt zelf of herziening nodig is.
 */
export function afhankelijkeAfgerondeStappen(
  stappen: StapActivatieState[],
  heropendeVolgorde: number
): number[] {
  return stappen
    .filter(
      (s) =>
        s.status === "afgerond" &&
        s.volgorde !== heropendeVolgorde &&
        (s.blokkerende_afhankelijkheden ?? []).includes(heropendeVolgorde)
    )
    .map((s) => s.volgorde);
}

/**
 * Is de hele procedure afgerond? Waar in het nieuwe model: elke stap
 * 'afgerond'. 'open' (legacy) telt óók als niet-afgerond zodat het oude pad
 * niet per ongeluk vroeg afsluit.
 */
export function alleStappenAfgerond(stappen: { status: StapStatus }[]): boolean {
  return stappen.length > 0 && stappen.every((s) => s.status === "afgerond");
}
