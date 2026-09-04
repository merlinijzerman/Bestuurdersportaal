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
//  VergaderingenLijst — besluit 0145
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

function datumTegel(d: string) {
  const datum = new Date(d);
  return {
    dag: datum.toLocaleDateString("nl-NL", { day: "2-digit" }),
    maand: datum
      .toLocaleDateString("nl-NL", { month: "short" })
      .replace(".", ""),
  };
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
    <div className="space-y-5">
      {fout && (
        <div className="rounded-lg border border-err/30 bg-err-tint px-4 py-3 text-sm text-err-ink">
          {fout}
        </div>
      )}

      <section className="portal-card overflow-hidden">
        <div className="portal-card-header">
          <h2 className="portal-card-title">Komend</h2>
          <span className="portal-status-pill border border-line bg-app-surface text-muted">
            {komend.length}
          </span>
        </div>
        {komend.length === 0 ? (
          <div className="m-4 portal-empty">
            Nog geen geplande vergaderingen. Maak hierboven een nieuwe vergadering aan.
          </div>
        ) : (
          <div className="divide-y divide-line">
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
        <section className="portal-card overflow-hidden">
          <div className="portal-card-header">
            <h2 className="portal-card-title">Afgelopen</h2>
            <span className="portal-status-pill border border-line bg-app-surface text-muted">
              {afgelopen.length}
            </span>
          </div>
          <div className="divide-y divide-line">
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
        <section className="portal-card overflow-hidden">
          <button
            type="button"
            onClick={() => setArchiefOpen((o) => !o)}
            aria-expanded={archiefOpen}
            className="portal-card-header w-full text-left transition-colors hover:bg-app-zebra"
          >
            <span
              className={`text-[10px] text-muted transition-transform ${
                archiefOpen ? "" : "-rotate-90"
              }`}
            >
              ▼
            </span>
            <span className="portal-card-title">Gearchiveerd</span>
            <span className="portal-status-pill border border-line bg-app-surface text-muted">
              {gearchiveerd.length}
            </span>
            <span className="ml-auto text-[11.5px] text-muted">
              {archiefOpen ? "Verbergen" : "Tonen"}
            </span>
          </button>
          {archiefOpen && (
            <div className="divide-y divide-line border-t border-line">
              <p className="px-[1.125rem] py-3 text-[11.5px] text-muted">
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
  const tegel = datumTegel(v.datum);

  return (
    <div
      className={`portal-row portal-row-interactive ${
        gedempt ? "opacity-75" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/vergaderingen/${v.id}`}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <span className="portal-date-tile" aria-hidden>
            <span className="font-serif text-base font-semibold leading-none">
              {tegel.dag}
            </span>
            <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider">
              {tegel.maand}
            </span>
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">{v.titel}</span>
            <span className="mt-1 block text-xs text-muted">
              {formatDatum(v.datum)}
              {v.locatie ? ` · ${v.locatie}` : ""}
            </span>
          </span>
        </Link>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className={`portal-status-pill ${badge.klas}`}>
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
