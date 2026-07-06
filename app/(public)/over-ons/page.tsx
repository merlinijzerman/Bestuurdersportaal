import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import Crumb from "../_components/Crumb";
import CtaBand from "../_components/CtaBand";

// /over-ons — Over ons (copy v0.2 §6). Bescheiden, claim-veilig, sluit aan op
// de The Paradox-positionering. Feitelijke team-/organisatiegegevens worden
// later ingevuld (copy laat die bewust open).
export const metadata: Metadata = {
  title: { absolute: "Over ons | Bestuurdersportaal" },
  description:
    "Bestuurdersportaal vertaalt het besluitvormingsdenken van The Paradox naar een concrete besluitomgeving voor de dagelijkse bestuurspraktijk.",
  alternates: { canonical: "/over-ons" },
  openGraph: {
    title: "Over ons | Bestuurdersportaal",
    description:
      "Bestuurdersportaal vertaalt het besluitvormingsdenken van The Paradox naar een concrete besluitomgeving voor de dagelijkse bestuurspraktijk.",
    type: "website",
    url: "/over-ons",
  },
};

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
          <p className="link-row">
            <a
              href="https://the-paradox.com"
              target="_blank"
              rel="noopener"
              className="textlink"
            >
              Ontdek The Paradox →
            </a>
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
