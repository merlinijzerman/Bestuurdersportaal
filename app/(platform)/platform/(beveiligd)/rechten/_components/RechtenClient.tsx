"use client";

// ============================================================================
//  Identiteiten & rechten — beheer-UI (Increment P3/B14, TO §4.3).
// ----------------------------------------------------------------------------
//  Pure presentatie + formulierstate; ALLE mutaties lopen via de server-actions
//  (acties.ts) achter withPlatform. Per identiteit: actieve capabilities (chips)
//  met intrekken, en een formulier om een niet-zware capability toe te kennen.
//  Toekennen én intrekken dragen een VERPLICHTE reden (governance, append-only
//  geaudit).
// ============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  capabilityToekennen,
  capabilityIntrekken,
  type RechtenResultaat,
} from "../acties";

export interface ToekenbareCap {
  capability: string;
  label: string;
}

export interface IdentiteitMetRechten {
  id: string;
  email: string;
  naam: string;
  actief: boolean;
  isZelf: boolean;
  capabilities: { capability: string; label: string; zwaar: boolean }[];
}

interface Props {
  identiteiten: IdentiteitMetRechten[];
  toekenbareCaps: ToekenbareCap[];
  magToekennen: boolean;
  magIntrekken: boolean;
}

type Melding = { soort: "ok" | "fout"; tekst: string } | null;

export default function RechtenClient({
  identiteiten,
  toekenbareCaps,
  magToekennen,
  magIntrekken,
}: Props) {
  const router = useRouter();
  const [bezig, start] = useTransition();
  const [melding, setMelding] = useState<Melding>(null);

  function verwerk(actie: () => Promise<RechtenResultaat>, naSucces?: () => void) {
    setMelding(null);
    start(async () => {
      const r = await actie();
      if (r.ok) {
        setMelding({ soort: "ok", tekst: r.bericht });
        naSucces?.();
        router.refresh();
      } else {
        setMelding({ soort: "fout", tekst: r.melding });
      }
    });
  }

  if (identiteiten.length === 0) {
    return (
      <p className="text-sm text-[#0F2744]/60">
        Geen platform-identiteiten gevonden.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {melding && (
        <div
          className={
            "rounded-lg px-4 py-2 text-sm " +
            (melding.soort === "ok"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-800")
          }
        >
          {melding.tekst}
        </div>
      )}

      <ul className="space-y-4">
        {identiteiten.map((i) => (
          <IdentiteitKaart
            key={i.id}
            identiteit={i}
            toekenbareCaps={toekenbareCaps}
            magToekennen={magToekennen}
            magIntrekken={magIntrekken}
            bezig={bezig}
            onToekennen={(capability, reden, reset) =>
              verwerk(
                () => capabilityToekennen({ identityId: i.id, capability, reden }),
                reset
              )
            }
            onIntrekken={(capability, reden) =>
              verwerk(() => capabilityIntrekken({ identityId: i.id, capability, reden }))
            }
          />
        ))}
      </ul>
    </div>
  );
}

// ── Identiteitskaart ──────────────────────────────────────────────────────────
function IdentiteitKaart({
  identiteit,
  toekenbareCaps,
  magToekennen,
  magIntrekken,
  bezig,
  onToekennen,
  onIntrekken,
}: {
  identiteit: IdentiteitMetRechten;
  toekenbareCaps: ToekenbareCap[];
  magToekennen: boolean;
  magIntrekken: boolean;
  bezig: boolean;
  onToekennen: (capability: string, reden: string, reset: () => void) => void;
  onIntrekken: (capability: string, reden: string) => void;
}) {
  const reedsToegekend = new Set(identiteit.capabilities.map((c) => c.capability));
  const beschikbaar = toekenbareCaps.filter((c) => !reedsToegekend.has(c.capability));

  return (
    <li className="rounded-xl border border-[#0F2744]/10 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-[#0F2744]">{identiteit.naam}</span>
            {identiteit.isZelf && (
              <span className="rounded-full bg-[#F0F3F8] px-2 py-0.5 text-xs text-[#0F2744]/70">
                jij
              </span>
            )}
            {!identiteit.actief && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                geblokkeerd
              </span>
            )}
          </div>
          <p className="text-sm text-[#0F2744]/60">{identiteit.email}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[#0F2744]/50">
          Capabilities ({identiteit.capabilities.length})
        </p>
        {identiteit.capabilities.length === 0 ? (
          <p className="mt-2 text-sm text-[#0F2744]/50">Geen capabilities.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {identiteit.capabilities.map((c) => (
              <CapChip
                key={c.capability}
                cap={c}
                magIntrekken={magIntrekken}
                bezig={bezig}
                onIntrekken={(reden) => onIntrekken(c.capability, reden)}
              />
            ))}
          </ul>
        )}
      </div>

      {magToekennen && (
        <ToekenFormulier
          beschikbaar={beschikbaar}
          isZelf={identiteit.isZelf}
          actief={identiteit.actief}
          bezig={bezig}
          onToekennen={onToekennen}
        />
      )}
    </li>
  );
}

// ── Capability-chip met intrekken ─────────────────────────────────────────────
function CapChip({
  cap,
  magIntrekken,
  bezig,
  onIntrekken,
}: {
  cap: { capability: string; label: string; zwaar: boolean };
  magIntrekken: boolean;
  bezig: boolean;
  onIntrekken: (reden: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reden, setReden] = useState("");

  return (
    <li className="rounded-lg bg-[#F0F3F8] px-3 py-1.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-[#0F2744]">{cap.label}</span>
        {cap.zwaar && (
          <span
            title="Zware capability"
            className="rounded-full bg-[#C9A84C]/20 px-1.5 py-0.5 text-[10px] font-medium text-[#0F2744]"
          >
            zwaar
          </span>
        )}
        {magIntrekken && !open && (
          <button
            type="button"
            disabled={bezig}
            onClick={() => setOpen(true)}
            className="text-xs text-red-700 hover:underline disabled:opacity-50"
          >
            intrekken
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={reden}
            onChange={(e) => setReden(e.target.value)}
            placeholder="Reden (verplicht)"
            className="w-44 rounded border border-[#0F2744]/15 bg-white px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={bezig || reden.trim().length === 0}
            onClick={() => {
              onIntrekken(reden.trim());
              setOpen(false);
              setReden("");
            }}
            className="rounded bg-red-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
          >
            Bevestig
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setReden("");
            }}
            className="text-xs text-[#0F2744]/60 hover:underline"
          >
            annuleer
          </button>
        </div>
      )}
    </li>
  );
}

// ── Toekennen ─────────────────────────────────────────────────────────────────
function ToekenFormulier({
  beschikbaar,
  isZelf,
  actief,
  bezig,
  onToekennen,
}: {
  beschikbaar: ToekenbareCap[];
  isZelf: boolean;
  actief: boolean;
  bezig: boolean;
  onToekennen: (capability: string, reden: string, reset: () => void) => void;
}) {
  const [capability, setCapability] = useState(beschikbaar[0]?.capability ?? "");
  const [reden, setReden] = useState("");

  function reset() {
    setReden("");
    setCapability(beschikbaar[0]?.capability ?? "");
  }

  if (isZelf) {
    return (
      <p className="mt-4 border-t border-[#0F2744]/5 pt-3 text-xs text-[#0F2744]/50">
        Je kunt jezelf geen capabilities toekennen (functiescheiding).
      </p>
    );
  }
  if (!actief) {
    return (
      <p className="mt-4 border-t border-[#0F2744]/5 pt-3 text-xs text-[#0F2744]/50">
        Identiteit is geblokkeerd; toekennen is niet mogelijk.
      </p>
    );
  }
  if (beschikbaar.length === 0) {
    return (
      <p className="mt-4 border-t border-[#0F2744]/5 pt-3 text-xs text-[#0F2744]/50">
        Alle toekenbare capabilities zijn al toegekend.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!capability || reden.trim().length === 0) return;
        onToekennen(capability, reden.trim(), reset);
      }}
      className="mt-4 flex flex-wrap items-end gap-3 border-t border-[#0F2744]/5 pt-4"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[#0F2744]/60">Capability</span>
        <select
          value={capability}
          onChange={(e) => setCapability(e.target.value)}
          className="rounded-lg border border-[#0F2744]/15 bg-white px-3 py-1.5 text-sm"
        >
          {beschikbaar.map((c) => (
            <option key={c.capability} value={c.capability}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-xs font-medium text-[#0F2744]/60">
          Reden (verplicht)
        </span>
        <input
          value={reden}
          onChange={(e) => setReden(e.target.value)}
          placeholder="bv. Toegang n.a.v. functiewijziging / besluit"
          className="w-full min-w-48 rounded-lg border border-[#0F2744]/15 bg-white px-3 py-1.5 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={bezig || !capability || reden.trim().length === 0}
        className="rounded-lg bg-[#0F2744] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
      >
        Toekennen
      </button>
    </form>
  );
}
