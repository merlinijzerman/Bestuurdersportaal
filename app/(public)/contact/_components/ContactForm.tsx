"use client";

import { useState } from "react";
import {
  valideerContact,
  type ContactVeld,
  type TypeVerzoek,
} from "@/lib/contact-validatie";

// Client-formulier voor het publieke contactverzoek (W2a). Client-validatie is
// uitsluitend UX — /api/contact valideert autoritatief opnieuw. Veldcontract en
// validatieregels komen 1:1 uit lib/contact-validatie.ts (gedeeld met de server).
// Honeypot ("website") + toegankelijke foutweergave.
//
// Velden (copy v0.2 §7 / besluit 0037 #2): Naam · Organisatie · E-mailadres ·
// Type verzoek · Bericht (optioneel). Rol en telefoon zijn bewust geen
// zichtbaar veld meer; ze worden als '' / null opgeslagen (NOT NULL-kolommen).
//
// Type verzoek: de UI toont 6 vriendelijke labels; verstuurd wordt de DB-waarde
// (4 enum-waarden). `/contact?type=pilot` preselecteert de pilot-optie.

type Velden = {
  naam: string;
  organisatie: string;
  email: string;
  bericht: string;
  website: string; // honeypot — blijft leeg voor mensen
};

const LEEG: Velden = {
  naam: "",
  organisatie: "",
  email: "",
  bericht: "",
  website: "",
};

type Status = "idle" | "verzenden" | "ok" | "error";

// 6 labels → 4 DB-waarden (copy v0.2 §7). `id` is de select-waarde (uniek),
// `db` is wat naar de server gaat. Meerdere labels mogen op dezelfde DB-waarde
// mappen ("Anders" en de vraag-varianten → `vraag`).
const TYPE_OPTIES: { id: string; label: string; db: TypeVerzoek }[] = [
  { id: "informatie", label: "Ik wil meer informatie ontvangen", db: "vraag" },
  { id: "vraag", label: "Ik heb een algemene vraag", db: "vraag" },
  {
    id: "past",
    label: "Ik wil bespreken of dit bij mijn organisatie past",
    db: "samenwerking",
  },
  { id: "demo", label: "Ik wil een demo aanvragen", db: "demo" },
  {
    id: "pilot",
    label: "Ik wil een pilot of eerste besluitdossier bespreken",
    db: "pilot",
  },
  { id: "anders", label: "Anders", db: "vraag" },
];

// Vertaal een ?type-DB-waarde naar de bijbehorende select-optie-id (eerste
// match). Onbekend/leeg → geen preselectie.
function keuzeVoorType(type?: string): string {
  const opt = TYPE_OPTIES.find((o) => o.db === type);
  return opt ? opt.id : "";
}

export default function ContactForm({ initialType }: { initialType?: string }) {
  const [velden, setVelden] = useState<Velden>(LEEG);
  const [keuze, setKeuze] = useState<string>(keuzeVoorType(initialType));
  const [fouten, setFouten] = useState<Partial<Record<ContactVeld, string>>>({});
  const [status, setStatus] = useState<Status>("idle");
  const [foutmelding, setFoutmelding] = useState(
    "Er ging iets mis. Controleer de gemarkeerde velden en probeer het opnieuw."
  );

  function update(veld: keyof Velden, waarde: string) {
    setVelden((v) => ({ ...v, [veld]: waarde }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "verzenden") return; // dubbele submit voorkomen (naast disabled-knop)

    // Honeypot ingevuld → stil negeren (zoals de server: geen signaal aan bots).
    if (velden.website.trim()) return;

    // Vertaal de gekozen optie-id naar de DB-waarde die we versturen.
    const dbWaarde = TYPE_OPTIES.find((o) => o.id === keuze)?.db ?? "";

    const resultaat = valideerContact({
      naam: velden.naam,
      organisatie: velden.organisatie,
      email: velden.email,
      bericht: velden.bericht,
      type_verzoek: dbWaarde,
    });
    if (!resultaat.ok) {
      setFouten(resultaat.fouten);
      setFoutmelding(
        "Er ging iets mis. Controleer de gemarkeerde velden en probeer het opnieuw."
      );
      setStatus("error");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setFouten({});
    setStatus("verzenden");
    try {
      const resp = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...resultaat.schoon,
          website: "",
          herkomst_pagina:
            typeof window !== "undefined" ? window.location.pathname : null,
        }),
      });

      if (resp.ok) {
        setVelden(LEEG);
        setKeuze("");
        setStatus("ok");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      let melding =
        "Er ging iets mis bij het verzenden. Probeer het later opnieuw.";
      try {
        const data = (await resp.json()) as { error?: string };
        if (data?.error) melding = data.error; // veilige, gesanitiseerde NL-tekst
      } catch {
        /* houd generieke melding */
      }
      setFoutmelding(melding);
      setStatus("error");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setFoutmelding(
        "Verzenden mislukt door een netwerkfout. Controleer uw verbinding en probeer het opnieuw."
      );
      setStatus("error");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const bezig = status === "verzenden";

  function veldProps(veld: ContactVeld) {
    const heeftFout = Boolean(fouten[veld]);
    return {
      "aria-invalid": heeftFout || undefined,
      "aria-describedby": heeftFout ? `err-${veld}` : undefined,
    };
  }

  function FieldError({ veld }: { veld: ContactVeld }) {
    if (!fouten[veld]) return null;
    return (
      <div className="field-err" id={`err-${veld}`}>
        {fouten[veld]}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-describedby="contact-status">
      <div id="contact-status" aria-live="polite">
        {status === "ok" && (
          <div className="msg ok show" role="status">
            Bedankt, uw bericht is ontvangen. We nemen contact met u op.
          </div>
        )}
        {status === "error" && (
          <div className="msg err show" role="alert">
            {foutmelding}
          </div>
        )}
      </div>

      <div className="row2">
        <div className="field">
          <label htmlFor="naam">Naam</label>
          <input
            id="naam"
            name="naam"
            type="text"
            autoComplete="name"
            value={velden.naam}
            onChange={(e) => update("naam", e.target.value)}
            {...veldProps("naam")}
          />
          <FieldError veld="naam" />
        </div>
        <div className="field">
          <label htmlFor="organisatie">Organisatie</label>
          <input
            id="organisatie"
            name="organisatie"
            type="text"
            autoComplete="organization"
            value={velden.organisatie}
            onChange={(e) => update("organisatie", e.target.value)}
            {...veldProps("organisatie")}
          />
          <FieldError veld="organisatie" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="email">E-mailadres</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={velden.email}
          onChange={(e) => update("email", e.target.value)}
          {...veldProps("email")}
        />
        <FieldError veld="email" />
      </div>

      <div className="field">
        <label htmlFor="type">Type verzoek</label>
        <select
          id="type"
          name="type"
          value={keuze}
          onChange={(e) => setKeuze(e.target.value)}
          {...veldProps("type")}
        >
          <option value="">Maak een keuze…</option>
          {TYPE_OPTIES.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <FieldError veld="type" />
      </div>

      <div className="field">
        <label htmlFor="bericht">
          Bericht <span className="opt">(optioneel)</span>
        </label>
        <textarea
          id="bericht"
          name="bericht"
          value={velden.bericht}
          onChange={(e) => update("bericht", e.target.value)}
          {...veldProps("bericht")}
        />
        <FieldError veld="bericht" />
      </div>

      {/* honeypot tegen spam: blijft leeg voor mensen */}
      <div className="hp" aria-hidden="true">
        <label>
          Laat dit veld leeg
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={velden.website}
            onChange={(e) => update("website", e.target.value)}
          />
        </label>
      </div>

      <div className="submit-row">
        <button type="submit" className="btn btn-primary" disabled={bezig}>
          {bezig ? "Verzenden…" : "Verstuur verzoek"}
        </button>
      </div>

      <p className="privacy-note">
        Wij gebruiken uw gegevens alleen om uw verzoek te behandelen en contact
        met u op te nemen. Lees meer in onze{" "}
        <a href="/privacy" className="textlink">
          privacyverklaring
        </a>
        .
      </p>
    </form>
  );
}
