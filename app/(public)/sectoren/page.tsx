import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import Crumb from "../_components/Crumb";
import CtaBand from "../_components/CtaBand";

// /sectoren — besluitvorming in gereguleerde omgevingen (copy v0.2 §4,
// Variant A). Besluit 0035 #3: geen andere sectoren bij naam noemen zolang ze
// niet echt bediend worden (overclaiming vermijden). Pensioen = eerste,
// diepst uitgewerkte specialisatie.
export const metadata: Metadata = {
  title: {
    absolute:
      "Sectoren — besluitvorming in gereguleerde omgevingen | Bestuurdersportaal",
  },
  description:
    "Gebouwd voor omgevingen waar besluitvorming onder toezicht staat en verantwoording de norm is. Pensioenfondsen zijn onze eerste, diepst uitgewerkte specialisatie.",
  alternates: { canonical: "/sectoren" },
  openGraph: {
    title: "Sectoren — besluitvorming in gereguleerde omgevingen",
    description:
      "Gebouwd voor omgevingen waar besluitvorming onder toezicht staat en verantwoording de norm is. Pensioenfondsen zijn onze eerste, diepst uitgewerkte specialisatie.",
    type: "website",
    url: "/sectoren",
  },
};

const KENMERKEN: string[] = [
  "toezicht op de besluitvorming;",
  "hoge verantwoordingsdruk richting interne en externe stakeholders;",
  "uitbestedingsketens, waarbij het bestuur verantwoordelijk blijft;",
  "documentintensieve besluitvorming, met veel bronnen per besluit;",
  "commissies, toezicht en bestuursbureaus die samen tot besluiten komen;",
  "een context waarin AI alleen verantwoord toepasbaar is binnen governancekaders.",
];

export default function SectorenPage() {
  return (
    <div className="bp-page">
      <Header variant="full" actief="/sectoren" />

      {/* HERO */}
      <section className="phero">
        <div className="grid-bg" />
        <div className="wrap">
          <Crumb items={[{ label: "Sectoren" }]} />
          <h1>Besluitvorming in gereguleerde omgevingen</h1>
          <p className="sub">
            Bestuurdersportaal is opgezet voor organisaties waar besluitvorming
            onder toezicht staat en verantwoording de norm is. De onderliggende
            besluitarchitectuur is toepasbaar in elke omgeving waar besluiten
            zorgvuldig, transparant en reconstrueerbaar moeten zijn.
          </p>
          <div className="cta">
            <a href="/contact" className="btn btn-primary">
              Neem contact op
            </a>
            <a href="/sectoren/pensioenfondsen" className="btn btn-outline">
              Bekijk de pensioenspecialisatie
            </a>
          </div>
        </div>
      </section>

      {/* VOOR WELK TYPE ORGANISATIE */}
      <section>
        <div className="wrap">
          <div className="label">Herkenning</div>
          <h2>Voor welk type organisatie is dit geschikt?</h2>
          <p className="lede">
            Bestuurdersportaal is niet aan één sector gebonden, maar aan een type
            besluitvorming. De omgeving past bij organisaties met:
          </p>
          <ul className="kenmerken">
            {KENMERKEN.map((k) => (
              <li key={k}>
                <span className="ck">—</span>
                <span>{k}</span>
              </li>
            ))}
          </ul>
          <p className="note">
            Herkent uw organisatie zich in deze kenmerken, dan sluit
            Bestuurdersportaal waarschijnlijk aan bij uw besluitvorming.
          </p>
        </div>
      </section>

      {/* PENSIOEN ALS EERSTE SPECIALISATIE */}
      <section>
        <div className="wrap">
          <div className="label">Eerste specialisatie</div>
          <h2>Diepe expertise in de pensioensector.</h2>
          <p className="lede">
            De pensioensector is onze eerste specialisatie. Daar komen governance,
            toezicht, uitbesteding, risicobeheersing en bestuurlijke
            verantwoordelijkheid scherp en gelijktijdig samen. De pensioensector
            verdiept het product, maar beperkt het niet.
          </p>
          <p className="link-row">
            <a href="/sectoren/pensioenfondsen" className="textlink">
              Bekijk de pensioenspecialisatie →
            </a>
          </p>
        </div>
      </section>

      {/* MEER SECTOREN */}
      <section>
        <div className="wrap">
          <div className="label">Meer sectoren</div>
          <h2>Stapsgewijs, zonder te overvragen.</h2>
          <p className="lede">
            Bestuurdersportaal is opgezet om ook in andere gereguleerde sectoren
            toepasbaar te zijn. We werken sectoren stapsgewijs uit; pensioen is de
            eerste. Benieuwd of uw sector aansluit? Neem gerust contact op.
          </p>
          <p className="link-row">
            <a href="/contact" className="textlink">
              Sluit uw sector aan? →
            </a>
          </p>
        </div>
      </section>

      {/* CTA */}
      <CtaBand
        kop="Past dit bij uw sector?"
        primair={{ href: "/contact", label: "Neem contact op" }}
        secundair={[
          {
            href: "/sectoren/pensioenfondsen",
            label: "Bekijk de pensioenspecialisatie",
          },
        ]}
      />

      <Footer variant="full" />
    </div>
  );
}
