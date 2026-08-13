// Procesfasen-rail (WO-2, §7) — parallel-by-default.
//
// De rail groepeert de stappen per fase (D8) en toont per fase een
// FaseBeschrijving-kop (status-pill + dekkingsmeter + beschrijving). Anders dan
// de oude sequentiële rail kunnen MEERDERE stappen tegelijk 'actief'/'heropend'
// zijn — elk krijgt een eigen actief-markering. Het invaarproces kent geen
// blokkerende afhankelijkheden, dus geen harde-gate-weergave.
//
// Presentatie-only server-component: klikken opent de stap in het
// rechterpaneel via ?stap=<id> (server-first, past bij force-dynamic +
// router.refresh()).

import Link from "next/link";
import type { Stap } from "../[id]/page";
import FaseBeschrijving from "./FaseBeschrijving";
import type {
  FaseStatus,
  AandachtNiveau,
  Dekking,
} from "@/core/lib/procedure-fase-status";

export interface FaseGroep {
  fase_code: string;
  titel: string;
  beschrijving: string | null;
  is_override: boolean;
  status: FaseStatus;
  dekking: Dekking;
  aandacht: AandachtNiveau;
  stappen: Stap[];
}

function formatDatumKort(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
  });
}

function StapItem({
  s,
  isLaatste,
  geselecteerd,
}: {
  s: Stap;
  isLaatste: boolean;
  geselecteerd: boolean;
}) {
  const isAfgerond = s.status === "afgerond";
  // 'heropend' telt als actief (§4.3); beide krijgen de amber-markering.
  const isActief = s.status === "actief" || s.status === "heropend";
  const isHeropend = s.status === "heropend";
  const isGeblokkeerd = s.status === "geblokkeerd";

  return (
    <li>
      <Link
        href={`?stap=${s.id}`}
        scroll={false}
        replace
        aria-current={geselecteerd ? "step" : undefined}
        className={`relative block -mx-3 px-3 pl-9 py-2.5 rounded-lg transition-colors ${
          isActief
            ? "bg-warn-tint"
            : geselecteerd
              ? "bg-app-bg ring-1 ring-app-line-strong"
              : "hover:bg-app-bg/70"
        }`}
      >
        {isAfgerond ? (
          <div className="absolute left-3 top-3 w-6 h-6 rounded-full bg-ok text-white flex items-center justify-center text-xs font-bold">
            ✓
          </div>
        ) : isActief ? (
          <div className="absolute left-3 top-3 w-6 h-6 rounded-full bg-accent border-2 border-accent text-white flex items-center justify-center text-xs font-bold ring-4 ring-warn/30">
            {s.volgorde}
          </div>
        ) : (
          <div className="absolute left-3 top-3 w-6 h-6 rounded-full bg-app-bg border-2 border-app-line-strong text-muted flex items-center justify-center text-xs font-medium">
            {s.volgorde}
          </div>
        )}
        {!isLaatste && (
          <div
            className={`absolute left-6 top-9 bottom-0 w-px ${
              isAfgerond ? "bg-ok" : "bg-app-line"
            }`}
          />
        )}
        <div className="ml-6">
          <div
            className={`text-sm ${
              isActief
                ? "font-semibold text-ink"
                : isAfgerond
                  ? "font-medium text-ink"
                  : "font-medium text-muted"
            }`}
          >
            {s.naam}
          </div>

          {/* herbevestiging_nodig — zichtbaar, niet-blokkerend signaal (§4.3):
              controleer of deze (afgeronde) stap nog klopt na een heropening
              elders. Kan op elke status staan. */}
          {s.herbevestiging_nodig && (
            <span className="inline-block mt-1 text-[10px] font-medium uppercase tracking-wide text-warn-ink bg-warn-tint border border-warn/30 px-1.5 py-0.5 rounded">
              Herbevestiging nodig
            </span>
          )}

          {isAfgerond && (
            <div className="text-xs text-muted mt-0.5">
              {s.voltooid_op
                ? `Afgerond ${formatDatumKort(s.voltooid_op)}`
                : "Afgerond"}
            </div>
          )}
          {isActief && (
            <div className="text-xs text-warn-ink font-medium mt-0.5">
              {isHeropend ? "Heropend" : "Actief"}
              {s.deadline ? ` — deadline ${formatDatumKort(s.deadline)}` : ""}
            </div>
          )}
          {isGeblokkeerd && (
            <div className="text-xs text-muted mt-0.5">
              Wacht op eerdere stap
            </div>
          )}
          {s.status === "open" && s.vereist_besluit && (
            <div className="text-xs text-warn-ink mt-0.5">
              Vereist formeel besluit
            </div>
          )}
          {s.status === "open" &&
            !s.vereist_besluit &&
            s.geschatte_dagen && (
              <div className="text-xs text-muted mt-0.5">
                Geschat {s.geschatte_dagen} dagen
              </div>
            )}
        </div>
      </Link>
    </li>
  );
}

export default function FaseRail({
  fasen,
  geselecteerdeStapId,
}: {
  fasen: FaseGroep[];
  geselecteerdeStapId: string | null;
}) {
  return (
    <div className="space-y-4">
      {fasen.map((f) => (
        <div key={f.fase_code}>
          <FaseBeschrijving
            faseCode={f.fase_code}
            titel={f.titel}
            beschrijving={f.beschrijving}
            isOverride={f.is_override}
            status={f.status}
            dekking={f.dekking}
            aandacht={f.aandacht}
          />
          <ol className="space-y-1">
            {f.stappen.map((s, idx) => (
              <StapItem
                key={s.id}
                s={s}
                isLaatste={idx === f.stappen.length - 1}
                geselecteerd={s.id === geselecteerdeStapId}
              />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
