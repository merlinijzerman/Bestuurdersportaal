// Portfolio-samenvattingstegels voor het procesoverzicht (WO-2, §7.1).
//
// Vier tegels over de LOPENDE procedures: Lopend / Met aandacht / Tijdkritisch
// / Besluitrijp. Elke tegel draagt een verticale accentstreep in de statuskleur
// (kleur + woord + cijfer). UI-afgeleid; server-side aggregatie is OB-E5.

import type { PortfolioAggregaat } from "@/core/lib/procedure-fase-status";

interface Tegel {
  label: string;
  waarde: number;
  streep: string;
  cijfer: string;
  hint: string;
}

export default function PortfolioTegels({
  aggregaat,
}: {
  aggregaat: PortfolioAggregaat;
}) {
  const tegels: Tegel[] = [
    {
      label: "Lopend",
      waarde: aggregaat.lopend,
      streep: "bg-accent",
      cijfer: "text-ink",
      hint: "Procedures in uitvoering",
    },
    {
      label: "Met aandacht",
      waarde: aggregaat.metAandacht,
      streep: "bg-warn",
      cijfer: "text-warn-ink",
      hint: "≥1 fase met een aandachtsvlag",
    },
    {
      label: "Tijdkritisch",
      waarde: aggregaat.tijdkritisch,
      streep: "bg-err",
      cijfer: "text-err-ink",
      hint: "≥1 rode vlag (ontbrekende blokkerende bewijslast)",
    },
    {
      label: "Besluitrijp",
      waarde: aggregaat.besluitrijp,
      streep: "bg-ok",
      cijfer: "text-ok-ink",
      hint: "Readiness-niveau besluitrijp voldoet",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tegels.map((t) => (
        <div
          key={t.label}
          className="relative bg-white border border-line rounded-xl p-4 overflow-hidden"
          title={t.hint}
        >
          <div
            className={`absolute left-0 top-0 bottom-0 w-[3px] ${t.streep}`}
          />
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
            {t.label}
          </div>
          <div className={`font-serif text-2xl font-bold mt-1 ${t.cijfer}`}>
            {t.waarde}
          </div>
        </div>
      ))}
    </div>
  );
}
