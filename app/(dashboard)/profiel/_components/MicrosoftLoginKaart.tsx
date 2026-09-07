"use client";
// ============================================================================
//  MicrosoftLoginKaart — koppel-/ontkoppelbediening voor "Inloggen met Microsoft"
//  op de profielpagina (#335 T2, ontwerp §3.8). Bewust gescheiden van de Graph-
//  connectorkaart (MicrosoftKoppelingKaart): twee vertrouwensdomeinen.
// ----------------------------------------------------------------------------
//  Rendert niets als het fonds Microsoft-login niet aan heeft (`beschikbaar:false`).
//  Toont nooit tid/oid/sub of e-mail — alleen de toestand en tijdstippen.
//  Ontkoppelen is deterministisch (reviewbevinding PR #339): de status meldt of de
//  HUIDIGE sessie via Microsoft loopt; dan zegt de kaart vooraf dat u wordt
//  uitgelogd en stuurt zij na `uitgelogd: true` naar /login. Anders blijft u
//  ingelogd met uw wachtwoord en zegt de kaart dat.
//  Importeert uitsluitend de browserveilige meldingen-module (geen node:*).
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  isProfielMicrosoftLoginCode,
  PROFIEL_MICROSOFT_LOGIN_MELDINGEN,
  SUPPORTCODE_RE,
} from "@/core/lib/microsoft-login-meldingen-core";

type Status =
  | { beschikbaar: false }
  | ({ beschikbaar: true; sessieViaMicrosoft?: boolean } & (
      | { status: "geen" }
      | { status: "pending"; herstelMogelijk: boolean; pendingVerlooptOp: string | null }
      | { status: "active"; geactiveerdOp: string | null; laatstGebruiktOp: string | null }
      | { status: "revoking" }
      | { status: "onbekend" }
    ));

async function haalStatus(): Promise<Status> {
  try {
    const response = await fetch("/api/microsoft-login/koppeling", { cache: "no-store" });
    return response.ok ? ((await response.json()) as Status) : { beschikbaar: false };
  } catch {
    return { beschikbaar: false };
  }
}

function meldingUitUrl(params: URLSearchParams): string | null {
  const uitkomst = params.get("microsoft_login");
  if (uitkomst === "gekoppeld") return "Microsoft-login is gekoppeld aan uw account.";
  if (uitkomst === "fout") {
    const code = params.get("c");
    const tekst = PROFIEL_MICROSOFT_LOGIN_MELDINGEN[isProfielMicrosoftLoginCode(code) ? code : "koppelen"];
    const sc = params.get("sc");
    return sc && SUPPORTCODE_RE.test(sc) ? `${tekst} Supportcode: ${sc}` : tekst;
  }
  return null;
}

const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleString("nl-NL") : "onbekend");

export default function MicrosoftLoginKaart() {
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [melding, setMelding] = useState<string | null>(() => meldingUitUrl(params));
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(async () => setStatus(await haalStatus()), []);

  useEffect(() => {
    let actief = true;
    void haalStatus().then((r) => {
      if (actief) setStatus(r);
    });
    return () => {
      actief = false;
    };
  }, []);

  if (!status?.beschikbaar) return null;
  const viaMicrosoft = status.sessieViaMicrosoft === true;

  const ontkoppel = async () => {
    const vraag = viaMicrosoft
      ? "Microsoft-login ontkoppelen? U bent nu met Microsoft ingelogd en wordt direct uitgelogd; daarna logt u in met uw wachtwoord."
      : "Microsoft-login ontkoppelen? U blijft ingelogd met uw wachtwoord; inloggen met Microsoft is daarna niet meer mogelijk.";
    if (!confirm(vraag)) return;
    setBezig(true);
    setMelding(null);
    try {
      const response = await fetch("/api/microsoft-login/koppeling", { method: "DELETE" });
      if (!response.ok) {
        setMelding(PROFIEL_MICROSOFT_LOGIN_MELDINGEN.ontkoppelen);
        await laad();
        return;
      }
      const uitkomst = (await response.json()) as { ok: true; uitgelogd: boolean };
      if (uitkomst.uitgelogd) {
        // De server heeft de Microsoft-sessie beëindigd; één volledige navigatie naar de login.
        window.location.replace("/login");
        return;
      }
      setMelding("Microsoft-login is ontkoppeld. U blijft ingelogd met uw wachtwoord.");
      await laad();
    } catch {
      setMelding(PROFIEL_MICROSOFT_LOGIN_MELDINGEN.ontkoppelen);
    } finally {
      setBezig(false);
    }
  };

  const herstel = async () => {
    setBezig(true);
    setMelding(null);
    try {
      const response = await fetch("/api/microsoft-login/koppeling", { method: "POST" });
      setMelding(response.ok ? "De koppeling is hersteld." : PROFIEL_MICROSOFT_LOGIN_MELDINGEN.koppelen);
      await laad();
    } catch {
      setMelding(PROFIEL_MICROSOFT_LOGIN_MELDINGEN.koppelen);
    } finally {
      setBezig(false);
    }
  };

  return (
    <section className="bg-white border border-line rounded-xl p-5 mb-6" aria-labelledby="microsoft-login-kop">
      <h2 id="microsoft-login-kop" className="font-bold text-ink mb-1">
        Inloggen met Microsoft
      </h2>
      <p className="text-sm text-muted mb-4">
        Koppel uw Microsoft-werkaccount om zonder wachtwoord in te loggen. Uw portaalaccount, rol en fonds
        veranderen niet; inloggen met wachtwoord blijft altijd werken.
      </p>

      {status.status === "geen" && (
        <a
          href="/api/microsoft-login/koppelen/start"
          className="inline-flex bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          Koppel Microsoft-account
        </a>
      )}

      {status.status === "active" && (
        <div className="space-y-3 text-sm">
          <p className="text-ok-ink font-medium">Gekoppeld</p>
          <p className="text-xs text-muted">
            Gekoppeld op: {datum(status.geactiveerdOp)} · Laatst gebruikt: {datum(status.laatstGebruiktOp)}
          </p>
          <p className="text-xs text-muted">
            {viaMicrosoft
              ? "U bent nu met Microsoft ingelogd. Ontkoppelen logt u direct uit."
              : "U bent nu met uw wachtwoord ingelogd. Ontkoppelen laat deze sessie ongemoeid."}
          </p>
          <button
            disabled={bezig}
            onClick={() => void ontkoppel()}
            className="border border-app-line-strong text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
          >
            Ontkoppelen
          </button>
        </div>
      )}

      {status.status === "revoking" && (
        <div className="space-y-3 text-sm">
          <p className="text-muted">Ontkoppelen is nog niet afgerond. Inloggen met Microsoft is al geblokkeerd.</p>
          <button
            disabled={bezig}
            onClick={() => void ontkoppel()}
            className="border border-app-line-strong text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
          >
            Opnieuw proberen
          </button>
        </div>
      )}

      {status.status === "pending" && (
        <div className="space-y-3 text-sm">
          {status.herstelMogelijk ? (
            <>
              <p className="text-muted">De koppeling is bijna klaar maar nog niet geactiveerd.</p>
              <button
                disabled={bezig}
                onClick={() => void herstel()}
                className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
              >
                Koppeling herstellen
              </button>
            </>
          ) : (
            <p className="text-muted">
              Koppelen is nog niet afgerond. Probeer het over tien minuten opnieuw
              {status.pendingVerlooptOp ? ` (verloopt ${datum(status.pendingVerlooptOp)})` : ""}.
            </p>
          )}
        </div>
      )}

      {status.status === "onbekend" && (
        <p className="text-sm text-muted">De status kan nu niet worden opgehaald. Probeer het later opnieuw.</p>
      )}

      {melding && (
        <p className="mt-4 text-sm text-muted" role="status">
          {melding}
        </p>
      )}
    </section>
  );
}
