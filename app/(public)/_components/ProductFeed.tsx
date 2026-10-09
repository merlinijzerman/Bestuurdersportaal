"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const stories = [
  {
    category: "Vergaderingen",
    title: "De stukken en de vraag komen bij elkaar",
    summary: "Voorstel, samenvatting en gerichte verdieping staan bij het agendapunt waarover wordt besloten.",
    image: "/website/01-voorbereiding-agendapunt.png",
    alt: "Agendapunt met voorstel, samenvatting en verdiepingsvragen.",
    caption: "Voorbereiding bij het agendapunt · demonstratiedata",
    details: [
      "Stukken koppelen uit de bibliotheek of direct uploaden.",
      "Een samenvatting per stuk, met het gevraagde besluit erbij.",
      "Aandachtspunten of kritische vragen opvragen voor de vergadering.",
      "Eigen aantekeningen en inbreng vooraf van andere leden.",
    ],
  },
  {
    category: "AI-assistent",
    title: "Ondersteuning die haar bronnen laat zien",
    summary: "De assistent gebruikt uw bibliotheek en dossiers en toont onder elk antwoord de gebruikte bronnen.",
    image: "/website/02-antwoorden-zichtbare-bronnen.png",
    alt: "Antwoord van de AI-assistent met onderbouwing en bronnen.",
    caption: "Antwoorden met zichtbare bronnen · demonstratiedata",
    details: [
      "U kiest wat u terugkrijgt: samenvatting, aandachtspunten of kritische vragen.",
      "De assistent zoekt ook in een centraal gecureerd kader met wet- en regelgeving en toezichtdocumentatie.",
      "Verwijzing per stelling: document, hoofdstuk en pagina.",
      "Zichtbaar of het antwoord alleen op eigen documenten rust.",
      "Doorvragen blijft in hetzelfde spoor.",
    ],
  },
  {
    category: "Besluitdossier",
    title: "Aannames, risico’s en voorwaarden blijven zichtbaar",
    summary: "Het dossier laat zien welke afwegingen een besluit dragen en wat nog openstaat.",
    image: "/website/03-risicos-en-aannames.png",
    alt: "Onderbouwingspaneel met aannames, risico's en voorwaarden.",
    caption: "De afweging wordt expliciet · demonstratiedata",
    details: [
      "Aannames met een onzekerheid en een evaluatiecriterium.",
      "Risico’s met impact, kans, categorie en beheersmaatregel.",
      "Voorwaarden met KPI, drempelwaarde en monitorfrequentie.",
      "Afwijkende standpunten worden apart genoteerd.",
    ],
  },
  {
    category: "Processen",
    title: "Elke stap laat zien wat nog ontbreekt",
    summary: "Bij de actieve stap ziet u wat gereed is, wat nog moet gebeuren en wie aan zet is.",
    image: "/website/04-besluit-heeft-een-route.png",
    alt: "Fasen van een besluitproces met actieve stap en openstaande vereisten.",
    caption: "Het besluit heeft een route · demonstratiedata",
    details: [
      "Van aanleiding en intake via onderbouwing en kaderscheck naar bestuursoverleg.",
      "Daarna volgen vastlegging, implementatie en evaluatie.",
      "Een stap sluit pas als de checklist en het vereiste bewijsstuk er zijn.",
      "Doorgaan mag met een reden die wordt vastgelegd.",
    ],
  },
  {
    category: "Afschrift en audit",
    title: "Het besluit draagt zijn motivering",
    summary: "Besluit, verworpen alternatieven, voorwaarden en opvolging blijven bij elkaar.",
    image: "/website/05-besluit-en-voorwaarden.png",
    alt: "Vastgelegd besluit met motivering, alternatieven en voorwaarden.",
    caption: "Besluit en voorwaarden vastgelegd · demonstratiedata",
    details: [
      "Een afschrift van het besluitmoment als bevroren snapshot.",
      "Een auditdossier van de huidige stand of van dat moment.",
      "Acties gekoppeld aan de voorwaarde die ze bewaken, met eigenaar en termijn.",
    ],
  },
  {
    category: "Integratiemogelijkheden",
    title: "Een optionele koppeling met Microsoft 365",
    summary: "SharePoint-documenten blijven in hun bestaande omgeving en kunnen als bron aan het dossier worden verbonden.",
    image: "/website/06-microsoft-365-sharepoint.png",
    alt: "Illustratie van een optionele koppeling tussen Microsoft 365, SharePoint en het besluitdossier.",
    caption: "Optionele Microsoft 365-integratie · illustratieve weergave, geen applicatiescherm",
    details: [
      "Documenten uit SharePoint kunnen als bron aan het dossier worden verbonden.",
      "Gebruikers kunnen via hun vertrouwde werkaccount inloggen.",
      "Deze afbeelding is een illustratie, geen applicatiescherm.",
    ],
  },
] as const;

export default function ProductFeed({ id }: { id?: string }) {
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (selected !== null && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [selected]);

  function move(direction: number) {
    setSelected((current) => current === null ? null : (current + direction + stories.length) % stories.length);
  }

  function showCard(index: number) {
    const list = listRef.current;
    const card = list?.children[index] as HTMLElement | undefined;
    if (!list || !card) return;
    setActive(index);
    list.scrollTo({
      left: card.offsetLeft,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  function updateActive() {
    const list = listRef.current;
    if (!list) return;
    const cards = Array.from(list.children) as HTMLElement[];
    const nearest = cards.reduce((best, card, index) =>
      Math.abs(card.offsetLeft - list.scrollLeft) < Math.abs(cards[best].offsetLeft - list.scrollLeft) ? index : best, 0);
    setActive(nearest);
  }

  const story = stories[selected ?? 0];

  return (
    <section id={id} className="product-feed sec-app" aria-labelledby="product-feed-title">
      <div className="wrap">
        <div className="product-feed-intro">
          <div className="eyebrow-label">Kijk mee in het portaal</div>
          <h2 id="product-feed-title">Het besluitproces in beeld</h2>
          <p>Blader met de pijlen door zes impressies van het product. Op mobiel kunt u ook vegen. Open een kaart om het beeld groter te bekijken.</p>
        </div>
        <div className="product-feed-controls" aria-label="Blader door de productbeelden">
          <span className="product-feed-count" aria-live="polite">{String(active + 1).padStart(2, "0")} / 06</span>
          <div className="product-feed-arrows">
            <button type="button" onClick={() => showCard(active - 1)} disabled={active === 0}>← Vorige</button>
            <button type="button" onClick={() => showCard(active + 1)} disabled={active === stories.length - 1}>Volgende →</button>
          </div>
        </div>
        <div className="product-feed-list" ref={listRef} onScroll={updateActive} aria-label="Productbeelden">
          {stories.map((item, index) => (
            <article className="product-story" key={item.image} aria-label={`Beeld ${index + 1} van ${stories.length}`}>
              <button
                type="button"
                className="product-story-button"
                aria-label={`Bekijk ${item.category.toLowerCase()}: ${item.title}`}
                onClick={(event) => {
                  triggerRef.current = event.currentTarget;
                  setSelected(index);
                }}
              >
                <span className="product-story-image">
                  <Image src={item.image} width={1200} height={675} sizes="(max-width: 800px) 100vw, 760px" alt={item.alt} />
                </span>
                <span className="product-story-body">
                  <span className="product-story-meta"><span>{item.category}</span><span>{String(index + 1).padStart(2, "0")} / 06</span></span>
                  <span className="product-story-title">{item.title}</span>
                  <span className="product-story-summary">{item.summary}</span>
                  <span className="product-story-foot"><span>Bestuurdersportaal · {index === 5 ? "illustratie" : "demonstratiedata"}</span><span aria-hidden="true">Bekijk scherm ↗</span></span>
                </span>
              </button>
            </article>
          ))}
        </div>
        <div className="product-feed-dots" aria-label="Kies een productbeeld">
          {stories.map((item, index) => (
            <button key={item.image} type="button" aria-label={`Ga naar beeld ${index + 1}: ${item.category}`} aria-current={active === index ? "true" : undefined} onClick={() => showCard(index)} />
          ))}
        </div>
      </div>

      {selected !== null && (
        <dialog
          ref={dialogRef}
          className="product-dialog"
          aria-label={`${story.category}: ${story.title}`}
          onClose={() => {
            setSelected(null);
            triggerRef.current?.focus();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
            if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
          }}
        >
          <div className="product-dialog-top">
            <span>{String(selected + 1).padStart(2, "0")} / 06 · {story.category}</span>
            <button type="button" className="product-dialog-close" onClick={() => dialogRef.current?.close()}>Sluiten <span aria-hidden="true">×</span></button>
          </div>
          <div className="product-dialog-content">
            <div className="product-dialog-image"><Image src={story.image} width={1200} height={675} sizes="(max-width: 900px) 100vw, 900px" alt={story.alt} /></div>
            <div className="product-dialog-copy">
              <p className="product-dialog-caption">{story.caption}</p>
              <h2>{story.title}</h2>
              <p>{story.summary}</p>
              <ul>{story.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
            </div>
          </div>
          <div className="product-dialog-nav">
            <button type="button" onClick={() => move(-1)}>← Vorige</button>
            <button type="button" onClick={() => move(1)}>Volgende →</button>
          </div>
        </dialog>
      )}
    </section>
  );
}
