"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Telefoonkader met de promovideo op de homepage ("Zie het in actie").
// Bewust homepage-specifiek en niet generiek: /product houdt zijn Voorbeeldflow
// en krijgt geen video (werkopdracht §2.1, "buiten scope").
//
// Toegankelijkheid (WCAG 2.1 AA, REQ-PV-004/062):
//  - nooit autoplay — de video heeft een gesproken voice-over;
//  - preload="none" + poster, zodat bij binnenkomst alleen ~37 kB laadt;
//  - ondertiteling via <track> en daarnaast een uitklapbare transcriptie, zodat
//    de inhoud ook zonder video en zonder geluid toegankelijk is;
//  - de vergrote weergave is een echte dialoog: role/aria-modal, Esc, klik
//    naast de video, focus-trap zolang hij open staat en focus terug naar de
//    knop na sluiten.
// De ingebouwde volledig-scherm-knop van de speler blijft daarnaast gewoon
// werken; daar is geen eigen code voor nodig.

const BRON = "/video/promo-9x16.mp4";
const POSTER = "/video/promo-9x16-poster.jpg";
const ONDERTITELS = "/video/promo-9x16.nl.vtt";
const OMSCHRIJVING = "Rondleiding door het Bestuurdersportaal";

// Gelijk aan de gesproken tekst en aan wat er in beeld staat; zie
// public/video/promo-9x16.nl.vtt voor dezelfde tekst met tijdcodes.
const TRANSCRIPTIE = [
  "Waar beheerste AI en besluitvorming elkaar versterken. Bestuurdersportaal — van dossier tot besluit, in één beveiligde omgeving per fonds.",
  "Uw fonds, uw stukken, uw processen — op één afgeschermde plek.",
  "Een kritische sparringpartner, geen zoekmachine. U kiest niet alleen een samenvatting — u kiest tegenspraak.",
  "Kritische vragen die het voorstel oproept, maar niet beantwoordt. Elke vraag herleidbaar naar uw eigen fondsdocumenten.",
  "De AI-assistent levert input, geen mening. U formuleert uw eigen inbreng.",
  "Elk stuk vooraf samengevat, inbreng direct zichtbaar. Het bestuursbureau zet dit in één handeling klaar.",
  "Het besluit is van het bestuur. Governance is geen extra stap: de onderbouwing legt zichzelf vast.",
  "Goed voorbereid. Zorgvuldig besloten. Aantoonbaar verantwoord.",
  "Ervaar het Bestuurdersportaal. Demonstratieomgeving met fictieve gegevens.",
];

export default function DemoVideo() {
  const [open, setOpen] = useState(false);
  const kleinRef = useRef<HTMLVideoElement>(null);
  const grootRef = useRef<HTMLVideoElement>(null);
  const dialoogRef = useRef<HTMLDivElement>(null);
  const knopRef = useRef<HTMLButtonElement>(null);
  const sluitRef = useRef<HTMLButtonElement>(null);

  const sluit = useCallback(() => {
    grootRef.current?.pause();
    setOpen(false);
    knopRef.current?.focus();
  }, []);

  function openVergroot() {
    const klein = kleinRef.current;
    if (klein) klein.pause();
    setOpen(true);
  }

  // Positie overnemen en afspelen zodra de dialoog in beeld staat; focus naar
  // de sluitknop zodat toetsenbordbediening meteen binnen de dialoog begint.
  useEffect(() => {
    if (!open) return;
    const groot = grootRef.current;
    const klein = kleinRef.current;
    if (groot && klein) {
      try {
        groot.currentTime = klein.currentTime;
      } catch {
        // Sommige browsers weigeren een seek voordat metadata geladen is.
      }
      void groot.play().catch(() => {
        // Afspelen mag geweigerd worden; de speler heeft eigen bediening.
      });
    }
    sluitRef.current?.focus();
  }, [open]);

  // Esc sluit; Tab blijft binnen de dialoog.
  useEffect(() => {
    if (!open) return;
    function opToets(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        sluit();
        return;
      }
      if (e.key !== "Tab") return;
      const houder = dialoogRef.current;
      if (!houder) return;
      const velden = houder.querySelectorAll<HTMLElement>(
        'button, video, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (velden.length === 0) return;
      const eerste = velden[0];
      const laatste = velden[velden.length - 1];
      const actief = document.activeElement;
      if (e.shiftKey && actief === eerste) {
        e.preventDefault();
        laatste.focus();
      } else if (!e.shiftKey && actief === laatste) {
        e.preventDefault();
        eerste.focus();
      }
    }
    document.addEventListener("keydown", opToets);
    return () => document.removeEventListener("keydown", opToets);
  }, [open, sluit]);

  return (
    <>
      <figure className="phone">
        <video
          ref={kleinRef}
          controls
          playsInline
          preload="none"
          poster={POSTER}
          aria-label={OMSCHRIJVING}
        >
          <source src={BRON} type="video/mp4" />
          <track
            kind="captions"
            src={ONDERTITELS}
            srcLang="nl"
            label="Nederlands"
            default
          />
        </video>
        <figcaption>
          Demonstratieomgeving met fictieve gegevens · 1:03
        </figcaption>
        <button
          ref={knopRef}
          type="button"
          className="vergroot"
          onClick={openVergroot}
        >
          <span aria-hidden="true">⤢</span> Groter bekijken
        </button>
        <details className="transcriptie">
          <summary>Lees de transcriptie</summary>
          {TRANSCRIPTIE.map((regel, i) => (
            <p key={i}>{regel}</p>
          ))}
        </details>
      </figure>

      {open && (
        <div
          ref={dialoogRef}
          className="video-licht"
          role="dialog"
          aria-modal="true"
          aria-label={`${OMSCHRIJVING} — vergrote weergave`}
          onClick={(e) => {
            if (e.target === e.currentTarget) sluit();
          }}
        >
          <button
            ref={sluitRef}
            type="button"
            className="sluit"
            onClick={sluit}
          >
            Sluiten (Esc)
          </button>
          <video
            ref={grootRef}
            controls
            playsInline
            preload="metadata"
            poster={POSTER}
            aria-label={OMSCHRIJVING}
          >
            <source src={BRON} type="video/mp4" />
            <track
              kind="captions"
              src={ONDERTITELS}
              srcLang="nl"
              label="Nederlands"
              default
            />
          </video>
          <p className="rand">
            Demonstratieomgeving met fictieve gegevens · staand formaat, vult het
            scherm niet volledig
          </p>
        </div>
      )}
    </>
  );
}
