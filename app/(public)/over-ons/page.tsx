import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import Crumb from "../_components/Crumb";
import CtaBand from "../_components/CtaBand";

// /over-ons — Over (copy v0.2 §6, uitgebouwd bij besluit 0103). Sinds The
// Paradox uit de hoofdnavigatie is gehaald, is dit de pagina die het eigen
// gezicht draagt: oprichters, werkprincipes, herkomst en visie. Bescheiden en
// claim-veilig (contentplan §0.1/§4): geen certificerings-, hosting- of
// encryptieclaims, geen juridische of actuariële uitspraken, en in de bio's
// alleen aangeleverde feiten.
//
// Het label in de navigatie is "Over"; de <h1> blijft "Over Bestuurdersportaal".
// De URL is bewust ongewijzigd — geen redirect, geen SEO-breuk.
const OMSCHRIJVING =
  "Wie Bestuurdersportaal bouwen, waar we ons aan houden en waar we naartoe werken — een besluitomgeving die voortkomt uit het besluitvormingsdenken van The Paradox.";

export const metadata: Metadata = {
  title: { absolute: "Over Bestuurdersportaal" },
  description: OMSCHRIJVING,
  alternates: { canonical: "/over-ons" },
  openGraph: {
    title: "Over Bestuurdersportaal",
    description: OMSCHRIJVING,
    type: "website",
    url: "/over-ons",
  },
};

// Vertaald naar de Bestuurdersportaal-context in plaats van letterlijk
// overgenomen van The Paradox — anders leest de pagina als een kopie van de
// moederpagina in plaats van als het eigen gezicht van het product.
const PRINCIPES: { titel: string; tekst: string }[] = [
  {
    titel: "Onderbouwing boven snelheid",
    tekst:
      "Een besluit is pas af als navolgbaar is waarop het rust. Wij ontwerpen liever een stap extra dan een aanname minder.",
  },
  {
    titel: "Traceerbaar of niet",
    tekst:
      "Wat niet herleidbaar is naar bron, rol en moment, hoort niet in een besluitdossier. Vastlegging is geen bijproduct maar uitgangspunt.",
  },
  {
    titel: "AI signaleert, mensen besluiten",
    tekst:
      "De assistent vat samen, spiegelt en stelt kritische vragen. Het oordeel blijft bij het bestuur — zichtbaar en zonder tussenkomst.",
  },
  {
    titel: "Eigen omgeving, eigen data",
    tekst:
      "Iedere organisatie werkt in een eigen besluitomgeving, met eigen documentatie, rollen en kaders. Geen gedeelde bak, geen algemene aannames.",
  },
];

export default function OverOnsPage() {
  return (
    <div className="bp-page">
      <Header variant="full" actief="/over-ons" />

      {/* HERO */}
      <section className="phero">
        <div className="grid-bg" />
        <div className="wrap">
          <Crumb items={[{ label: "Over ons" }]} />
          <h1>Over Bestuurdersportaal</h1>
          <p className="sub">
            We bouwen een eigen online besluitomgeving voor organisaties waar
            besluitvorming zorgvuldig voorbereid en verantwoord moet worden.
          </p>
          <div className="cta">
            <a href="/contact" className="btn btn-primary">
              Neem contact op
            </a>
            <a href="/product" className="btn btn-outline">
              Bekijk hoe het werkt
            </a>
          </div>
        </div>
      </section>

      {/* WAAROM WE DIT BOUWEN */}
      <section>
        <div className="wrap">
          <div className="label">Waarom we dit bouwen</div>
          <h2>Ontworpen rond het besluit zelf.</h2>
          <div className="prose">
            <p>
              Besturen nemen besluiten met grote gevolgen, in een omgeving met veel
              documenten, betrokken partijen en een hoge verantwoordingsdruk.
              Bestaande hulpmiddelen ondersteunen delen van dat proces, maar zelden
              de bestuurlijke afweging zelf. Bestuurdersportaal is ontworpen rond
              het besluit: van voorbereiding en bronanalyse tot afweging,
              vastlegging, verantwoording, opvolging en evaluatie.
            </p>
          </div>
        </div>
      </section>

      {/* DE OPRICHTERS */}
      <section>
        <div className="wrap">
          <div className="label">De oprichters</div>
          <h2>Twee disciplines, één vraagstuk.</h2>
          <div className="prose">
            <p>
              Bestuurdersportaal komt voort uit de combinatie van
              bestuurlijk-inhoudelijk onderzoek en platformontwerp. Die twee
              sporen lopen door het hele product heen: wat een bestuur nodig
              heeft om goed te besluiten, en hoe je dat betrouwbaar en navolgbaar
              bouwt.
            </p>
          </div>
          <div className="oprichters">
            <div className="col">
              <div className="portret" aria-hidden="true">
                RT
              </div>
              <div>
                <div className="rol">Governance</div>
                <h3>Robert Timmer</h3>
                <p>
                  Onafhankelijk bestuursadviseur en onderzoeker, gespecialiseerd
                  in strategie, organisatieontwikkeling en mens–AI-samenwerking
                  in besluitvorming.
                </p>
              </div>
            </div>
            <div className="col">
              <div className="portret" aria-hidden="true">
                MIJ
              </div>
              <div>
                <div className="rol">Platform</div>
                <h3>Merlin IJzerman</h3>
                <p>
                  Ruim vijftien jaar ervaring in pensioenen — van
                  procesontwikkeling tot business-architectuur — met een formele
                  juridische achtergrond. Beweegt zich tussen de disciplines die
                  in dit vraagstuk samenkomen.
                </p>
              </div>
            </div>
          </div>
          <p className="rolverdeling">
            Robert brengt het bestuurlijke en onderzoeksperspectief in; Merlin
            vertaalt dat naar architectuur, requirements en werkende software. De
            vraagstukken worden samen doorleefd voordat ze in het product landen.
          </p>
        </div>
      </section>

      {/* WERKPRINCIPES */}
      <section>
        <div className="wrap">
          <div className="label">Werkprincipes</div>
          <h2>Waar we ons aan houden.</h2>
          <p className="lede">
            Vier uitgangspunten die bepalen wat we wel en niet bouwen — en waar
            een bestuur ons op mag aanspreken.
          </p>
          <div className="principles">
            {PRINCIPES.map((p, i) => (
              <div key={p.titel} className="pr">
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{p.titel}</h3>
                  <p>{p.tekst}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* VAN BESLUITARCHITECTUUR NAAR BESLUITPRAKTIJK */}
      <section>
        <div className="wrap">
          <div className="label">The Paradox</div>
          <h2>Van besluitarchitectuur naar besluitpraktijk.</h2>
          <div className="prose">
            <p>
              Bestuurdersportaal is gebouwd op het besluitvormingsdenken van The
              Paradox, dat onderzoekt en adviseert over betere besluitvorming waar
              menselijk oordeel en AI samenkomen. The Paradox levert het denkkader;
              Bestuurdersportaal maakt het toepasbaar in de dagelijkse
              bestuurspraktijk. Pensioenfondsen zijn onze eerste specialisatie.
            </p>
          </div>
          <div className="duo">
            <div className="col">
              <div className="tag">Het denkkader</div>
              <h3>The Paradox</h3>
              <p>Strategisch onderzoek en advies over mens-AI-besluitvorming.</p>
            </div>
            <div className="col">
              <div className="tag">De besluitpraktijk</div>
              <h3>Bestuurdersportaal</h3>
              <p>De omgeving waarin dat denken dagelijks toepasbaar wordt.</p>
            </div>
          </div>
          <p className="link-row">
            <a
              href="https://the-paradox.com"
              target="_blank"
              rel="noreferrer"
              className="textlink"
            >
              Ontdek The Paradox →
            </a>
          </p>
        </div>
      </section>

      {/* VISIE */}
      <section>
        <div className="wrap">
          <div className="label">Waar we naartoe werken</div>
          <h2>Besluitkwaliteit als ontworpen vermogen.</h2>
          <p className="visie">
            Een bestuur dat elk betekenisvol besluit neemt met volledig besef van
            zowel de menselijke als de kunstmatige beperkingen.
          </p>
          <p className="visie-bron">
            Niet omdat er meer informatie beschikbaar is, maar omdat de weg naar
            het besluit is ontworpen: welke bronnen zijn gebruikt, welke aannames
            zijn gemaakt, wie heeft wat gewogen, en hoe is dat later te
            reconstrueren.
          </p>
        </div>
      </section>

      {/* CTA */}
      <CtaBand
        kop="Kennismaken?"
        primair={{ href: "/contact", label: "Neem contact op" }}
        secundair={[{ href: "/product", label: "Bekijk hoe het werkt" }]}
      />

      <Footer variant="full" />
    </div>
  );
}
