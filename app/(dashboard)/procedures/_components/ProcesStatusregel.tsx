// Tellerregel voor het procesoverzicht (WO-2, §7.1) — pure presentatie.
//
// "X/N stappen afgerond · Y% verplichte bewijslast sluitend · <aandachtspunten>".
// 'Verplichte bewijslast sluitend' telt template- én handmatig toegevoegde
// vereisten (D7c-unie). Aandachtspunten zijn een orthogonaal signaal met
// kleur+woord+vorm (stip).

import type { AandachtNiveau } from "@/core/lib/procedure-fase-status";

export interface Aandachtspunt {
  /** 'ok' voor een positief signaal (bv. besluitrijp). */
  niveau: AandachtNiveau | "ok";
  tekst: string;
}

const STIP_KLEUR: Record<string, string> = {
  rood: "bg-err",
  oranje: "bg-warn",
  ok: "bg-ok",
  geen: "bg-app-line",
};

const TEKST_KLEUR: Record<string, string> = {
  rood: "text-err-ink font-medium",
  oranje: "text-warn-ink",
  ok: "text-ok-ink font-medium",
  geen: "text-muted",
};

interface Props {
  stappenAfgerond: number;
  stappenTotaal: number;
  /** null → geen dossier/decision, bewijslast niet af te leiden. */
  bewijslastPct: number | null;
  aandachtspunten: Aandachtspunt[];
}

export default function ProcesStatusregel({
  stappenAfgerond,
  stappenTotaal,
  bewijslastPct,
  aandachtspunten,
}: Props) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted flex-wrap">
      <span>
        <b className="text-ink">
          {stappenAfgerond}/{stappenTotaal}
        </b>{" "}
        stappen afgerond
      </span>
      <span aria-hidden>·</span>
      <span>
        {bewijslastPct === null ? (
          <>verplichte bewijslast n.n.b.</>
        ) : (
          <>
            <b className="text-ink">{bewijslastPct}%</b> verplichte bewijslast
            sluitend
          </>
        )}
      </span>
      {aandachtspunten.map((a, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                STIP_KLEUR[a.niveau] ?? STIP_KLEUR.geen
              }`}
            />
            <span className={TEKST_KLEUR[a.niveau] ?? TEKST_KLEUR.geen}>
              {a.tekst}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}
