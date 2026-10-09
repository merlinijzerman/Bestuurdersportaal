import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import { OPEN_GRAPH_IMAGE } from "../open-graph";

export const metadata: Metadata = {
  title: { absolute: "Meerwaarde: context tussen besluiten — Bestuurdersportaal" },
  description:
    "De bestuurlijke afweging blijft verbonden met het besluit en de opvolging. Ontdek wat dat betekent wanneer een vraagstuk later terugkomt.",
  alternates: { canonical: "/meerwaarde" },
  openGraph: {
    title: "Meerwaarde: context tussen besluiten — Bestuurdersportaal",
    description:
      "Wat woog mee, welke voorwaarden golden en wat veranderde sindsdien? Bestuurdersportaal houdt de bestuurlijke lijn bij elkaar.",
    type: "website",
    url: "/meerwaarde",
    images: [OPEN_GRAPH_IMAGE],
  },
};

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
              <h1>De waarde zit tussen twee besluiten.</h1>
              <p className="lede">
                Als een vraagstuk terugkomt, wil een bestuur meer weten dan wat destijds is
                besloten. Wat woog mee? Welke voorwaarden golden? Wat veranderde sindsdien?
                Bestuurdersportaal houdt die bestuurlijke lijn bij elkaar.
              </p>
              <div className="cta">
                <a href="#in-de-praktijk" className="btn btn-primary">Zie wat dit oplevert</a>
                <a href="/product" className="btn btn-outline">Bekijk het product</a>
              </div>
            </div>
            <aside className="waarde-hero-kader" aria-label="De lijn tussen twee besluiten">
              <span className="waarde-kader-label">Eén bestuurlijk vraagstuk</span>
              <p><span>NU</span> Een besluit met voorwaarden</p>
              <p><span>LATER</span> Een nieuwe vraag over hetzelfde onderwerp</p>
              <p><span>ERTUSSEN</span> De vastgelegde afweging en opvolging</p>
              <div className="waarde-kader-slot">De context blijft beschikbaar wanneer zij weer nodig is.</div>
            </aside>
          </div>
        </section>

        <section className="sec-cool waarde-inleiding">
          <div className="wrap waarde-inleiding-grid">
            <div className="eyebrow-label">Het onderscheid</div>
            <div>
              <h2>Een volgend bestuur kan voortbouwen op de afweging van toen.</h2>
              <p>
                Een archief bewaart het voorstel en het besluit. De bestuurlijke vraag komt
                later terug in een andere situatie, met andere mensen en mogelijk nieuwe
                informatie. Dan is de redeneerlijn nodig: welke onzekerheid werd geaccepteerd,
                waarom, en welke afspraak moest daarna worden gevolgd?
              </p>
            </div>
          </div>
        </section>

        <section className="sec-app waarde-casus" id="in-de-praktijk">
          <div className="wrap">
            <div className="sec-head">
              <div className="eyebrow-label">Een voorbeeld uit de bestuurspraktijk</div>
              <h2>Een uitbestedingsbesluit komt opnieuw op tafel.</h2>
              <p className="lede">
                De waarde van het dossier blijkt wanneer dezelfde bestuurlijke vraag later
                vanuit een nieuw perspectief moet worden bekeken.
              </p>
            </div>
            <div className="waarde-casus-grid">
              <article>
                <span className="waarde-moment">Vandaag · het eerste besluit</span>
                <h3>Waarom gaan we akkoord?</h3>
                <p>
                  Het bestuur bespreekt het voorstel, de risico’s en een alternatief. Het
                  legt vast welke aannames doorslaggevend zijn, welke voorwaarden gelden
                  en wanneer die worden geëvalueerd.
                </p>
              </article>
              <article>
                <span className="waarde-moment">Later · de herbeoordeling</span>
                <h3>Gelden onze redenen nog?</h3>
                <p>
                  Ook na een bestuurswisseling zijn de eerdere afweging en voorwaarden
                  beschikbaar. Het bestuur kan toetsen wat is opgevolgd, wat veranderde
                  en welke vragen nu opnieuw gesteld moeten worden.
                </p>
              </article>
            </div>
            <p className="waarde-casus-slot">
              De verbinding tussen deze momenten maakt van vastlegging een institutioneel
              geheugen dat bestuursperiodes overbrugt.
            </p>
          </div>
        </section>

        <section className="sec-dark waarde-ai">
          <div className="wrap waarde-ai-grid">
            <div>
              <div className="eyebrow-label">De rol van beheerste AI</div>
              <h2>Onderzoek de samenhang. Houd het oordeel bij het bestuur.</h2>
            </div>
            <div>
              <p>
                Bij een nieuwe bespreking kan de assistent eerdere aannames en de eigen
                stukken verbinden met relevante wet- en regelgeving en toezichtinformatie.
                Zij brengt die kaders actief in bij de voorbereiding, helpt kritische
                vragen formuleren en toont waarop haar antwoorden steunen. Zo kan het
                bestuur de bijdrage controleren en zelf wegen wat die betekent voor het
                besluit van vandaag.
              </p>
              <a href="/governance-ai" className="waarde-donker-link">
                Lees hoe het AI-gebruik is begrensd →
              </a>
            </div>
          </div>
        </section>

        <section className="sec-app">
          <div className="wrap">
            <div className="ctapanel">
              <div>
                <div className="eyebrow-label">Bekijk de samenhang</div>
                <h2>Volg één vraagstuk door twee besluitmomenten.</h2>
                <p>In een live demo laten we zien wat een volgend besluit aan de eerdere afweging heeft.</p>
              </div>
              <div className="acts">
                <a href="/contact" className="btn btn-primary">Plan een live demo</a>
                <a href="/product" className="textlink">Bekijk de productbeelden →</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
