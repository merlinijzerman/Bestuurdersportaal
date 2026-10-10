import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import ProductFeed from "../_components/ProductFeed";
import { OPEN_GRAPH_IMAGE } from "../open-graph";

// Homepage — productverhaal, institutioneel geheugen, productbeelden en
// de vijf samenhangende onderdelen van de meerwaarde.
export const metadata: Metadata = {
  title: { absolute: "Bestuurdersportaal — online besluitomgeving voor besturen" },
  description:
    "Bestuurdersportaal verbindt afwegingen, besluiten en opvolging over bestuursperiodes heen, met beheerste AI en actieve sectorgerichte duiding.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Bestuurdersportaal — online besluitomgeving voor besturen",
    description:
      "Bestuurdersportaal verbindt afwegingen, besluiten en opvolging over bestuursperiodes heen, met beheerste AI en actieve sectorgerichte duiding.",
    type: "website",
    url: "/",
    images: [OPEN_GRAPH_IMAGE],
  },
};

const verbindingen = [
  {
    naam: "Integraal overzicht",
    betekenis: "Het actuele voorstel staat in verband met eerdere besluiten, risico’s en openstaande acties.",
  },
  {
    naam: "Institutioneel geheugen",
    betekenis: "Redenen, aannames en voorwaarden blijven over bestuursperiodes heen vindbaar, ook wanneer bestuurders wisselen.",
  },
  {
    naam: "Bestuurdersperspectief AI",
    betekenis: "De assistent redeneert mee vanuit het perspectief van een bestuurder en helpt belangen, risico’s, alternatieven en gevolgen voor de organisatie expliciet te maken.",
  },
  {
    naam: "Sectorgerichte duiding",
    betekenis: "Relevante wet- en regelgeving en toezichtkaders worden actief betrokken bij de afweging, met zichtbare bronnen.",
  },
  {
    naam: "Beheerste AI",
    betekenis: "De bijdrage van de assistent blijft begrensd, brongebonden en controleerbaar.",
  },
] as const;

export default function Pagina() {
  return (
    <div className="bp-home">
      <Header />

      <section className="hero">
        <div className="grid-bg"></div>
        <div className="wrap">
          <div className="hero-single">
            <div>
              <span className="eyebrow">Voor besturen, commissies en bestuursbureaus</span>
              <h1>Een online besluitomgeving voor besturen.</h1>
              <ul className="proof">
                <li><span className="ck">—</span><span>Een digitale plek voor het voorbereiden en vastleggen van besluiten.</span></li>
                <li><span className="ck">—</span><span>Ondersteunt bij het onderbouwen en verantwoorden van complexe keuzes.</span></li>
                <li><span className="ck">—</span><span>Maakt gebruik van beheerste AI ter ondersteuning van het bestuur.</span></li>
              </ul>
              <div className="cta">
                <a href="/contact" className="btn btn-primary">Plan een live demo</a>
                <a href="/product" className="btn btn-outline">Bekijk hoe een besluitdossier werkt</a>
              </div>
              <p className="reassure">Het bestuur beslist. De onderbouwing blijft.</p>
            </div>

          </div>
        </div>
      </section>


      <section className="sec-cool" id="werkwijze">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">De afweging in beeld</div>
            <h2>Een besluit wordt sterker als ook de twijfel zichtbaar is.</h2>
            <p className="lede">
              Bronnen, risico&apos;s, aannames en alternatieven krijgen een vaste plek voordat het
              bestuur beslist.
            </p>
          </div>

          <div className="trio">
            <div className="m">
              <div className="st">Voorbereiden</div>
              <h3>Alles bij het punt waar het over gaat</h3>
              <p>Stukken, eerdere besluiten en beleid staan bij het agendapunt. De assistent stelt
                 op verzoek uw voorbereiding op, met verwijzing naar document en pagina.</p>
              <div className="res">Iedereen leest hetzelfde stuk, met dezelfde bronnen erbij.</div>
            </div>
            <div className="m">
              <div className="st">Afwegen</div>
              <h3>Twijfel krijgt een plek</h3>
              <p>Risico&apos;s krijgen een impact en een kans, aannames een onzekerheid en een
                 evaluatiecriterium. Een afwijkend standpunt wordt apart genoteerd.</p>
              <div className="res">De afweging staat op papier vóór de vergadering, niet erna.</div>
            </div>
            <div className="m">
              <div className="st">Vastleggen</div>
              <h3>Het besluit draagt zijn onderbouwing</h3>
              <p>Voorwaarden, acties en eigenaren horen bij het besluit zelf — inclusief de stand
                 van dat moment.</p>
              <div className="res">Een dossier waarin de onderbouwing direct terug te vinden is.</div>
            </div>
          </div>

        </div>
      </section>


      <section className="sec-dark" id="geheugen">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Institutioneel geheugen</div>
            <h2>Een volgend besluit hoeft niet opnieuw te beginnen.</h2>
            <p className="lede">
              Eerdere bronnen, afwegingen, voorwaarden en evaluaties blijven verbonden met het
              vraagstuk. Dat blijft ook over bestuursperiodes heen zichtbaar, wanneer de
              samenstelling van het bestuur verandert.
            </p>
          </div>

          <div className="geheugen">
            <div className="g"><h3>Bronnen</h3><p>Welke informatie aan het besluit ten grondslag lag.</p></div>
            <div className="g"><h3>Afweging</h3><p>Welke risico&apos;s, aannames en alternatieven zijn besproken.</p></div>
            <div className="g"><h3>Besluit</h3><p>Wat is besloten en onder welke voorwaarden.</p></div>
            <div className="g"><h3>Opvolging</h3><p>Welke acties en evaluatiemomenten eraan zijn verbonden.</p></div>
          </div>

          <p className="dark-note">Wat vandaag wordt afgewogen, blijft morgen beschikbaar.</p>
        </div>
      </section>


      <ProductFeed id="product" />

      <section className="sec-cool waarde-bouwstenen" id="meerwaarde">
        <div className="wrap">
          <div className="waarde-bouwstenen-grid">
            <div>
              <div className="eyebrow-label">De meerwaarde</div>
              <h2>Vijf invalshoeken. Eén doorlopende lijn.</h2>
              <p>
                Samen helpen deze onderdelen een bestuur om een vraagstuk in zijn context
                te zien, relevante kaders mee te wegen en op eerdere besluiten voort te bouwen.
              </p>
              <p className="waarde-bouwstenen-link">
                <a href="/meerwaarde" className="textlink">Zie wat dit tussen twee besluiten oplevert →</a>
              </p>
            </div>
            <dl>
              {verbindingen.map((verbinding) => (
                <div key={verbinding.naam}>
                  <dt>{verbinding.naam}</dt>
                  <dd>{verbinding.betekenis}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section id="demo">
        <div className="wrap">
          <div className="ctapanel">
            <div>
              <h2>Bekijk hoe de samenhang zichtbaar wordt.</h2>
              <p>We lopen in een live demo door één vraagstuk, van afweging tot een volgend besluit.</p>
            </div>
            <div className="acts">
              <a href="/contact" className="btn btn-primary">Plan een live demo</a>
              <a href="/product" className="textlink">Bekijk de productbeelden →</a>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
