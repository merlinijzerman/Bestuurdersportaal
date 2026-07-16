import Link from "next/link";

// ============================================================
//  Tab-navigatie bestuurdersdashboard (T13) — server component.
//  Zeven tabs conform het AZL-lijn-prototype; Balans (T13), Spreiding en
//  Solidariteit (T15) zijn gebouwd, de overige vier zijn server-side gegate
//  placeholders ([tab]/page.tsx).
//  De actieve tab komt als prop mee (elke tab is een eigen route); de
//  ?periode-parameter reist mee in de links zodat de paginabrede
//  periodefilter zijn keuze niet verliest bij tab-wissel.
// ============================================================

export const STUURINFO_TABS = [
  { key: "balans", nummer: 1, label: "Balans", href: "/dashboard" },
  { key: "rendement", nummer: 2, label: "Toekenning rendementen", href: "/dashboard/rendement" },
  { key: "biometrie", nummer: 3, label: "Biometrische rendementen", href: "/dashboard/biometrie" },
  { key: "spreiding", nummer: 4, label: "Spreidingsbeleid", href: "/dashboard/spreiding" },
  { key: "solidariteit", nummer: 5, label: "Solidariteitsbeleid", href: "/dashboard/solidariteit" },
  { key: "operationeel", nummer: 6, label: "Operationeel beleid", href: "/dashboard/operationeel" },
  { key: "premie", nummer: 7, label: "Premie- & compensatiebeleid", href: "/dashboard/premie" },
] as const;

export type StuurinfoTabKey = (typeof STUURINFO_TABS)[number]["key"];

export function StuurinfoTabs({ actief, periode }: { actief: StuurinfoTabKey; periode?: string }) {
  const suffix = periode ? `?periode=${encodeURIComponent(periode)}` : "";
  return (
    <div className="flex gap-1 flex-wrap border-b border-line -mb-px">
      {STUURINFO_TABS.map((t) => {
        const isActief = t.key === actief;
        return (
          <Link
            key={t.key}
            href={`${t.href}${suffix}`}
            className={`inline-flex items-center gap-2 px-3 pb-2.5 pt-1 border-b-2 text-sm transition-colors ${
              isActief
                ? "border-accent text-ink font-semibold"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full text-[11px] inline-flex items-center justify-center ${
                isActief ? "bg-accent text-white" : "bg-app-bg text-muted"
              }`}
            >
              {t.nummer}
            </span>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
