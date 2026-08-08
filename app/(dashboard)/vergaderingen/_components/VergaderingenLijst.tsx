"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  splitsVergaderingen,
  magArchiveren,
  type VergaderingArchiefToestand,
} from "@/core/lib/vergadering-archief";

// ============================================================================
//  VergaderingenLijst — besluit 0141
// ----------------------------------------------------------------------------
//  De lijst stond eerder volledig in de server-component. Archiveren en het
//  uitklapbare archiefblok vragen interactie, dus de WEERGAVE verhuist hierheen;
//  het OPHALEN blijft server-side (RLS, geen extra roundtrip).
//
//  Wat hier verdwijnt: `afgelopen.slice(0, 10)`. Dat was een stille cap —
//  vergadering 11 en verder waren onvindbaar zonder dat er iets op het scherm
//  stond. Nu is de lijst volledig en is archiveren de expliciete manier om hem
//  kort te houden.
// ============================================================================

export interface VergaderingRij extends VergaderingArchiefToestand {
  id: string;
  titel: string;
  locatie: string | null;
  status: "gepland" | "in_voorbereiding" | "afgerond";
}

const STATUS_BADGE: Record<string, { klas: string; label: string }> = {
  gepland: { klas: "bg-accent-tint text-accent-ink", label: "Gepland" },
  in_voorbereiding: { klas: "bg-warn-tint text-warn-ink", label: "In voorbereiding" },
  afgerond: { klas: "bg-app-bg text-muted", label: "Afgerond" },
};

function formatDatum(d: string) {
  return new Date(d).toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VergaderingenLijst({ lijst }: { lijst: VergaderingRij[] }) {
  const router = useRouter();
  const [archiefOpen, setArchiefOpen] = useState(false);
  const [bezigId, setBezigId] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const { komend, afgelopen, gearchiveerd } = splitsVergaderingen(lijst);

  async function zetArchief(id: string, actie: "archiveren" | "terughalen") {
    setBezigId(id);
    setFout(null);
    try {
      const res = await fetch(`/api/vergaderingen/${id}/archief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actie }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Actie mislukt");
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Actie mislukt");
    } finally {
      setBezigId(null);
    }
  }

  return (
    <div className="space-y-6">
      {fout && (
        <div className="rounded-lg border border-err/30 bg-err-tint px-4 py-3 text-sm text-err-ink">
          {fout}
        </div>
      )}

      <section>
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
          Komend ({komend.length})
        </div>
        {komend.length === 0 ? (
          <div className="rounded-xl border border-dashed border-app-line-strong bg-app-surface p-8 text-center text-sm text-muted">
            Nog geen geplande vergaderingen. Maak hierboven een nieuwe vergadering aan.
          </div>
        ) : (
          <div className="space-y-2">
            {komend.map((v) => (
              <Kaart
                key={v.id}
                v={v}
                bezig={bezigId === v.id}
                onArchiveer={() => zetArchief(v.id, "archiveren")}
              />
            ))}
          </div>
        )}
      </section>

      {afgelopen.length > 0 && (
        <section>
          <div className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
            Afgelopen ({afgelopen.length})
          </div>
          <div className="space-y-2">
            {afgelopen.map((v) => (
              <Kaart
                key={v.id}
                v={v}
                gedempt
                bezig={bezigId === v.id}
                onArchiveer={() => zetArchief(v.id, "archiveren")}
              />
            ))}
          </div>
        </section>
      )}

      {/* Archief — ingeklapt in rust. Het blok verschijnt alleen als er iets in
          zit; een leeg "Gearchiveerd (0)" is ruis. */}
      {gearchiveerd.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setArchiefOpen((o) => !o)}
            aria-expanded={archiefOpen}
            className="flex w-full items-center gap-2 rounded-xl border border-line bg-app-surface px-4 py-3 text-left transition-colors hover:border-accent"
          >
            <span
              className={`text-[10px] text-muted transition-transform ${
                archiefOpen ? "" : "-rotate-90"
              }`}
            >
              ▼
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-muted">
              Gearchiveerd
            </span>
            <span className="rounded-full border border-line bg-app-bg px-2 py-0.5 text-[11px] font-semibold text-muted">
              {gearchiveerd.length}
            </span>
            <span className="ml-auto text-[11.5px] text-muted">
              {archiefOpen ? "Verbergen" : "Tonen"}
            </span>
          </button>
          {archiefOpen && (
            <div className="mt-2 space-y-2">
              <p className="px-1 text-[11.5px] text-muted">
                Gearchiveerde vergaderingen blijven volledig raadpleegbaar — inclusief
                agendapunten, stukken en besluiten. Archiveren verwijdert niets en is
                omkeerbaar.
              </p>
              {gearchiveerd.map((v) => (
                <Kaart
                  key={v.id}
                  v={v}
                  gedempt
                  bezig={bezigId === v.id}
                  onTerughalen={() => zetArchief(v.id, "terughalen")}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Kaart({
  v,
  gedempt,
  bezig,
  onArchiveer,
  onTerughalen,
}: {
  v: VergaderingRij;
  gedempt?: boolean;
  bezig: boolean;
  onArchiveer?: () => void;
  onTerughalen?: () => void;
}) {
  const badge = STATUS_BADGE[v.status] ?? STATUS_BADGE.in_voorbereiding;
  // De knop verschijnt alleen als archiveren daadwerkelijk MAG. UX-principe
  // "maak vereisten en blokkers expliciet": bij een komende vergadering tonen we
  // geen knop die een foutmelding oplevert, maar helemaal geen knop.
  const archiveerbaar = onArchiveer && magArchiveren(v).mag;

  return (
    <div
      className={`rounded-xl border border-line bg-app-surface transition-colors hover:border-accent ${
        gedempt ? "opacity-75" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <Link href={`/vergaderingen/${v.id}`} className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">{v.titel}</div>
          <div className="mt-1 text-xs text-muted">
            {formatDatum(v.datum)}
            {v.locatie ? ` · ${v.locatie}` : ""}
          </div>
        </Link>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${badge.klas}`}>
            {badge.label}
          </span>
          {archiveerbaar && (
            <button
              type="button"
              onClick={onArchiveer}
              disabled={bezig}
              title="Uit de lijst halen. De vergadering blijft volledig raadpleegbaar onder Gearchiveerd."
              className="rounded-lg border border-app-line-control px-2.5 py-1 text-xs font-semibold text-accent-ink transition-colors hover:bg-app-zebra disabled:opacity-50"
            >
              {bezig ? "Bezig…" : "Archiveren"}
            </button>
          )}
          {onTerughalen && (
            <button
              type="button"
              onClick={onTerughalen}
              disabled={bezig}
              title="Terugzetten in de gewone lijst."
              className="rounded-lg border border-app-line-control px-2.5 py-1 text-xs font-semibold text-accent-ink transition-colors hover:bg-app-zebra disabled:opacity-50"
            >
              {bezig ? "Bezig…" : "Terughalen"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
