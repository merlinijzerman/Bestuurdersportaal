import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import ProductFeed from "../_components/ProductFeed";
import { OPEN_GRAPH_IMAGE } from "../open-graph";

// Homepage v0.8 — productomschrijving, drie momenten, bestuurlijk geheugen,
// zes productfragmenten, brongebonden AI en de pilot-CTA.
export const metadata: Metadata = {
  title: { absolute: "Bestuurdersportaal — online besluitomgeving voor besturen" },
  description:
    "Eén digitale plek om bestuursbesluiten voor te bereiden, te onderbouwen en vast te leggen. Met beheerste AI die laat zien welke bronnen zijn gebruikt.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Bestuurdersportaal — online besluitomgeving voor besturen",
    description:
      "Eén digitale plek om bestuursbesluiten voor te bereiden, te onderbouwen en vast te leggen. Met beheerste AI die laat zien welke bronnen zijn gebruikt.",
    type: "website",
    url: "/",
    images: [OPEN_GRAPH_IMAGE],
  },
};

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
            <div className="eyebrow-label">Bestuurlijk geheugen</div>
            <h2>Een volgend besluit hoeft niet opnieuw te beginnen.</h2>
            <p className="lede">
              Eerdere bronnen, afwegingen, voorwaarden en evaluaties blijven verbonden met het
              vraagstuk. Zichtbaar blijft wat eerder is besloten, waarom, en wat daarvan is geleerd.
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

      <section className="sec-cool" id="ai">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">AI &amp; governance</div>
            <h2>AI mag helpen zoeken. Niet ongemerkt sturen.</h2>
          </div>
          <div className="ai-grid">
            <div className="pr"><h3>Uw eigen documentatie</h3><p>De assistent zoekt in uw bibliotheek, uw dossiers en uw eerdere besluiten.</p></div>
            <div className="pr"><h3>Zichtbare bronnen</h3><p>Brongebonden antwoorden tonen de gebruikte bronnen: document, hoofdstuk, pagina.</p></div>
            <div className="pr"><h3>Ontbrekend blijft ontbrekend</h3><p>Wat niet uit uw documenten komt, wordt als zodanig gemarkeerd — niet ingevuld.</p></div>
            <div className="pr"><h3>Het oordeel blijft van u</h3><p>De assistent ordent en bevraagt. Wegen en besluiten doet het bestuur.</p></div>
          </div>
          <p style={{marginTop: '26px'}}><a href="/governance-ai" className="textlink">Zo begrenzen we het AI-gebruik →</a></p>
        </div>
      </section>


      <section id="demo">
        <div className="wrap">
          <div className="pilot">
            <div>
              <div className="eyebrow-label">Pilot</div>
              <h2>Begin afgebakend met één dossier.</h2>
              <p>
                We richten uw besluitomgeving in met uw eigen documentatie en werken één lopend
                vraagstuk uit. Daarna beoordeelt u het resultaat aan uw eigen maatstaf.
              </p>
            </div>
            <div>
              <div className="eyebrow-label">Wat u nodig heeft</div>
              <ul className="need">
                <li><span className="ck">—</span><span>Eén bestuurlijk vraagstuk dat er echt toe doet.</span></li>
                <li><span className="ck">—</span><span>De stukken en eerdere besluiten die erbij horen.</span></li>
                <li><span className="ck">—</span><span>Een aanspreekpunt in het bestuursbureau of secretariaat.</span></li>
              </ul>
            </div>
          </div>

          <div className="ctapanel">
            <div>
              <h2>Bekijk een herkenbaar besluitdossier in een live demo.</h2>
              <p>Dertig minuten, online: voorbereiding, afweging, besluit en opvolging.</p>
            </div>
            <div className="acts">
              <a href="/contact" className="btn btn-primary">Plan een live demo</a>
              <a href="/contact?type=pilot" className="btn btn-outline">Bespreek daarna een pilot met uw eigen dossier</a>
              <span className="fine">Geen voorbereiding nodig.</span>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
