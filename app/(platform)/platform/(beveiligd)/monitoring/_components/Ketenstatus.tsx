// ============================================================================
//  Ketenstatus — laag 1 van het dashboard (voorstel §4)
// ----------------------------------------------------------------------------
//  Eén platformbrede uitspraak + vier domeintegels. ALTIJD platformbreed: de
//  balk negeert het fondsfilter, anders leest "ik filter op fonds A en het is
//  groen" als "het platform is in orde".
//
//  `onbekend` telt nooit als groen (aggregeerStatus borgt dat); een verouderde of
//  onderdrukte meting verschijnt in de eigen teller, niet in "in orde". Kleur is
//  nooit de enige drager: elke tegel draagt het Stoplicht (woord + vorm + kleur)
//  en een tekstuele telling.
// ============================================================================

import Stoplicht from "./Stoplicht";
import {
  DOMEIN_LABEL,
  DOMEIN_VOLGORDE,
  type Domein,
  type DomeinSamenvatting,
  type SignaalStatus,
} from "@/platform/lib/monitoring-signalen";

function beschrijfDomein(s: DomeinSamenvatting): string {
  if (s.totaal === 0) return "geen metingen";
  const delen: string[] = [];
  if (s.afwijkend > 0) {
    delen.push(
      s.afwijkend === 1
        ? `1 van ${s.totaal} vraagt aandacht`
        : `${s.afwijkend} van ${s.totaal} vragen aandacht`
    );
  }
  if (s.onbekend > 0) delen.push(`${s.onbekend} onbekend`);
  if (delen.length === 0) return `alle ${s.totaal} in orde`;
  return delen.join(" · ");
}

export default function Ketenstatus({
  status,
  perDomein,
  actiefDomein,
  onKiesDomein,
}: {
  status: SignaalStatus;
  perDomein: Record<Domein, DomeinSamenvatting>;
  actiefDomein: Domein | null;
  onKiesDomein: (d: Domein | null) => void;
}) {
  return (
    <section aria-label="Ketenstatus" className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
            Ketenstatus &middot; platformbreed
          </p>
          <div className="mt-1.5">
            <Stoplicht status={status} />
          </div>
        </div>
        <p className="max-w-md text-xs text-ink/60">
          Eén uitspraak over de hele keten. Deze balk staat los van het fondsfilter
          en de periodekeuze: hij gaat over de stand van nu.
        </p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {DOMEIN_VOLGORDE.map((d) => {
          const s = perDomein[d];
          const actief = actiefDomein === d;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={actief}
              onClick={() => onKiesDomein(actief ? null : d)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors hover:bg-app-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                actief ? "border-accent ring-1 ring-accent" : "border-line"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">{DOMEIN_LABEL[d]}</span>
                <Stoplicht status={s.slechtste} />
              </span>
              <span className="mt-1 block text-xs text-ink/60">{beschrijfDomein(s)}</span>
            </button>
          );
        })}
      </div>

      {actiefDomein && (
        <button
          type="button"
          onClick={() => onKiesDomein(null)}
          className="mt-2 text-xs font-medium text-accent hover:underline"
        >
          Toon alle domeinen
        </button>
      )}
    </section>
  );
}
