"use client";

// ============================================================================
//  Contactaanvragen — back-office-UI.
// ----------------------------------------------------------------------------
//  Pure presentatie + filter/expand-state; de ENIGE mutatie (statuswijziging)
//  loopt via de server-action (acties.ts) achter withPlatform. Filterbalk per
//  status, lijst met uitklapbaar detail (volledige inzending) en statusknoppen.
// ============================================================================

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  aanvraagStatusWijzigen,
  type ContactStatus,
  type ContactActieResultaat,
} from "../acties";

export interface ContactAanvraagRij {
  id: string;
  aangemaakt_op: string;
  naam: string;
  organisatie: string;
  rol: string;
  email: string;
  telefoon: string | null;
  type_verzoek: string;
  bericht: string;
  herkomst_pagina: string | null;
  status: ContactStatus;
  notificatie_verzonden: boolean;
  mail_error: string | null;
  opgevolgd_door: string | null;
  afgehandeld_op: string | null;
}

interface Props {
  rijen: ContactAanvraagRij[];
}

type Melding = { soort: "ok" | "fout"; tekst: string } | null;

const STATUS_LABEL: Record<ContactStatus, string> = {
  nieuw: "Nieuw",
  in_behandeling: "In behandeling",
  afgehandeld: "Afgehandeld",
};

const STATUS_STIJL: Record<ContactStatus, string> = {
  nieuw: "bg-amber-100 text-amber-800",
  in_behandeling: "bg-blue-100 text-blue-800",
  afgehandeld: "bg-emerald-100 text-emerald-800",
};

const TYPE_LABEL: Record<string, string> = {
  demo: "Demo",
  pilot: "Pilot",
  vraag: "Vraag",
  samenwerking: "Samenwerking",
};

type Filter = "alle" | ContactStatus;

function formatDatum(d: string): string {
  return new Date(d).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ContactInboxClient({ rijen }: Props) {
  const router = useRouter();
  const [bezig, start] = useTransition();
  const [melding, setMelding] = useState<Melding>(null);
  const [filter, setFilter] = useState<Filter>("alle");
  const [open, setOpen] = useState<string | null>(null);
  const [bezigId, setBezigId] = useState<string | null>(null);

  const tellingen = useMemo(() => {
    const t = { alle: rijen.length, nieuw: 0, in_behandeling: 0, afgehandeld: 0 };
    for (const r of rijen) t[r.status] += 1;
    return t;
  }, [rijen]);

  const zichtbaar = useMemo(
    () => (filter === "alle" ? rijen : rijen.filter((r) => r.status === filter)),
    [rijen, filter]
  );

  function wijzig(id: string, nieuweStatus: ContactStatus) {
    setMelding(null);
    setBezigId(id);
    start(async () => {
      const r: ContactActieResultaat = await aanvraagStatusWijzigen({
        aanvraagId: id,
        nieuweStatus,
      });
      if (r.ok) {
        setMelding({ soort: "ok", tekst: r.bericht });
        router.refresh();
      } else {
        setMelding({ soort: "fout", tekst: r.melding });
      }
      setBezigId(null);
    });
  }

  const filters: { key: Filter; label: string; aantal: number }[] = [
    { key: "alle", label: "Alle", aantal: tellingen.alle },
    { key: "nieuw", label: "Nieuw", aantal: tellingen.nieuw },
    { key: "in_behandeling", label: "In behandeling", aantal: tellingen.in_behandeling },
    { key: "afgehandeld", label: "Afgehandeld", aantal: tellingen.afgehandeld },
  ];

  return (
    <div className="space-y-4">
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

      {/* Filterbalk */}
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
              (filter === f.key
                ? "bg-accent text-white"
                : "bg-app-bg text-ink hover:bg-accent/10")
            }
          >
            {f.label}{" "}
            <span className={filter === f.key ? "text-white/70" : "text-ink/50"}>
              {f.aantal}
            </span>
          </button>
        ))}
      </div>

      {zichtbaar.length === 0 ? (
        <p className="rounded-lg border border-line bg-white px-4 py-6 text-center text-sm text-ink/60">
          Geen aanvragen in deze weergave.
        </p>
      ) : (
        <ul className="space-y-2">
          {zichtbaar.map((r) => {
            const isOpen = open === r.id;
            const rijBezig = bezig && bezigId === r.id;
            return (
              <li
                key={r.id}
                className="overflow-hidden rounded-xl border border-line bg-white"
              >
                {/* Kop — klikbaar om uit te klappen */}
                <button
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-app-bg/60"
                >
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-xs font-medium " +
                      STATUS_STIJL[r.status]
                    }
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {r.naam}
                      <span className="font-normal text-ink/60">
                        {" "}
                        &middot; {r.organisatie}
                      </span>
                    </div>
                    <div className="truncate text-xs text-ink/60">
                      {TYPE_LABEL[r.type_verzoek] ?? r.type_verzoek} &middot;{" "}
                      {formatDatum(r.aangemaakt_op)}
                    </div>
                  </div>
                  {!r.notificatie_verzonden && (
                    <span
                      title="Notificatiemail niet verzonden"
                      className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
                    >
                      mail mislukt
                    </span>
                  )}
                  <span className="text-ink/40">{isOpen ? "▴" : "▾"}</span>
                </button>

                {/* Detail */}
                {isOpen && (
                  <div className="border-t border-line px-4 py-4">
                    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                      <Veld label="Naam" waarde={r.naam} />
                      <Veld label="Organisatie" waarde={r.organisatie} />
                      <Veld label="Rol" waarde={r.rol} />
                      <Veld
                        label="E-mail"
                        waarde={
                          <a
                            href={`mailto:${r.email}`}
                            className="text-ink underline hover:text-accent"
                          >
                            {r.email}
                          </a>
                        }
                      />
                      <Veld label="Telefoon" waarde={r.telefoon || "—"} />
                      <Veld
                        label="Type verzoek"
                        waarde={TYPE_LABEL[r.type_verzoek] ?? r.type_verzoek}
                      />
                      <Veld label="Herkomst" waarde={r.herkomst_pagina || "—"} />
                      <Veld label="Ontvangen" waarde={formatDatum(r.aangemaakt_op)} />
                      <Veld
                        label="Opgevolgd door"
                        waarde={r.opgevolgd_door || "—"}
                      />
                      <Veld
                        label="Afgehandeld op"
                        waarde={r.afgehandeld_op ? formatDatum(r.afgehandeld_op) : "—"}
                      />
                    </dl>

                    <div className="mt-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                        Bericht
                      </div>
                      <p className="mt-1 whitespace-pre-wrap rounded-lg bg-app-bg px-3 py-2 text-sm text-ink">
                        {r.bericht}
                      </p>
                    </div>

                    {r.mail_error && (
                      <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                        Notificatie soft-fail: {r.mail_error}
                      </p>
                    )}

                    {/* Statusacties — toon alleen de andere twee statussen */}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-ink/60">
                        Status zetten op:
                      </span>
                      {(["nieuw", "in_behandeling", "afgehandeld"] as ContactStatus[])
                        .filter((s) => s !== r.status)
                        .map((s) => (
                          <button
                            key={s}
                            disabled={rijBezig}
                            onClick={() => wijzig(r.id, s)}
                            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-accent hover:bg-app-bg disabled:opacity-50"
                          >
                            {STATUS_LABEL[s]}
                          </button>
                        ))}
                      {rijBezig && (
                        <span className="text-xs text-ink/50">bezig…</span>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Veld({ label, waarde }: { label: string; waarde: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
        {label}
      </dt>
      <dd className="text-ink">{waarde}</dd>
    </div>
  );
}
