import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import { OPEN_GRAPH_IMAGE } from "../open-graph";

export const metadata: Metadata = {
  title: { absolute: "Meerwaarde: besluiten met context — Bestuurdersportaal" },
  description:
    "Integraal overzicht, bestuurlijk geheugen, AI vanuit bestuurdersperspectief, sectorgerichte duiding en beheerste AI komen samen rond het besluit.",
  alternates: { canonical: "/meerwaarde" },
  openGraph: {
    title: "Meerwaarde: besluiten met context — Bestuurdersportaal",
    description:
      "Zie het geheel, begrijp eerdere afwegingen en besluit met context. Ontdek de vijf samenhangende onderdelen van Bestuurdersportaal.",
    type: "website",
    url: "/meerwaarde",
    images: [OPEN_GRAPH_IMAGE],
  },
};

const onderdelen = [
  {
    nummer: "01",
    label: "Integraal overzicht",
    titel: "Zie het vraagstuk, niet alleen het agendapunt.",
    tekst:
      "Stukken, eerdere besluiten, risico’s, voorwaarden en openstaande acties horen bij hetzelfde bestuurlijke vraagstuk. Het portaal brengt die onderdelen bij elkaar, zodat zichtbaar wordt wat samenhangt en wat nog aandacht vraagt.",
    voorbeeld:
      "Bij een voorstel over uitbesteding ziet het bestuur ook de eerdere afspraken, de actuele risico’s en de acties die nog openstaan.",
    opbrengst: "Het gesprek begint met een gedeeld beeld van de situatie.",
  },
  {
    nummer: "02",
    label: "Bestuurlijk geheugen",
    titel: "Vind terug waarom het bestuur zo besloot.",
    tekst:
      "Een besluit vertelt niet vanzelf welke alternatieven zijn overwogen, welke onzekerheid is geaccepteerd en onder welke voorwaarden het bestuur akkoord ging. Het dossier houdt die afweging verbonden met het besluit en de latere opvolging.",
    voorbeeld:
      "Komt hetzelfde onderwerp maanden later terug, dan is te zien welke aannames destijds golden en welke voorwaarden inmiddels zijn getoetst.",
    opbrengst: "Een volgend besluit hoeft niet opnieuw bij nul te beginnen.",
  },
  {
    nummer: "03",
    label: "AI vanuit bestuurdersperspectief",
    titel: "Krijg vragen die de afweging verder brengen.",
    tekst:
      "De assistent helpt niet alleen bij het vinden en samenvatten van informatie. Vanuit het bestuurlijke vraagstuk kan zij ook aandachtspunten en kritische vragen formuleren: welke aanname draagt het voorstel, welk risico blijft open en welk alternatief verdient bespreking?",
    voorbeeld:
      "Voor een vergadering kan een bestuurder gericht vragen wat nog onduidelijk is in het voorstel en welke vragen aan de uitvoerder gesteld moeten worden.",
    opbrengst: "De bestuurder gaat beter voorbereid het gesprek in.",
  },
  {
    nummer: "04",
    label: "Sectorgerichte duiding",
    titel: "Plaats de eigen stukken naast relevante kaders.",
    tekst:
      "Een bestuurlijk besluit staat ook in een sectorcontext. De assistent kan relevante passages uit gecureerde wetgeving en toezichtinformatie naast de eigen documentatie leggen, met verwijzingen naar de gebruikte bronnen.",
    voorbeeld:
      "Bij een pensioenvraagstuk wordt duidelijk welke sectorbron mogelijk relevant is en wat in de eigen stukken over dat onderwerp staat.",
    opbrengst: "Bestuurders kunnen de bron zelf raadplegen en wegen wat die betekent.",
  },
] as const;

export default function Pagina() {
  return (
    <div className="bp-page bp-meerwaarde">
      <Header actief="/meerwaarde" />

      <main>
        <section className="phero waarde-hero">
          <div className="grid-bg" />
          <div className="wrap waarde-hero-layout">
            <div>
              <div className="eyebrow-label">De meerwaarde</div>
              <h1>Een besluit staat nooit op zichzelf.</h1>
              <p className="lede">
                Zie het geheel. Begrijp wat eerder is afgewogen. Stel de vragen die er nu toe
                doen. Bestuurdersportaal verbindt de context van een besluit en houdt haar
                beschikbaar voor het volgende.
              </p>
              <div className="cta">
                <a href="#vijf-onderdelen" className="btn btn-primary">Ontdek de vijf onderdelen</a>
                <a href="/product" className="btn btn-outline">Bekijk het product</a>
              </div>
            </div>
            <aside className="waarde-hero-kader" aria-label="Drie vragen bij elk besluit">
              <span className="waarde-kader-label">Bij ieder bestuurlijk vraagstuk</span>
              <p><span>01</span> Wat speelt er nu?</p>
              <p><span>02</span> Waarom kozen we eerder zo?</p>
              <p><span>03</span> Wat vraagt dit besluit van ons?</p>
              <div className="waarde-kader-slot">Eén dossier dat de antwoorden bij elkaar houdt.</div>
            </aside>
          </div>
        </section>

        <section className="sec-cool waarde-inleiding">
          <div className="wrap waarde-inleiding-grid">
            <div className="eyebrow-label">De kern</div>
            <div>
              <h2>Niet alleen informatie bewaren. De bestuurlijke samenhang bewaren.</h2>
              <p>
                Een document laat zien wat er op papier stond. Voor een volgend besluit is ook
                nodig te weten hoe het bestuur die informatie heeft gewogen, wat het besloot en
                welke voorwaarden daarna bleven gelden. Daar komen overzicht, geheugen en AI
                samen.
              </p>
            </div>
          </div>
        </section>

        <section className="sec-app waarde-onderdelen" id="vijf-onderdelen">
          <div className="wrap">
            <div className="sec-head">
              <div className="eyebrow-label">Vijf onderdelen, één besluitcontext</div>
              <h2>Wat een bestuurder eraan heeft.</h2>
              <p className="lede">Elk onderdeel helpt op een ander moment in hetzelfde besluitproces.</p>
            </div>
            <div className="waarde-lijst">
              {onderdelen.map((onderdeel) => (
                <article className="waarde-onderdeel" key={onderdeel.nummer}>
                  <div className="waarde-nummer" aria-hidden="true">{onderdeel.nummer}</div>
                  <div className="waarde-tekst">
                    <div className="eyebrow-label">{onderdeel.label}</div>
                    <h3>{onderdeel.titel}</h3>
                    <p>{onderdeel.tekst}</p>
                  </div>
                  <div className="waarde-voorbeeld">
                    <span>In de praktijk</span>
                    <p>{onderdeel.voorbeeld}</p>
                    <strong>{onderdeel.opbrengst}</strong>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="sec-dark waarde-beheerst" id="beheerste-ai">
          <div className="wrap">
            <div className="waarde-beheerst-kop">
              <div>
                <div className="eyebrow-label">05 · Beheerste AI</div>
                <h2>AI is pas waardevol als haar grenzen zichtbaar zijn.</h2>
              </div>
              <p className="lede">
                De assistent helpt zoeken, ordenen en bevragen. Zij werkt met afgebakende
                documentcontext, toont gebruikte bronnen en laat ontbrekende informatie
                herkenbaar. Zo kan het bestuur haar bijdrage controleren en zelf blijven wegen.
              </p>
            </div>
            <div className="waarde-grenzen">
              <div><span>Brongebonden</span><p>Bij antwoorden is zichtbaar op welke documenten en passages zij steunen.</p></div>
              <div><span>Afgebakend</span><p>Rollen, rechten en de gekozen dossiercontext bepalen welke informatie beschikbaar is.</p></div>
              <div><span>Navolgbaar</span><p>Relevant AI-gebruik en de onderbouwing van het besluit blijven controleerbaar.</p></div>
              <div><span>Menselijk oordeel</span><p>De assistent stelt vragen en signaleert. Het bestuur maakt de afweging en neemt het besluit.</p></div>
            </div>
            <p className="waarde-beheerst-slot">Het bestuur beslist. De onderbouwing blijft.</p>
            <a href="/governance-ai" className="waarde-donker-link">Lees hoe we AI begrenzen →</a>
          </div>
        </section>

        <section className="sec-cool waarde-verhaal">
          <div className="wrap waarde-verhaal-grid">
            <div>
              <div className="eyebrow-label">Alles komt samen</div>
              <h2>Van een voorstel naar een besluit dat verder kan.</h2>
              <p>
                Een voorstel over uitbesteding komt op de agenda. Het portaal toont de stukken,
                eerdere voorwaarden en openstaande risico&apos;s. De assistent helpt kritische
                vragen formuleren en wijst op relevante sectorbronnen. Het bestuur weegt,
                besluit en legt vast wat opgevolgd moet worden. Bij een volgende bespreking is
                die hele lijn terug te vinden.
              </p>
            </div>
            <ol className="waarde-stappen">
              <li><span>Voorbereiden</span><p>Wat weten we en wat ontbreekt nog?</p></li>
              <li><span>Afwegen</span><p>Welke risico&apos;s, alternatieven en kaders tellen mee?</p></li>
              <li><span>Besluiten</span><p>Waarom kiezen we hiervoor en onder welke voorwaarden?</p></li>
              <li><span>Opvolgen</span><p>Wat is gebeurd en wat vraagt opnieuw aandacht?</p></li>
            </ol>
          </div>
        </section>

        <section className="sec-app">
          <div className="wrap">
            <div className="ctapanel">
              <div>
                <div className="eyebrow-label">Bekijk het in een dossier</div>
                <h2>Ervaar hoe de samenhang zichtbaar wordt.</h2>
                <p>In een live demo lopen we door voorbereiding, afweging, besluit en opvolging.</p>
              </div>
              <div className="acts">
                <a href="/contact" className="btn btn-primary">Plan een live demo</a>
                <a href="/product" className="textlink">Bekijk eerst de productbeelden →</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
