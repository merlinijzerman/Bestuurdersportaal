// ============================================================================
//  Trendlijn — miniatuurgrafiek per signaal (P4-light)
// ----------------------------------------------------------------------------
//  PURE SVG, geen chart-library. CLAUDE.md verbiedt het introduceren van een
//  visualisatiebibliotheek zonder expliciet voorstel, en dat is hier ook niet
//  nodig: één polyline met een drempelmarkering.
//
//  Er staat een vergelijkbare trendlijn onder app/(dashboard)/ (klantbeeld,
//  stuurinformatie). Die wordt hier BEWUST niet geïmporteerd: de platform-surface
//  hoort niet uit de tenant-surface te lezen. Het naar core/components/ tillen
//  van één gedeelde trendlijn is een nette opruimactie, maar geen onderdeel van
//  een monitoringtranche — dat zou de tenant-UI raken zonder aanleiding.
//
//  Kleuren komen uit de CSS-tokens (var(--ok) / --warn / --err / --line), niet
//  uit hex-literals; npm run lint:colors bewaakt dat.
// ============================================================================

import type { SignaalStatus } from "@/platform/lib/monitoring-signalen";
import type { TrendPunt } from "@/platform/lib/monitoring-lees";

const KLEUR: Record<SignaalStatus, string> = {
  groen: "var(--ok)",
  oranje: "var(--warn)",
  rood: "var(--err)",
  onbekend: "var(--app-line-control)",
};

const BREEDTE = 260;
const HOOGTE = 56;
const MARGE = { links: 4, rechts: 4, boven: 6, onder: 6 };

export default function Trendlijn({
  punten,
  status,
  drempelOranje,
  drempelRood,
}: {
  punten: TrendPunt[];
  status: SignaalStatus;
  drempelOranje: number | null;
  drempelRood: number | null;
}) {
  const waarden = punten
    .map((p) => p.waarde)
    .filter((w): w is number => w !== null && Number.isFinite(w));

  if (waarden.length < 2) {
    // Eén of nul metingen is geen trend. Dat expliciet zeggen is eerlijker dan
    // een vlakke lijn tekenen die stabiliteit suggereert.
    return (
      <p className="text-xs text-ink/50">
        {waarden.length === 0
          ? "Nog geen metingen."
          : "Eén meting — een trend is pas zichtbaar vanaf twee."}
      </p>
    );
  }

  // Schaal: neem de drempels mee in het bereik, anders valt een drempellijn
  // buiten beeld precies wanneer hij interessant wordt.
  const kandidaten = [...waarden, drempelOranje, drempelRood].filter(
    (w): w is number => w !== null && Number.isFinite(w)
  );
  const ruwMin = Math.min(...kandidaten);
  const ruwMax = Math.max(...kandidaten);
  const marge = (ruwMax - ruwMin) * 0.1 || Math.max(Math.abs(ruwMax) * 0.1, 1);
  const min = ruwMin - marge;
  const max = ruwMax + marge;

  const binnenBreedte = BREEDTE - MARGE.links - MARGE.rechts;
  const binnenHoogte = HOOGTE - MARGE.boven - MARGE.onder;
  const x = (i: number) => MARGE.links + (i / (waarden.length - 1)) * binnenBreedte;
  const y = (w: number) =>
    MARGE.boven + (1 - (w - min) / (max - min || 1)) * binnenHoogte;

  const lijn = waarden.map((w, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(w)}`).join(" ");
  const vlak = `${lijn} L ${x(waarden.length - 1)} ${HOOGTE - MARGE.onder} L ${x(0)} ${HOOGTE - MARGE.onder} Z`;
  const kleur = KLEUR[status];
  const laatste = waarden[waarden.length - 1] as number;

  return (
    <svg
      viewBox={`0 0 ${BREEDTE} ${HOOGTE}`}
      className="w-full"
      style={{ maxHeight: HOOGTE }}
      role="img"
      aria-label={`Verloop van ${waarden.length} metingen; laatste waarde ${laatste}.`}
    >
      {drempelRood !== null && drempelRood >= min && drempelRood <= max && (
        <line
          x1={MARGE.links}
          x2={BREEDTE - MARGE.rechts}
          y1={y(drempelRood)}
          y2={y(drempelRood)}
          stroke="var(--err)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.5}
        />
      )}
      {drempelOranje !== null && drempelOranje >= min && drempelOranje <= max && (
        <line
          x1={MARGE.links}
          x2={BREEDTE - MARGE.rechts}
          y1={y(drempelOranje)}
          y2={y(drempelOranje)}
          stroke="var(--warn)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.5}
        />
      )}
      <path d={vlak} fill={kleur} fillOpacity={0.08} />
      <path
        d={lijn}
        fill="none"
        stroke={kleur}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={x(waarden.length - 1)} cy={y(laatste)} r={2.6} fill={kleur} />
    </svg>
  );
}
