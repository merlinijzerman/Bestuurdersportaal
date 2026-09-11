"use client";
// ============================================================================
//  LoginBeleidBeheer — beheerscherm Microsoft-loginbeleid (fase 1C, #344 PR-B).
// ----------------------------------------------------------------------------
//  Leest/schrijft uitsluitend via /api/microsoft-login/beheer/*. De respons
//  draagt nooit een tenant-id, tid/oid/sub of e-mail: alleen naam, rol, status
//  en tijdstippen. Drie regels uit de review:
//    • `verplicht` alleen na een expliciete bevestiging mét de preflight-uitkomst
//      (blokkers vooraf zichtbaar, UX-principe uit CLAUDE.md);
//    • beheerintrekking gaat standaard naar `revoking`; "afronden" is een APARTE,
//      nadrukkelijk bevestigde actie (bevestigingswoord) — geen checkbox;
//    • een uitgegeven uitnodigingslink bestaat maar één keer, uitsluitend in
//      client-state, met een kopieerknop; hij wordt nergens opgeslagen.
//  Importeert uit het login-domein alleen de browserveilige meldingen-module.
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import { BEHEER_TEKSTEN } from "@/core/lib/microsoft-login-meldingen-core";
import type { BeheerBeleidRespons } from "@/core/lib/microsoft-login-beheer-core";
import type { BreakglassReden } from "@/core/lib/microsoft-login-beheer-core";
import type { LoginModus } from "@/core/lib/microsoft-login-beleid-core";

type Beleid = { beschikbaar: false } | ({ beschikbaar: true } & BeheerBeleidRespons);

const MODUS_LABEL: Record<LoginModus, string> = { uit: "Uit", optioneel: "Optioneel", verplicht: "Verplicht" };
const MODUS_UITLEG: Record<LoginModus, string> = {
  uit: "Geen Microsoft-login; alleen wachtwoordlogin.",
  optioneel: "Gebruikers kunnen zelf hun Microsoft-account koppelen en ermee inloggen; wachtwoordlogin blijft werken.",
  verplicht: "Alleen Microsoft-login. Wachtwoordlogin, magic link en wachtwoordherstel worden geblokkeerd, behalve voor noodtoegang.",
};
const STATUS_LABEL: Record<string, string> = { active: "Gekoppeld", pending: "Bezig met koppelen", revoking: "Ingetrokken (losmaken open)", revoked: "Ingetrokken", failed: "Mislukt" };
const REDEN_LABEL: Record<BreakglassReden, string> = { entra_storing: "Entra-storing", beheerherstel: "Beheerherstel", migratie: "Migratie" };

const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleString("nl-NL") : "—");

async function json<T>(r: Response): Promise<T & { error?: string }> {
  try {
    return (await r.json()) as T & { error?: string };
  } catch {
    return {} as T & { error?: string };
  }
}

export default function LoginBeleidBeheer() {
  const [beleid, setBeleid] = useState<Beleid | null>(null);
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  // De ENIGE plek waar een uitgegeven uitnodigingslink bestaat: client-state, eenmalig.
  const [uitnodiging, setUitnodiging] = useState<{ userId: string; naam: string | null; link: string; verlooptOp: string; gekopieerd: boolean } | null>(null);
  const [afronden, setAfronden] = useState<{ userId: string; naam: string | null; woord: string } | null>(null);
  const [breakglassVoor, setBreakglassVoor] = useState<{ userId: string; naam: string | null; reden: BreakglassReden } | null>(null);

  const laad = useCallback(async () => {
    const r = await fetch("/api/microsoft-login/beheer/beleid", { cache: "no-store" });
    setBeleid(r.ok ? await json<Beleid>(r) : { beschikbaar: false });
  }, []);

  useEffect(() => {
    let actief = true;
    void fetch("/api/microsoft-login/beheer/beleid", { cache: "no-store" })
      .then(async (r) => (r.ok ? await json<Beleid>(r) : ({ beschikbaar: false } as Beleid)))
      .catch(() => ({ beschikbaar: false }) as Beleid)
      .then((b) => {
        if (actief) setBeleid(b);
      });
    return () => {
      actief = false;
    };
  }, []);

  if (beleid === null) return <p className="text-sm text-muted">Beleid laden…</p>;
  if (!beleid.beschikbaar) {
    return (
      <p className="text-sm text-muted" role="status">
        Microsoft-login is voor dit fonds niet beschikbaar of niet geconfigureerd.
      </p>
    );
  }

  async function doe(actie: () => Promise<Response>, succes: string) {
    setBezig(true);
    setFout(null);
    setMelding(null);
    try {
      const r = await actie();
      const body = await json<{ ok?: boolean }>(r);
      if (!r.ok) {
        setFout(body.error ?? "De handeling is niet gelukt.");
        return null;
      }
      setMelding(succes);
      await laad();
      return body;
    } catch {
      setFout("De handeling is niet gelukt. Probeer het opnieuw.");
      return null;
    } finally {
      setBezig(false);
    }
  }

  const zetModus = async (modus: LoginModus) => {
    if (!beleid.beschikbaar || modus === beleid.modus) return;
    if (modus === "verplicht") {
      if (!beleid.magActiveren) {
        setFout(beleid.activeringWeigering ?? "De overgang naar verplichte Microsoft-login kan nu niet worden voltooid.");
        return;
      }
      if (!confirm(BEHEER_TEKSTEN.verplichtBevestiging)) return;
    }
    await doe(
      () => fetch("/api/microsoft-login/beheer/beleid", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ modus }) }),
      `Beleid gewijzigd naar "${MODUS_LABEL[modus]}".`,
    );
  };

  const intrekken = async (userId: string) => {
    if (!confirm(BEHEER_TEKSTEN.intrekkenBevestiging)) return;
    await doe(
      () => fetch("/api/microsoft-login/beheer/intrekking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doelUserId: userId }) }),
      "Koppeling ingetrokken; de gebruiker kan haar zelf losmaken en opnieuw koppelen.",
    );
  };

  const afrondenBevestigd = async () => {
    if (!afronden || afronden.woord !== BEHEER_TEKSTEN.afrondenBevestigingswoord) return;
    const doel = afronden.userId;
    setAfronden(null);
    await doe(
      () => fetch("/api/microsoft-login/beheer/intrekking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doelUserId: doel, afronden: true }) }),
      "Intrekking definitief afgerond. De Microsoft-identiteit blijft in Supabase Auth achter.",
    );
  };

  const uitnodigen = async (userId: string, naam: string | null) => {
    setUitnodiging(null);
    const body = await doe(
      () => fetch("/api/microsoft-login/beheer/uitnodiging", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doelUserId: userId }) }),
      "Uitnodiging uitgegeven.",
    );
    const b = body as { link?: string; verlooptOp?: string } | null;
    if (b?.link && b.verlooptOp) setUitnodiging({ userId, naam, link: b.link, verlooptOp: b.verlooptOp, gekopieerd: false });
  };

  const uitnodigingIntrekken = async (userId: string) => {
    if (!confirm("Open uitnodiging intrekken?")) return;
    if (uitnodiging?.userId === userId) setUitnodiging(null);
    await doe(
      () => fetch("/api/microsoft-login/beheer/uitnodiging", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ doelUserId: userId }) }),
      "Uitnodiging ingetrokken.",
    );
  };

  const kopieer = async () => {
    if (!uitnodiging) return;
    try {
      await navigator.clipboard.writeText(uitnodiging.link);
      setUitnodiging({ ...uitnodiging, gekopieerd: true });
    } catch {
      setFout("Kopiëren is niet gelukt; selecteer de link en kopieer handmatig.");
    }
  };

  const breakglassVerlenen = async () => {
    if (!breakglassVoor) return;
    const { userId, reden } = breakglassVoor;
    setBreakglassVoor(null);
    await doe(
      () => fetch("/api/microsoft-login/beheer/breakglass", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doelUserId: userId, reden }) }),
      "Noodtoegangsaanwijzing verleend. Zij werkt pas na een bevestigde tweestapsverificatie van het account.",
    );
  };

  const breakglassIntrekken = async (id: string) => {
    if (!confirm("Noodtoegangsaanwijzing intrekken? Lopende noodtoegang wordt direct beëindigd.")) return;
    await doe(() => fetch(`/api/microsoft-login/beheer/breakglass/${id}`, { method: "DELETE" }), "Noodtoegangsaanwijzing ingetrokken.");
  };

  const p = beleid.preflight;

  return (
    <div className="space-y-10">
      {(melding || fout) && (
        <div role={fout ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${fout ? "bg-err-tint border border-err/30 text-err-ink" : "bg-ok-tint border border-ok/30 text-ok-ink"}`}>
          {fout ?? melding}
        </div>
      )}

      {/* ── Beleid ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="beleid-kop" className="bg-white border border-line rounded-xl p-5">
        <h2 id="beleid-kop" className="font-bold text-ink mb-1">Beleid</h2>
        <p className="text-sm text-muted mb-4">
          Microsoft-tenant: {beleid.tenantGeconfigureerd ? "geconfigureerd" : "nog niet vastgelegd (alleen via migratie/SQL)"}.
        </p>
        <fieldset className="space-y-2" disabled={bezig}>
          <legend className="sr-only">Loginmodus</legend>
          {(["uit", "optioneel", "verplicht"] as const).map((m) => (
            <label key={m} className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${beleid.modus === m ? "border-accent bg-app-bg" : "border-line"}`}>
              <input type="radio" name="modus" value={m} checked={beleid.modus === m} onChange={() => void zetModus(m)} className="mt-1" />
              <span>
                <span className="block text-sm font-semibold text-ink">{MODUS_LABEL[m]}</span>
                <span className="block text-xs text-muted">{MODUS_UITLEG[m]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="mt-4 rounded-lg border border-line bg-app-bg px-3 py-3 text-sm" aria-live="polite">
          <p className="font-semibold text-ink">Gereed voor &quot;Verplicht&quot;: {beleid.magActiveren ? "ja" : "nee"}</p>
          <ul className="mt-1 text-xs text-muted space-y-0.5">
            <li>Accounts zonder actieve koppeling of noodtoegang: {p.ongedekteAccounts}</li>
            <li>Noodtoegangsaccounts met bevestigde tweestapsverificatie: {p.breakglassAccounts}</li>
            {p.breakglassHerzieningVerlopen > 0 && <li className="text-warn-ink">Noodtoegangsaanwijzingen die herzien moeten worden: {p.breakglassHerzieningVerlopen}</li>}
          </ul>
          {!beleid.magActiveren && beleid.activeringWeigering && <p className="mt-2 text-xs text-err-ink">{beleid.activeringWeigering}</p>}
        </div>
      </section>

      {/* ── Dekking ────────────────────────────────────────────────────── */}
      <section aria-labelledby="dekking-kop" className="bg-white border border-line rounded-xl p-5">
        <h2 id="dekking-kop" className="font-bold text-ink mb-1">Accounts en koppelingen</h2>
        <p className="text-sm text-muted mb-4">
          Per account de koppelstatus. Intrekken blokkeert Microsoft-login direct; de gebruiker maakt de koppeling daarna zelf los.
          Een uitnodiging opent een kort herstelvenster voor een vervangen of verloren Microsoft-account.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="py-2 pr-3">Naam</th>
                <th className="py-2 pr-3">Rol</th>
                <th className="py-2 pr-3">Koppeling</th>
                <th className="py-2 pr-3">Laatst gebruikt</th>
                <th className="py-2 pr-3">Dekking</th>
                <th className="py-2">Acties</th>
              </tr>
            </thead>
            <tbody>
              {beleid.dekking.map((r) => (
                <tr key={r.userId} className="border-b border-line align-top">
                  <td className="py-2 pr-3 text-ink">{r.naam ?? "—"}</td>
                  <td className="py-2 pr-3 text-muted">{r.rol ?? "—"}</td>
                  <td className="py-2 pr-3">{r.bindingStatus ? (STATUS_LABEL[r.bindingStatus] ?? r.bindingStatus) : "Geen"}{r.uitnodigingOpen ? " · uitnodiging open" : ""}</td>
                  <td className="py-2 pr-3 text-muted">{datum(r.laatstGebruiktOp)}</td>
                  <td className="py-2 pr-3">{r.gedekt ? <span className="text-ok-ink">gedekt</span> : <span className="text-warn-ink">niet gedekt</span>}{r.breakGlass ? " · noodtoegang" : ""}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      {(r.bindingStatus === "active" || r.bindingStatus === "pending") && (
                        <button type="button" disabled={bezig} onClick={() => void intrekken(r.userId)} className="border border-app-line-strong text-xs font-semibold px-2 py-1 rounded-lg disabled:opacity-50">
                          Intrekken
                        </button>
                      )}
                      {(r.bindingStatus === "active" || r.bindingStatus === "pending" || r.bindingStatus === "revoking") && (
                        <button type="button" disabled={bezig} onClick={() => setAfronden({ userId: r.userId, naam: r.naam, woord: "" })} className="border border-err/40 text-err-ink text-xs font-semibold px-2 py-1 rounded-lg disabled:opacity-50">
                          Intrekking afronden…
                        </button>
                      )}
                      {r.uitnodigingOpen ? (
                        <button type="button" disabled={bezig} onClick={() => void uitnodigingIntrekken(r.userId)} className="border border-app-line-strong text-xs font-semibold px-2 py-1 rounded-lg disabled:opacity-50">
                          Uitnodiging intrekken
                        </button>
                      ) : (
                        <button type="button" disabled={bezig} onClick={() => void uitnodigen(r.userId, r.naam)} className="bg-accent text-white text-xs font-semibold px-2 py-1 rounded-lg disabled:opacity-50">
                          Uitnodiging uitgeven
                        </button>
                      )}
                      {!r.breakGlass && (
                        <button type="button" disabled={bezig} onClick={() => setBreakglassVoor({ userId: r.userId, naam: r.naam, reden: "beheerherstel" })} className="border border-app-line-strong text-xs font-semibold px-2 py-1 rounded-lg disabled:opacity-50">
                          Noodtoegang verlenen…
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {uitnodiging && (
          <div className="mt-4 rounded-lg border border-warn bg-warn-tint px-3 py-3 text-sm" role="status" aria-labelledby="uitnodiging-kop">
            <p id="uitnodiging-kop" className="font-semibold text-ink">Uitnodiging voor {uitnodiging.naam ?? "dit account"}</p>
            <p className="text-xs text-muted mt-1">{BEHEER_TEKSTEN.uitnodigingEenmalig} Geldig tot {datum(uitnodiging.verlooptOp)}.</p>
            <div className="mt-2 flex gap-2 items-center">
              <input readOnly value={uitnodiging.link} aria-label="Uitnodigingslink" onFocus={(e) => e.currentTarget.select()} className="flex-1 border border-line rounded-lg px-2 py-1 text-xs font-mono" />
              <button type="button" onClick={() => void kopieer()} className="bg-accent text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
                {uitnodiging.gekopieerd ? "Gekopieerd" : "Kopieer link"}
              </button>
              <button type="button" onClick={() => setUitnodiging(null)} className="border border-app-line-strong text-xs font-semibold px-3 py-1.5 rounded-lg">
                Sluiten
              </button>
            </div>
          </div>
        )}

        {afronden && (
          <div className="mt-4 rounded-lg border border-err/40 bg-err-tint px-3 py-3 text-sm" role="dialog" aria-labelledby="afronden-kop">
            <p id="afronden-kop" className="font-semibold text-err-ink">Intrekking definitief afronden voor {afronden.naam ?? "dit account"}</p>
            <p className="text-xs text-ink mt-1">{BEHEER_TEKSTEN.afrondenBevestiging}</p>
            <label className="block mt-2 text-xs text-ink">
              Typ <span className="font-mono">{BEHEER_TEKSTEN.afrondenBevestigingswoord}</span> om te bevestigen
              <input value={afronden.woord} onChange={(e) => setAfronden({ ...afronden, woord: e.target.value })} className="mt-1 block w-48 border border-line rounded-lg px-2 py-1 text-sm" />
            </label>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={bezig || afronden.woord !== BEHEER_TEKSTEN.afrondenBevestigingswoord} onClick={() => void afrondenBevestigd()} className="bg-err text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50">
                Definitief afronden
              </button>
              <button type="button" onClick={() => setAfronden(null)} className="border border-app-line-strong text-xs font-semibold px-3 py-1.5 rounded-lg">
                Annuleren
              </button>
            </div>
          </div>
        )}

        {breakglassVoor && (
          <div className="mt-4 rounded-lg border border-line bg-app-bg px-3 py-3 text-sm" role="dialog" aria-labelledby="breakglass-kop">
            <p id="breakglass-kop" className="font-semibold text-ink">Noodtoegang verlenen aan {breakglassVoor.naam ?? "dit account"}</p>
            <p className="text-xs text-muted mt-1">
              Een duurzame aanwijzing: het account kan bij een Entra-storing met wachtwoord én tweestapsverificatie inloggen. Niet aan uzelf toe te kennen; herziening over 90 dagen.
            </p>
            <label className="block mt-2 text-xs text-ink">
              Reden
              <select value={breakglassVoor.reden} onChange={(e) => setBreakglassVoor({ ...breakglassVoor, reden: e.target.value as BreakglassReden })} className="mt-1 block border border-line rounded-lg px-2 py-1 text-sm">
                {(Object.keys(REDEN_LABEL) as BreakglassReden[]).map((r) => (
                  <option key={r} value={r}>{REDEN_LABEL[r]}</option>
                ))}
              </select>
            </label>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={bezig} onClick={() => void breakglassVerlenen()} className="bg-accent text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50">
                Verlenen
              </button>
              <button type="button" onClick={() => setBreakglassVoor(null)} className="border border-app-line-strong text-xs font-semibold px-3 py-1.5 rounded-lg">
                Annuleren
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Noodtoegang ───────────────────────────────────────────────── */}
      <section aria-labelledby="breakglass-overzicht-kop" className="bg-white border border-line rounded-xl p-5">
        <h2 id="breakglass-overzicht-kop" className="font-bold text-ink mb-1">Noodtoegang</h2>
        <p className="text-sm text-muted mb-4">
          Duurzame aanwijzingen voor inloggen met wachtwoord en tweestapsverificatie bij een Microsoft-storing. Herzien ze periodiek; intrekken beëindigt lopende noodtoegang direct.
        </p>
        {beleid.breakglass.length === 0 ? (
          <p className="text-sm text-muted">Geen noodtoegangsaanwijzingen.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="py-2 pr-3">Naam</th>
                <th className="py-2 pr-3">Reden</th>
                <th className="py-2 pr-3">Uitgegeven</th>
                <th className="py-2 pr-3">Herzien vóór</th>
                <th className="py-2 pr-3">Laatst gebruikt</th>
                <th className="py-2">Acties</th>
              </tr>
            </thead>
            <tbody>
              {beleid.breakglass.map((b) => (
                <tr key={b.id} className="border-b border-line">
                  <td className="py-2 pr-3 text-ink">{b.naam ?? "—"}</td>
                  <td className="py-2 pr-3">{REDEN_LABEL[b.redenCategorie as BreakglassReden] ?? b.redenCategorie}</td>
                  <td className="py-2 pr-3 text-muted">{datum(b.uitgegevenOp)}</td>
                  <td className={`py-2 pr-3 ${b.herzieningVerlopen ? "text-warn-ink font-semibold" : "text-muted"}`}>{datum(b.herzienVoor)}{b.herzieningVerlopen ? " · herziening verlopen" : ""}</td>
                  <td className="py-2 pr-3 text-muted">{datum(b.laatstGebruiktOp)}</td>
                  <td className="py-2">
                    <button type="button" disabled={bezig} onClick={() => void breakglassIntrekken(b.id)} className="border border-app-line-strong text-xs font-semibold px-2 py-1 rounded-lg disabled:opacity-50">
                      Intrekken
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
