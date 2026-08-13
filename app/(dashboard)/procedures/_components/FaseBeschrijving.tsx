// Fasebeschrijving (WO-2, §7 / D8) — pure presentatie.
//
// Toont de gedeelde, per fonds overschrijfbare beschrijving van een fase. Zit
// in het UITGEKLAPTE deel van de fasen-accordion (FaseRail): de fasekop zelf
// draagt code/titel/status-pill/meter, hier staat alleen de toelichtende tekst.

interface Props {
  beschrijving: string | null;
  isOverride: boolean;
}

export default function FaseBeschrijving({ beschrijving, isOverride }: Props) {
  if (!beschrijving) return null;
  return (
    <p className="text-[11px] text-muted leading-snug">
      {beschrijving}
      {isOverride && (
        <span
          className="ml-1 text-[9px] uppercase tracking-wide text-phase-ink"
          title="Fondsspecifieke beschrijving (override op de generieke default)"
        >
          · fonds-variant
        </span>
      )}
    </p>
  );
}
