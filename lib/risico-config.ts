// Risicomatrix — centrale configuratie
// Categorieën, niveau-afleiding en kleurmappings.

export type CategorieSlug =
  | "financieel_actuarieel"
  | "governance_organisatie"
  | "operationeel_datakwaliteit"
  | "informatie_communicatie";

export type NiveauSlug = "laag" | "middel" | "hoog";
export type TypeRisicoSlug = "structureel" | "tijdelijk";
export type StatusSlug = "actief" | "gesloten";
export type MaatregelStatus = "open" | "in_voorbereiding" | "genomen";

export interface CategorieConfig {
  slug: CategorieSlug;
  label: string;
  korteOmschrijving: string;
}

export const CATEGORIEEN: CategorieConfig[] = [
  {
    slug: "financieel_actuarieel",
    label: "Financieel & actuarieel",
    korteOmschrijving:
      "Renterisico, dekkingsgraad, beleggingsrendement, krimprisico en aanverwante kasstroomrisico's.",
  },
  {
    slug: "governance_organisatie",
    label: "Governance & Organisatie",
    korteOmschrijving:
      "Bestuurlijke continuïteit, geschiktheid, belangenverstrengeling, grote transities zoals Wtp.",
  },
  {
    slug: "operationeel_datakwaliteit",
    label: "Operationeel & datakwaliteit",
    korteOmschrijving:
      "Pensioenadministratie, IT-systemen, cyberveiligheid, leveranciers en data-integriteit.",
  },
  {
    slug: "informatie_communicatie",
    label: "Informatie & communicatie",
    korteOmschrijving:
      "Deelnemerscommunicatie, externe rapportages, klachten en transparantieverplichtingen.",
  },
];

export function categorieLabel(slug: string): string {
  return CATEGORIEEN.find((c) => c.slug === slug)?.label ?? slug;
}

// Kans en Impact als labels (1-5)
export const KANS_LABELS: Record<number, string> = {
  1: "Zeer laag",
  2: "Laag",
  3: "Gemiddeld",
  4: "Hoog",
  5: "Zeer hoog",
};

export const IMPACT_LABELS: Record<number, string> = {
  1: "Zeer laag",
  2: "Laag",
  3: "Gemiddeld",
  4: "Hoog",
  5: "Zeer hoog",
};

// Niveau-afleiding op basis van K + I.
//   2-4  → laag (groen)
//   5-7  → middel (oranje)
//   8-10 → hoog (rood)
export function leidNiveauAf(kans: number, impact: number): NiveauSlug {
  const sum = kans + impact;
  if (sum <= 4) return "laag";
  if (sum <= 7) return "middel";
  return "hoog";
}

// Niveau-omschrijving voor in legenda's en tooltips
export const NIVEAU_OMSCHRIJVING: Record<NiveauSlug, string> = {
  hoog: "Direct bestuurlijk aandachtspunt. Risico vereist actieve beheersing en periodieke rapportage.",
  middel: "Structureel monitoren. Beheersmaatregelen aanwezig, opvolging in reguliere risicocyclus.",
  laag: "Basismaatregelen volstaan. Periodieke check, geen actieve beheersing nodig.",
};

export const NIVEAU_LABEL: Record<NiveauSlug, string> = {
  hoog: "Hoog",
  middel: "Middel",
  laag: "Laag",
};

// Tailwind klassen per niveau (achtergrond, tekst, dot)
export const NIVEAU_KLEUREN: Record<
  NiveauSlug,
  { dot: string; pillBg: string; pillText: string; cellBg: string; cellBorder: string }
> = {
  hoog: {
    dot: "bg-red-500",
    pillBg: "bg-red-50",
    pillText: "text-red-700",
    cellBg: "bg-red-50",
    cellBorder: "border-red-100",
  },
  middel: {
    dot: "bg-amber-500",
    pillBg: "bg-amber-50",
    pillText: "text-amber-700",
    cellBg: "bg-amber-50",
    cellBorder: "border-amber-100",
  },
  laag: {
    dot: "bg-emerald-500",
    pillBg: "bg-emerald-50",
    pillText: "text-emerald-700",
    cellBg: "bg-emerald-50",
    cellBorder: "border-emerald-100",
  },
};

export const TYPE_LABEL: Record<TypeRisicoSlug, string> = {
  structureel: "Structureel",
  tijdelijk: "Tijdelijk",
};

export const TYPE_OMSCHRIJVING: Record<TypeRisicoSlug, string> = {
  structureel: "Inherent aan de bedrijfsvoering",
  tijdelijk: "Gebonden aan een gebeurtenis of project",
};

export const MAATREGEL_STATUS_LABEL: Record<MaatregelStatus, string> = {
  open: "Open",
  in_voorbereiding: "In voorbereiding",
  genomen: "Genomen",
};
