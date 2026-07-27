"use client";

// ============================================================================
//  Tenant-gebruikers — beheer-UI (Increment P3-B, FO §10).
// ----------------------------------------------------------------------------
//  Pure presentatie + formulierstate; ALLE mutaties lopen via de server-actions
//  (acties.ts) achter withPlatform. Fonds is een expliciete keuze; aanmaken kent
//  een BEVESTIGINGSSTAP die het doelfonds voluit toont (naam + slug), conform het
//  UX-principe "maak vereisten en blokkers expliciet". Reden is overal verplicht.
//
//  Het wachtwoord leeft uitsluitend in de client-state tot verzending en gaat
//  alleen naar gebruikerAanmaken(); het wordt nooit teruggetoond na aanmaak.
// ============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  gebruikerAanmaken,
  rolWijzigen,
  gebruikerBlokkeren,
  gebruikerDeblokkeren,
} from "../acties";
import {
  TENANT_ROLLEN,
  ROL_LABEL,
  MIN_WACHTWOORD_LENGTE,
  type TenantRol,
  type GebruikersResultaat,
} from "../gedeeld";

export interface FondsOptie {
  id: string;
  naam: string;
  slug: string;
}

export interface TenantGebruiker {
  id: string;
  naam: string;
  rol: TenantRol;
  email: string;
  emailBevestigd: boolean;
  laatsteLogin: string | null;
  geblokkeerd: boolean;
  aangemaakt: string | null;
}

interface Props {
  fondsen: FondsOptie[];
  gekozenFondsId: string | null;
  gebruikers: TenantGebruiker[];
}

type Melding = { soort: "ok" | "fout"; tekst: string } | null;

function datum(s: string | null): string {
  if (!s) return "—";
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function GebruikersClient({ fondsen, gekozenFondsId, gebruikers }: Props) {
  const router = useRouter();
  const [bezig, start] = useTransition();
  const [melding, setMelding] = useState<Melding>(null);

  const gekozenFonds = fondsen.find((f) => f.id === gekozenFondsId) ?? null;

  function verwerk(actie: () => Promise<GebruikersResultaat>, naSucces?: () => void) {
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

  function kiesFonds(id: string) {
    setMelding(null);
    router.push(id ? `/platform/gebruikers?fonds=${encodeURIComponent(id)}` : "/platform/gebruikers");
  }

  return (
    <div className="space-y-5">
      {/* Fondskiezer — expliciet, geen voorselectie. */}
      <div className="rounded-xl border border-line bg-white p-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-ink/50">Fonds</span>
          <select
            value={gekozenFondsId ?? ""}
            onChange={(e) => kiesFonds(e.target.value)}
            className="max-w-md rounded-lg border border-line bg-white px-3 py-2 text-sm"
          >
            <option value="">— Kies een fonds —</option>
            {fondsen.map((f) => (
              <option key={f.id} value={f.id}>
                {f.naam} ({f.slug})
              </option>
            ))}
          </select>
        </label>
      </div>

      {melding && (
        <div
          className={
            "rounded-lg px-4 py-2 text-sm " +
            (melding.soort === "ok" ? "bg-ok-tint text-ok-ink" : "bg-err-tint text-err-ink")
          }
        >
          {melding.tekst}
        </div>
      )}

      {!gekozenFonds ? (
        <p className="text-sm text-ink/60">Kies een fonds om de gebruikers te zien en te beheren.</p>
      ) : (
        <>
          <AanmaakFormulier
            fonds={gekozenFonds}
            bezig={bezig}
            onAanmaken={(invoer, reset) =>
              verwerk(() => gebruikerAanmaken({ fondsId: gekozenFonds.id, ...invoer }), reset)
            }
          />

          <div className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
              Gebruikers in {gekozenFonds.naam} ({gebruikers.length})
            </h2>
            {gebruikers.length === 0 ? (
              <p className="mt-3 text-sm text-ink/50">Nog geen gebruikers in dit fonds.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {gebruikers.map((g) => (
                  <GebruikerRij
                    key={g.id}
                    gebruiker={g}
                    bezig={bezig}
                    onRol={(rol, reden) => verwerk(() => rolWijzigen({ userId: g.id, fondsId: gekozenFonds.id, rol, reden }))}
                    onBlokkeer={(reden) => verwerk(() => gebruikerBlokkeren({ userId: g.id, fondsId: gekozenFonds.id, reden }))}
                    onDeblokkeer={(reden) => verwerk(() => gebruikerDeblokkeren({ userId: g.id, fondsId: gekozenFonds.id, reden }))}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Aanmaken (met bevestigingsstap) ────────────────────────────────────────────
type AanmaakInvoer = { email: string; naam: string; rol: TenantRol; wachtwoord: string; reden: string };

function AanmaakFormulier({
  fonds,
  bezig,
  onAanmaken,
}: {
  fonds: FondsOptie;
  bezig: boolean;
  onAanmaken: (invoer: AanmaakInvoer, reset: () => void) => void;
}) {
  const [email, setEmail] = useState("");
  const [naam, setNaam] = useState("");
  const [rol, setRol] = useState<TenantRol>("bestuurder");
  const [wachtwoord, setWachtwoord] = useState("");
  const [reden, setReden] = useState("");
  const [bevestigen, setBevestigen] = useState(false);

  const compleet =
    email.trim().length > 0 &&
    naam.trim().length > 0 &&
    wachtwoord.length >= MIN_WACHTWOORD_LENGTE &&
    reden.trim().length > 0;

  function reset() {
    setEmail("");
    setNaam("");
    setRol("bestuurder");
    setWachtwoord("");
    setReden("");
    setBevestigen(false);
  }

  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">Gebruiker aanmaken</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (compleet) setBevestigen(true);
        }}
        className="mt-3 grid gap-3 sm:grid-cols-2"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink/60">E-mailadres</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink/60">Naam</span>
          <input
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink/60">Rol</span>
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value as TenantRol)}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
          >
            {TENANT_ROLLEN.map((r) => (
              <option key={r} value={r}>
                {ROL_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink/60">
            Wachtwoord (min. {MIN_WACHTWOORD_LENGTE} tekens)
          </span>
          <input
            type="password"
            value={wachtwoord}
            onChange={(e) => setWachtwoord(e.target.value)}
            autoComplete="new-password"
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-medium text-ink/60">Reden (verplicht)</span>
          <input
            value={reden}
            onChange={(e) => setReden(e.target.value)}
            placeholder="bv. Onboarding nieuwe bestuurder n.a.v. benoemingsbesluit"
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
          />
        </label>

        {!bevestigen && (
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={bezig || !compleet}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Aanmaken…
            </button>
          </div>
        )}
      </form>

      {/* Bevestigingsstap — doelfonds VOLUIT (naam + slug), FR-2. */}
      {bevestigen && (
        <div className="mt-4 rounded-lg border border-accent/40 bg-accent/10 p-4">
          <p className="text-sm text-ink">
            Je maakt een gebruiker aan in fonds{" "}
            <strong>
              {fonds.naam} ({fonds.slug})
            </strong>
            : <strong>{naam.trim()}</strong> ({email.trim()}), rol{" "}
            <strong>{ROL_LABEL[rol]}</strong>. Controleer of dit het juiste fonds is.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={bezig}
              onClick={() =>
                onAanmaken(
                  { email: email.trim(), naam: naam.trim(), rol, wachtwoord, reden: reden.trim() },
                  reset
                )
              }
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Bevestig aanmaken
            </button>
            <button
              type="button"
              onClick={() => setBevestigen(false)}
              className="text-sm text-ink/60 hover:underline"
            >
              annuleer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Gebruikersrij (rol wijzigen + (de)blokkeren) ───────────────────────────────
function GebruikerRij({
  gebruiker,
  bezig,
  onRol,
  onBlokkeer,
  onDeblokkeer,
}: {
  gebruiker: TenantGebruiker;
  bezig: boolean;
  onRol: (rol: TenantRol, reden: string) => void;
  onBlokkeer: (reden: string) => void;
  onDeblokkeer: (reden: string) => void;
}) {
  const [rol, setRol] = useState<TenantRol>(gebruiker.rol);
  const [rolReden, setRolReden] = useState("");
  const [banReden, setBanReden] = useState("");

  return (
    <li className="rounded-lg border border-line bg-app-bg/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{gebruiker.naam || "(geen naam)"}</span>
            <span className="rounded-full bg-app-bg px-2 py-0.5 text-xs text-ink/70">{ROL_LABEL[gebruiker.rol]}</span>
            {gebruiker.geblokkeerd && (
              <span className="rounded-full bg-err-tint px-2 py-0.5 text-xs text-err-ink">geblokkeerd</span>
            )}
            {!gebruiker.emailBevestigd && (
              <span className="rounded-full bg-app-bg px-2 py-0.5 text-xs text-ink/60">e-mail onbevestigd</span>
            )}
          </div>
          <p className="text-sm text-ink/60">{gebruiker.email}</p>
          <p className="mt-1 text-xs text-ink/50">
            Laatste login: {datum(gebruiker.laatsteLogin)} · Aangemaakt: {datum(gebruiker.aangemaakt)}
          </p>
        </div>
      </div>

      {/* Rol wijzigen */}
      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink/60">Rol</span>
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value as TenantRol)}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
          >
            {TENANT_ROLLEN.map((r) => (
              <option key={r} value={r}>
                {ROL_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <input
          value={rolReden}
          onChange={(e) => setRolReden(e.target.value)}
          placeholder="Reden (verplicht)"
          className="min-w-48 flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={bezig || rol === gebruiker.rol || rolReden.trim().length === 0}
          onClick={() => {
            onRol(rol, rolReden.trim());
            setRolReden("");
          }}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Rol wijzigen
        </button>
      </div>

      {/* (De)blokkeren */}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <input
          value={banReden}
          onChange={(e) => setBanReden(e.target.value)}
          placeholder="Reden (verplicht)"
          className="min-w-48 flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
        />
        {gebruiker.geblokkeerd ? (
          <button
            type="button"
            disabled={bezig || banReden.trim().length === 0}
            onClick={() => {
              onDeblokkeer(banReden.trim());
              setBanReden("");
            }}
            className="rounded-lg border border-line bg-white px-4 py-1.5 text-sm font-medium text-ink disabled:opacity-40"
          >
            Deblokkeren
          </button>
        ) : (
          <button
            type="button"
            disabled={bezig || banReden.trim().length === 0}
            onClick={() => {
              onBlokkeer(banReden.trim());
              setBanReden("");
            }}
            className="rounded-lg bg-err px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Blokkeren
          </button>
        )}
      </div>
    </li>
  );
}
