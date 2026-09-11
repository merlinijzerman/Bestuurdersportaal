import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import { OPEN_GRAPH_IMAGE } from "../open-graph";

// /governance-ai v0.8 — kop losgetrokken van de homepagekop om dubbeling
// te voorkomen.
export const metadata: Metadata = {
  title: { absolute: "AI & governance: begrensd en navolgbaar — Bestuurdersportaal" },
  description:
    "Hoe wij AI-gebruik begrenzen: werken vanuit uw eigen documentatie, zichtbare bronnen per antwoord, rollen en rechten, en een reconstrueerbaar spoor.",
  alternates: { canonical: "/governance-ai" },
  openGraph: {
    title: "AI & governance: begrensd en navolgbaar — Bestuurdersportaal",
    description:
      "Hoe wij AI-gebruik begrenzen: werken vanuit uw eigen documentatie, zichtbare bronnen per antwoord, rollen en rechten, en een reconstrueerbaar spoor.",
    type: "website",
    url: "/governance-ai",
    images: [OPEN_GRAPH_IMAGE],
  },
};

export default function Pagina() {
  return (
    <div className="bp-page">
      <Header actief="/governance-ai" />

      <section className="phero">
        <div className="grid-bg"></div>
        <div className="wrap">
          <div className="eyebrow-label">AI &amp; governance</div>
          <h1>Begrensd, zichtbaar en navolgbaar.</h1>
          <p className="lede">
            In een bestuurlijke context telt niet alleen wat AI kan, maar hoe het gebruik is
            begrensd. Hieronder waar wij ons aan houden — en waar u ons op mag aanspreken.
          </p>
          <p><a href="/product" className="textlink">Bekijk hoe een besluitdossier werkt →</a></p>
        </div>
      </section>

      <section className="sec-cool">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Uitgangspunten</div>
            <h2>Vijf uitgangspunten voor verantwoord AI-gebruik.</h2>
          </div>
          <div className="kaartjes">
            <div className="kaartje"><h3>Werkt binnen uw eigen documentatie</h3><p>De assistent zoekt in uw bibliotheek, uw dossiers en uw eerdere besluiten, en in een centraal gecureerd kader met wet- en regelgeving — niet in een onzichtbaar achtergrondmodel.</p></div>
            <div className="kaartje"><h3>Feit en duiding gescheiden</h3><p>Het verschil tussen wat er staat en wat een interpretatie is, blijft expliciet.</p></div>
            <div className="kaartje"><h3>Aannames zichtbaar</h3><p>Aannames, risico&apos;s en onzekerheden worden benoemd, niet weggepoetst.</p></div>
            <div className="kaartje"><h3>Rollen en rechten</h3><p>Wie wat mag zien en doen volgt de governance van uw organisatie, per orgaan en commissie.</p></div>
            <div className="kaartje"><h3>Reconstrueerbaar</h3><p>Een audittrail maakt achteraf navolgbaar hoe een besluit tot stand kwam.</p></div>
          </div>
          <p className="sharp">De assistent ordent en bevraagt. Wegen en besluiten doet het bestuur.</p>
        </div>
      </section>

      <section className="sec-app">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Grenzen</div>
            <h2>Wat het wel en niet doet.</h2>
          </div>
          <div className="duo">
            <div className="kol">
              <div className="tag">Wel</div>
              <ul>
                <li><span className="ck">—</span><span>Ordenen, toetsen en signaleren, met verwijzing naar de bron.</span></li>
                <li><span className="ck">—</span><span>Aannames, risico&apos;s en afwegingen zichtbaar maken.</span></li>
                <li><span className="ck">—</span><span>Navolgbaar vastleggen hoe een besluit tot stand kwam.</span></li>
              </ul>
            </div>
            <div className="kol">
              <div className="tag">Niet</div>
              <ul>
                <li><span className="ck">—</span><span>Besluiten nemen in plaats van het bestuur.</span></li>
                <li><span className="ck">—</span><span>Uitspraken doen namens toezichthouders.</span></li>
                <li><span className="ck">—</span><span>Advies geven dat de verantwoordelijkheid van het bestuur overneemt.</span></li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="sec-cool">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Veiligheid en vertrouwen</div>
            <h2>Zorgvuldig met informatie.</h2>
            <p className="lede">
              Elke organisatie werkt in een eigen ingerichte omgeving. Definitieve beveiligings-
              en verwerkingsafspraken worden per organisatie vastgelegd.
            </p>
          </div>
          <ul className="lijst" style={{maxWidth: '74ch'}}>
            <li><span className="ck">—</span><span>Een eigen omgeving per organisatie, met eigen documentcontext.</span></li>
            <li><span className="ck">—</span><span>Toegang op basis van rollen en rechten.</span></li>
            <li><span className="ck">—</span><span>Logging van relevante handelingen, ten behoeve van controleerbaarheid.</span></li>
            <li><span className="ck">—</span><span>Beheerde documentcontext: de assistent werkt binnen het afgebakende dossier.</span></li>
            <li><span className="ck">—</span><span>Aandacht voor privacy, informatiebeveiliging en verantwoord AI-gebruik.</span></li>
          </ul>
        </div>
      </section>

      <section className="sec-app">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">EU AI Act</div>
            <h2>Dezelfde uitgangspunten, nu ook wettelijk.</h2>
            <p className="lede">
              De EU AI Act versterkt wat hierboven staat: brongebonden werken, menselijk toezicht,
              transparantie en verantwoording. Bestuurdersportaal helpt die randvoorwaarden in de
              bestuurspraktijk in te richten — met het oordeel bij het bestuur.
            </p>
          </div>
          <p><a href="/governance-ai/eu-ai-act" className="textlink">EU AI Act en verantwoord AI-gebruik →</a></p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
