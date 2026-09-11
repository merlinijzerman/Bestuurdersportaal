import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import { OPEN_GRAPH_IMAGE } from "../open-graph";

// /over-ons v0.8 — opent met de visie, daarna de oprichters met bio's en
// LinkedIn, de werkprincipes en de volg-ons-strook.
export const metadata: Metadata = {
  title: { absolute: "Over ons: AI die de context kent — Bestuurdersportaal" },
  description:
    "AI levert waarde als ze een specifieke bedrijfscontext begrijpt én mensen gericht ondersteunt. Wie we zijn, waar we in geloven en wat we bouwen.",
  alternates: { canonical: "/over-ons" },
  openGraph: {
    title: "Over ons: AI die de context kent — Bestuurdersportaal",
    description:
      "AI levert waarde als ze een specifieke bedrijfscontext begrijpt én mensen gericht ondersteunt. Wie we zijn, waar we in geloven en wat we bouwen.",
    type: "website",
    url: "/over-ons",
    images: [OPEN_GRAPH_IMAGE],
  },
};

export default function Pagina() {
  return (
    <div className="bp-page">
      <Header />

      <section className="sec-dark">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Visie</div>
            <h1>AI die de context kent.</h1>
            <p className="lede">
              Onze gedeelde expertise heeft geleid tot één overtuiging: AI levert pas echt waarde
              wanneer het een specifieke bedrijfscontext begrijpt én mensen daarin gericht
              ondersteunt. Daarom ontwikkelen we AI-oplossingen waarin technologie en menselijke
              expertise elkaar versterken. Zo dragen onze oplossingen bij aan meer kwaliteit,
              efficiëntie en navolgbaarheid. Bestuurdersportaal is de eerste toepassing van deze
              aanpak.
            </p>
          </div>
          <div className="geheugen">
            <div className="g"><h3>Context eerst</h3><p>Ingericht op één proces en de kaders die daar gelden, niet op algemene vragen.</p></div>
            <div className="g"><h3>Mens en techniek</h3><p>Technologie versterkt het menselijk oordeel; ze vervangt het niet.</p></div>
            <div className="g"><h3>Eerste toepassing</h3><p>Bestuurdersportaal, voor besturen en commissies — te beginnen bij pensioenfondsen.</p></div>
            <div className="g"><h3>In ontwikkeling</h3><p>We bouwen in de praktijk, samen met besturen, en publiceren wat we leren.</p></div>
          </div>
          <p className="dark-note">
            &ldquo;Een wereld waarin elke betekenisvolle beslissing wordt genomen met volledig besef
            van zowel de menselijke als de kunstmatige beperkingen.&rdquo;
          </p>
          <p style={{marginTop: '14px', color: '#8FB4D6', fontSize: '13.5px'}}>Uit het gedachtegoed van The Paradox, waarop Bestuurdersportaal is gebouwd.</p>
        </div>
      </section>

      <section className="sec-app">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">De oprichters</div>
            <h2>Gezamenlijke ontwikkeling</h2>
            <p className="lede">
              Robert brengt zijn expertise in governance en onderzoek. Merlin kent
              pensioenuitvoering en softwarearchitectuur van binnenuit. Die kennis komt niet pas
              aan het einde samen: we ontwerpen en bouwen het product gezamenlijk. Zo zijn
              techniek, praktijk en governance vanaf het begin met elkaar verbonden.
            </p>
          </div>

          <div className="bios">
            <article className="bio">
              <div className="kop">
                <div className="portret">RT</div>
                <div>
                  <div className="rol">Governance</div>
                  <h3>Robert Timmer</h3>
                </div>
              </div>
              <p>Onafhankelijk bestuursadviseur en onderzoeker, gespecialiseerd in strategie,
                 organisatieontwikkeling en mens–AI-samenwerking in besluitvorming.</p>
              <p>Met ruim twee decennia ervaring in het opbouwen en leiden van organisaties in
                 Nederland, Europa, Afrika en Azië-Pacific brengt hij strategische diepgang en
                 operationele realiteit samen in de bestuurskamer.</p>
              <p>Zijn onderzoek naar besluitvorming in het AI-tijdperk leverde het raamwerk op dat
                 onder het product ligt: dertien paradoxen, acht ontwerpprincipes en vijf nieuwe
                 dynamieken. Binnen The Paradox leidt hij de governance-lijn: toepassing van het
                 raamwerk, diagnostiek op bestuursniveau en het advies dat bepaalt hoe het platform
                 wordt ingezet.</p>
              <div className="meta">
                <span className="expertise">Strategie · Governance · Onderzoek</span>
                <a href="https://www.linkedin.com/in/roberttimmer/nl" target="_blank" rel="noopener" className="textlink">LinkedIn →</a>
              </div>
            </article>

            <article className="bio">
              <div className="kop">
                <div className="portret">MIJ</div>
                <div>
                  <div className="rol">Platform</div>
                  <h3>Merlin IJzerman</h3>
                </div>
              </div>
              <p>Business-architect en bouwer van het platform, gespecialiseerd in het vertalen
                 van bestuurlijke eisen naar werkende software.</p>
              <p>Met ruim vijftien jaar ervaring in pensioenen — van procesontwikkeling tot
                 business-architectuur — en een formele juridische achtergrond beweegt hij zich
                 moeiteloos tussen disciplines die elkaar zelden raken.</p>
              <p>Hij vertaalt de ontwerpprincipes naar een besluitomgeving die dagelijks werkt:
                 van de inrichting van een dossier tot de vastlegging die een verantwoording moet
                 kunnen dragen.</p>
              <div className="meta">
                <span className="expertise">Pensioenen · Architectuur · Recht</span>
                <a href="https://www.linkedin.com/in/merlin-ijzerman-19183a2a" target="_blank" rel="noopener" className="textlink">LinkedIn →</a>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="sec-cool">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Werkprincipes</div>
            <h2>Waar we ons aan houden.</h2>
            <p className="lede">Vier uitgangspunten die bepalen wat we wel en niet bouwen — en waar een bestuur ons op mag aanspreken.</p>
          </div>
          <div className="kaartjes">
            <div className="kaartje"><h3>Onderbouwing boven snelheid</h3><p>Een besluit is pas af als navolgbaar is waarop het rust. Wij ontwerpen liever een stap extra dan een aanname minder.</p></div>
            <div className="kaartje"><h3>Inhoud vóór zichtbaarheid</h3><p>We publiceren wanneer we iets te zeggen hebben, niet wanneer de agenda daarom vraagt.</p></div>
            <div className="kaartje"><h3>AI signaleert, mensen besluiten</h3><p>De assistent vat samen, spiegelt en stelt kritische vragen. Het oordeel blijft bij het bestuur.</p></div>
            <div className="kaartje"><h3>Eigen omgeving, eigen data</h3><p>Iedere organisatie werkt in een eigen besluitomgeving, met eigen documentatie, rollen en kaders.</p></div>
          </div>
          <div className="volgband">
            <div>
              <h3>Volg de ontwikkeling</h3>
              <p>We bouwen in de open lucht: wat we leren over besluitvorming, governance en
                 verantwoord AI-gebruik delen we onderweg.</p>
            </div>
            <a href="https://www.linkedin.com/company/bestuurdersportaal/" target="_blank" rel="noopener" className="btn btn-primary">Volg ons op LinkedIn</a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
