// ============================================================================
//  dashboard-types.ts — gedeelde vorm van een tabelrij (client-zijde)
// ----------------------------------------------------------------------------
//  Eén rij per SIGNAAL (niet per signaal × fonds). Bij "Alle fondsen" draagt de
//  rij de geaggregeerde status en een verdeling; bij een gekozen fonds de waarde
//  van dat fonds. Uitsluitend `import type` — deze module voert niets uit en
//  trekt dus geen server-only code de client-bundle in.
// ============================================================================

import type { SignaalWeergave, TrendPunt } from "@/platform/lib/monitoring-lees";
import type {
  SignaalConfig,
  SignaalId,
  SignaalStatus,
} from "@/platform/lib/monitoring-signalen";

/** Telling per status binnen een signaal over de fondsen (verdelingsindicator). */
export type Verdeling = {
  groen: number;
  oranje: number;
  rood: number;
  onbekend: number;
  totaal: number;
};

export type Rij = {
  signaal: SignaalId;
  config: SignaalConfig;
  /** Status van de rij: de slechtste over de fondsen ("Alle fondsen"), of die van het gekozen fonds. */
  status: SignaalStatus;
  waarde: number | null;
  onderdrukt: boolean;
  n: number | null;
  drempelOranje: number | null;
  drempelRood: number | null;
  /** Volledige (7-daagse, uurlijks uitgedunde) reeks; de periodekeuze snijdt hierop. */
  trend: TrendPunt[];
  laatsteMeting: string | null;
  verouderd: boolean;
  meta: Record<string, unknown> | null;
  /** "Platformbreed", de naam van het slechtst scorende fonds, of het gekozen fonds. */
  fondsLabel: string | null;
  platformbreed: boolean;
  /** Alleen gevuld bij "Alle fondsen" voor per-fonds signalen. */
  verdeling: Verdeling | null;
  /** Alle fondsen-metingen, voor de uitsplitsing in de detaillaag. */
  metingen: SignaalWeergave[];
};
