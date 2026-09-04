"use client";
// ============================================================================
//  Assistent — de PANEELSCHIL (T1, besluit 0204).
// ----------------------------------------------------------------------------
//  De schil: vier standen, de contextchip, en de knoppen om te wisselen. De
//  inhoud komt als `children` binnen — dat is de presentatielaag uit `app/`.
//  Dat is geen omweg maar de T9-grens: `core/` mag niet uit `app/` importeren,
//  dus `app/(dashboard)/layout.tsx` geeft het oppervlak door aan de schil in
//  plaats van dat de schil het ophaalt.
//
//  NIET MODAAL. Het paneel schuift de contentkolom opzij (margin, geen overlap)
//  en die kolom blijft bedienbaar. Dus géén `aria-modal`, géén focus-sentinels,
//  géén scroll-lock — dat zou de bestuurder opsluiten in een paneel dat naast
//  zijn stuk hoort te staan. Wat wél moet, en hier staat: de focus verplaatst
//  bij openen naar het paneel en keert bij sluiten terug naar de knop die het
//  opende, Escape sluit, en `aria-expanded` staat op elke opener.
//
//  ESCAPE SLUIT ALLEEN VANUIT HET PANEEL, en zonder `stopPropagation` — het
//  patroon uit `AntwoordWeergave.tsx` (WCAG 1.4.13 "dismissible"). Het
//  @-noemenpopover binnen het gesprek heeft een eigen Escape-afhandeling; die
//  mag deze niet inslikken en andersom.
// ============================================================================

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { contextChip } from "@/core/lib/assistent-context";
import Icoon from "@/core/components/icons/Icoon";
import { useAssistentContext } from "./AssistentContextProvider";
import { useAssistentPaneel, type PaneelStand } from "./AssistentPaneelProvider";

/** De standknoppen delen één vorm; los uitschrijven zou vier keer driften. */
const KNOP =
  "assistent-kopknop inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors";

/** Een generieke opening heeft geen inhoudelijke scope, maar mag wel benoemen
 * in welke module de bestuurder werkt. Dat is context, geen bronclaim. */
const MODULE_CONTEXT: Record<string, { label: string; bronbereik: string }> = {
  bibliotheek: { label: "Fondsbibliotheek", bronbereik: "binnen uw rechten" },
  procedures: { label: "Processen", bronbereik: "dossier en gekoppelde stukken" },
  risicomatrix: { label: "Risicomatrix", bronbereik: "risico's en gekoppelde stukken" },
  vergaderingen: { label: "Vergaderingen", bronbereik: "agenda en gekoppelde stukken" },
  notulen: { label: "Besluiten & notulen", bronbereik: "binnen uw rechten" },
  dashboard: { label: "Stuurinformatie", bronbereik: "binnen uw rechten" },
  klantbeeld: { label: "Klantbeeld", bronbereik: "binnen uw rechten" },
  home: { label: "Fondsbreed", bronbereik: "binnen uw rechten" },
};

export default function AssistentPaneel({
  navBreedte,
  children,
}: {
  /** Breedte van de zijbalk, zodat volledig scherm links precies aansluit. */
  navBreedte: string;
  children: ReactNode;
}) {
  const {
    stand,
    ingangModule,
    wisIngangModule,
    bediening,
    zetStand,
    sluit,
    vorigPad,
    zetVorigPad,
  } = useAssistentPaneel();
  const context = useAssistentContext();
  const router = useRouter();
  const pad = usePathname();
  const paneelRef = useRef<HTMLElement | null>(null);
  const vorigeStand = useRef<PaneelStand>("dicht");

  const open = stand !== "dicht";

  // Focus verplaatst bij openen naar het paneel — maar alleen op de OVERGANG
  // dicht → open. Bij elke standwissel opnieuw focussen zou de cursor uit het
  // invoerveld trekken terwijl de bestuurder aan het typen is.
  useEffect(() => {
    const wasDicht = vorigeStand.current === "dicht";
    vorigeStand.current = stand;
    if (open && wasDicht) paneelRef.current?.focus();
  }, [stand, open]);

  useEffect(() => {
    if (!open) return;
    function bijToets(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const binnen = paneelRef.current?.contains(document.activeElement);
      if (!binnen) return;
      sluit();
    }
    document.addEventListener("keydown", bijToets);
    return () => document.removeEventListener("keydown", bijToets);
  }, [open, sluit]);

  /**
   * Volledig scherm is de route `/ai`. Een zachte navigatie binnen dezelfde
   * layout: het oppervlak blijft gemount, dus het gesprek loopt door — precies
   * wat de vervallen link "Openen in volledige assistent" niet kon. Winst
   * bovendien: de stand is deelbaar en bookmarkbaar, en `/ai` houdt zijn
   * startpunt (besluit 0085/0088).
   */
  const naarVolledig = useCallback(() => {
    if (pad !== "/ai") {
      zetVorigPad(pad);
      router.push("/ai");
    }
    zetStand("volledig");
  }, [pad, router, zetStand, zetVorigPad]);

  const uitVolledig = useCallback(
    (volgende: PaneelStand) => {
      zetStand(volgende);
      if (pad === "/ai") router.push(vorigPad || "/");
    },
    [pad, router, vorigPad, zetStand]
  );

  const chip = contextChip({
    documentScope: context.documentScope,
    agendapuntContext: context.agendapuntContext,
    moduleScope: context.moduleScope,
  });
  const moduleContext = ingangModule ? MODULE_CONTEXT[ingangModule] : null;
  const getoondeContext =
    chip.label === "Fondsbreed" && moduleContext
      ? { ...moduleContext, losTeLaten: ingangModule !== "home" }
      : chip;

  function laatLos() {
    context.zetDocumentScope(null);
    context.zetAgendapuntContext(null);
    context.zetModuleScope(null);
    context.zetRisicoLijst([]);
    wisIngangModule();
  }

  return (
    <aside
      id="assistent-paneel"
      ref={paneelRef}
      tabIndex={-1}
      hidden={!open}
      data-stand={stand}
      aria-label="Assistent"
      className="assistent-paneel"
      style={{ "--nav-breedte": navBreedte } as React.CSSProperties}
    >
      <header className="assistent-paneel-kop">
        <div className="assistent-identiteit">
          <span className="assistent-identiteit-icoon">
            <Icoon sleutel="sprankel" grootte={19} streek={1.8} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-serif text-[17px] font-medium leading-tight text-white">
              Assistent
            </h2>
            <p className="assistent-kopstatus mt-0.5 flex items-center gap-1.5 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
              <span className="truncate">Context · {getoondeContext.label}</span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={bediening?.nieuwGesprek}
            disabled={!bediening?.nieuwGesprekBeschikbaar}
            aria-label="Nieuw gesprek"
            title="Nieuw gesprek"
            className={`${KNOP} disabled:cursor-not-allowed disabled:opacity-35`}
          >
            <Icoon sleutel="plus" grootte={18} />
          </button>
          <button
            type="button"
            onClick={bediening?.openInstellingen}
            disabled={!bediening}
            aria-label="Gespreksinstellingen"
            title="Gespreksinstellingen"
            className={`${KNOP} disabled:opacity-35`}
          >
            <Icoon sleutel="tandwiel" grootte={17} />
          </button>
          {stand === "paneel" && (
            <button
              type="button"
              onClick={() => zetStand("vergroot")}
              aria-label="Paneel vergroten"
              title="Vergroten"
              className={KNOP}
            >
              <Icoon sleutel="chevron-links" grootte={17} />
            </button>
          )}
          {stand === "vergroot" && (
            <button
              type="button"
              onClick={() => zetStand("paneel")}
              aria-label="Paneel verkleinen"
              title="Verkleinen"
              className={KNOP}
            >
              <Icoon sleutel="chevron-rechts" grootte={17} />
            </button>
          )}
          {stand !== "volledig" ? (
            <button
              type="button"
              onClick={naarVolledig}
              aria-label="Volledig scherm"
              title="Volledig scherm"
              className={KNOP}
            >
              <Icoon sleutel="maximaliseren" grootte={17} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => uitVolledig("vergroot")}
              aria-label="Terug naar het paneel"
              title="Terug naar het paneel"
              className={KNOP}
            >
              <Icoon sleutel="minimaliseren" grootte={17} />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (stand === "volledig" && pad === "/ai") router.push(vorigPad || "/");
              sluit();
            }}
            aria-label="Assistent sluiten"
            title="Sluiten"
            className={KNOP}
          >
            <Icoon sleutel="sluiten" grootte={17} />
          </button>
        </div>
      </header>

      <div className="assistent-contextbalk">
        {/* Assistent-accent (0202): `--ai` op `--ai-tint` haalt 4,95:1, en
            `--ai-line` is de decoratieve rand waar hij voor bedoeld is. */}
        <span className="assistent-contextchip inline-flex min-w-0 shrink-0 items-center gap-2 border border-ai-line bg-ai-tint px-3 py-1.5 text-xs font-semibold text-ai">
          <Icoon sleutel="menu" grootte={14} streek={1.9} />
          <span className="truncate">{getoondeContext.label}</span>
          {getoondeContext.losTeLaten && (
            <button
              type="button"
              onClick={laatLos}
              title="Laat deze context los en vraag fondsbreed verder"
              aria-label={`Context loslaten: ${getoondeContext.label}`}
              className="-mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ai hover:bg-ai/10"
            >
              <Icoon sleutel="sluiten" grootte={12} streek={2} />
            </button>
          )}
        </span>
        <p
          className="ml-auto min-w-0 truncate text-[11px] leading-relaxed text-muted"
          title={getoondeContext.bronbereik}
        >
          {getoondeContext.bronbereik}
        </p>
      </div>

      <div className="assistent-paneel-inhoud">{children}</div>
    </aside>
  );
}
