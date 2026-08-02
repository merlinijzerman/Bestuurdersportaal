"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Telefoonkader met de promovideo op de homepage ("Zie het in actie").
// Bewust homepage-specifiek en niet generiek: /product houdt zijn Voorbeeldflow
// en krijgt geen video (werkopdracht §2.1, "buiten scope").
//
// Toegankelijkheid (WCAG 2.1 AA, REQ-PV-060):
//  - nooit autoplay — de video heeft een gesproken voice-over. De vergrote
//    weergave speelt alleen door als de kleine speler al liep;
//  - preload="none" + poster, zodat bij binnenkomst alleen ~36 kB laadt;
//  - ondertiteling via <track>, maar bewust ZONDER `default`: de video draagt
//    dezelfde tekst al ingebrand in beeld, dus een standaard zichtbaar
//    ondertitelblok valt daar bovenop en maakt beide slecht leesbaar. Het spoor
//    blijft aan te zetten via het ondertitelmenu van de speler, en de volledige
//    tekst staat daarnaast als uitklapbare transcriptie op de pagina — de
//    inhoud is dus ook zonder video en zonder geluid toegankelijk;
//  - de vergrote weergave is een echte dialoog: role/aria-modal, Esc, klik
//    naast de video, focus blijft binnen de dialoog en keert na sluiten terug
//    naar de knop.
//
// De focus wordt vastgehouden met twee sentinels en NIET door Tab af te vangen.
// Reden: de bediening van een native <video> zit in een shadow root, en
// document.activeElement wijst dan naar het <video>-element zelf. Een
// Tab-handler die op activeElement vergelijkt, houdt de speler-knoppen daardoor
// buiten de tabvolgorde — precies het tegenovergestelde van wat een focus-trap
// moet doen. Sentinels hebben die kennis niet nodig.
//
// De ingebouwde volledig-scherm-knop van de speler blijft gewoon werken; Esc
// wordt dan aan de fullscreen-exit gelaten en sluit de dialoog niet mee.

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
  "Ervaar het Bestuurdersportaal. Demonstratiegegevens.",
];

export default function DemoVideo() {
  const [open, setOpen] = useState(false);
  const kleinRef = useRef<HTMLVideoElement>(null);
  const grootRef = useRef<HTMLVideoElement>(null);
  const knopRef = useRef<HTMLButtonElement>(null);
  const sluitRef = useRef<HTMLButtonElement>(null);
  const liepAlRef = useRef(false);

  const sluit = useCallback(() => {
    const groot = grootRef.current;
    const klein = kleinRef.current;
    // Kijkpositie terug naar de kleine speler, zodat sluiten geen voortgang kost.
    if (groot && klein) {
      try {
        klein.currentTime = groot.currentTime;
      } catch {
        // Seek mag geweigerd worden voordat metadata geladen is.
      }
    }
    groot?.pause();
    setOpen(false);
    knopRef.current?.focus();
  }, []);

  function openVergroot() {
    const klein = kleinRef.current;
    liepAlRef.current = !!klein && !klein.paused;
    klein?.pause();
    setOpen(true);
  }

  // Positie overnemen zodra de dialoog in beeld staat, en alleen doorspelen als
  // de kleine speler al liep. Focus naar de sluitknop, zodat toetsenbord-
  // bediening binnen de dialoog begint.
  useEffect(() => {
    if (!open) return;
    const groot = grootRef.current;
    const klein = kleinRef.current;
    if (groot && klein) {
      try {
        groot.currentTime = klein.currentTime;
      } catch {
        // Zie hierboven.
      }
      if (liepAlRef.current) {
        void groot.play().catch(() => {
          // Afspelen mag geweigerd worden; de speler heeft eigen bediening.
        });
      }
    }
    sluitRef.current?.focus();
  }, [open]);

  // Esc sluit — behalve wanneer de speler in volledig scherm staat, want dan is
  // Esc van de browser en zou de dialoog ongevraagd meesluiten.
  useEffect(() => {
    if (!open) return;
    function opToets(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (document.fullscreenElement) return;
      e.preventDefault();
      sluit();
    }
    document.addEventListener("keydown", opToets);
    return () => document.removeEventListener("keydown", opToets);
  }, [open, sluit]);

  // Achtergrond niet laten meescrollen zolang de dialoog open staat.
  useEffect(() => {
    if (!open) return;
    const vorige = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = vorige;
    };
  }, [open]);

  return (
    <>
      <div className="phone">
        <figure>
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
            />
          </video>
          <figcaption>
            Demonstratiegegevens · 1:03
          </figcaption>
        </figure>
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
      </div>

      {open && (
        <div
          className="video-licht"
          role="dialog"
          aria-modal="true"
          aria-label={`${OMSCHRIJVING} — vergrote weergave`}
          onClick={(e) => {
            if (e.target === e.currentTarget) sluit();
          }}
        >
          <span
            tabIndex={0}
            aria-hidden="true"
            onFocus={() => grootRef.current?.focus()}
          />
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
            />
          </video>
          <p className="rand">
            Demonstratiegegevens · staand formaat, vult het
            scherm niet volledig
          </p>
          <span
            tabIndex={0}
            aria-hidden="true"
            onFocus={() => sluitRef.current?.focus()}
          />
        </div>
      )}
    </>
  );
}
