"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/klantbeeld/deelnemers", label: "Deelnemers", aantal: "52.140" },
  { href: "/klantbeeld/werkgevers", label: "Werkgevers", aantal: "387" },
];

export function HoofdTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-6 mt-6 border-b border-gray-200 -mb-px">
      {TABS.map((t) => {
        const actief = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-1 pb-3 border-b-2 text-sm transition-colors ${
              actief
                ? "border-[#C9A84C] text-[#0F2744] font-semibold"
                : "border-transparent text-gray-600 hover:text-[#0F2744]"
            }`}
          >
            {t.label}
            <span className="ml-1 text-[11px] text-gray-400 font-normal">{t.aantal}</span>
          </Link>
        );
      })}
    </div>
  );
}

const DEELNEMERS_SUBS = [
  { href: "/klantbeeld/deelnemers", label: "Maand-ontwikkeling" },
  { href: "/klantbeeld/deelnemers/cohorten", label: "Cohorten naast elkaar" },
];

export function DeelnemersSubTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit text-sm">
      {DEELNEMERS_SUBS.map((t) => {
        const actief = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-4 py-2 rounded-md transition-colors ${
              actief
                ? "bg-[#0F2744] text-white"
                : "text-gray-700 hover:text-[#0F2744]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
