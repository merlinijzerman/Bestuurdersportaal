"use client";

import { useState } from "react";
import {
  valideerContact,
  TYPE_VERZOEK_OPTIES,
  type ContactVeld,
} from "@/lib/contact-validatie";

// Client-formulier voor het publieke contactverzoek (W2a). Client-validatie is
// uitsluitend UX — /api/contact valideert autoritatief opnieuw. Veldcontract en
// validatieregels komen 1:1 uit lib/contact-validatie.ts (gedeeld met de server).
// Honeypot ("website") + toegankelijke foutweergave conform contact-mockup-v4.

type Velden = {
  naam: string;
  organisatie: string;
  rol: string;
  email: string;
  telefoon: string;
  type_verzoek: string;
  bericht: string;
  website: string; // honeypot — blijft leeg voor mensen
};

const LEEG: Velden = {
  naam: "",
  organisatie: "",
  rol: "",
  email: "",
  telefoon: "",
  type_verzoek: "",
  bericht: "",
  website: "",
};

type Status = "idle" | "verzenden" | "ok" | "error";

const TYPE_LABEL: Record<string, string> = {
  demo: "Demo",
  pilot: "Pilot",
  vraag: "Algemene vraag",
  samenwerking: "Samenwerking",
};

export default function ContactForm() {
  const [velden, setVelden] = useState<Velden>(LEEG);
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

    const resultaat = valideerContact(velden);
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
            Bedankt — uw verzoek is verzonden. We nemen zo snel mogelijk contact
            met u op.
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

      <div className="row2">
        <div className="field">
          <label htmlFor="rol">Rol / functie</label>
          <input
            id="rol"
            name="rol"
            type="text"
            autoComplete="organization-title"
            value={velden.rol}
            onChange={(e) => update("rol", e.target.value)}
            {...veldProps("rol")}
          />
          <FieldError veld="rol" />
        </div>
        <div className="field">
          <label htmlFor="telefoon">
            Telefoonnummer <span className="opt">(optioneel)</span>
          </label>
          <input
            id="telefoon"
            name="telefoon"
            type="tel"
            autoComplete="tel"
            value={velden.telefoon}
            onChange={(e) => update("telefoon", e.target.value)}
            {...veldProps("telefoon")}
          />
          <FieldError veld="telefoon" />
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
          value={velden.type_verzoek}
          onChange={(e) => update("type_verzoek", e.target.value)}
          {...veldProps("type")}
        >
          <option value="">Maak een keuze…</option>
          {TYPE_VERZOEK_OPTIES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <FieldError veld="type" />
      </div>

      <div className="field">
        <label htmlFor="bericht">Bericht</label>
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
        <span className="submit-note">
          Reactie meestal binnen enkele werkdagen.
        </span>
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
