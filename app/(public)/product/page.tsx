import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import Crumb from "../_components/Crumb";
import Flow from "../_components/Flow";
import Steps from "../_components/Steps";
import DossierKaart from "../_components/DossierKaart";
import CtaBand from "../_components/CtaBand";

// /product — de besluitcyclus in één besluitomgeving (copy v0.2 §2).
export const metadata: Metadata = {
  title: {
    absolute:
      "Product — de volledige besluitcyclus in één omgeving | Bestuurdersportaal",
  },
  description:
    "Van vraagstuk tot evaluatie: één omgeving die de volledige besluitcyclus ondersteunt, met brongebonden AI die put uit uw eigen documentatie, dossiers en historie.",
  alternates: { canonical: "/product" },
  openGraph: {
    title: "Product — de volledige besluitcyclus in één omgeving",
    description:
      "Van vraagstuk tot evaluatie: één omgeving die de volledige besluitcyclus ondersteunt, met brongebonden AI die put uit uw eigen documentatie, dossiers en historie.",
    type: "website",
    url: "/product",
  },
};

export default function ProductPage() {
  return (
    <div className="bp-page">
      <Header variant="full" actief="/product" />

      {/* HERO */}
      <section className="phero">
        <div className="grid-bg" />
        <div className="wrap">
          <Crumb items={[{ label: "Product" }]} />
          <h1>Eén omgeving voor de volledige besluitcyclus</h1>
          <p className="sub">
            Van vraagstuk naar besluit — en van besluit naar verantwoording en
            evaluatie. Niet als losse stappen, maar als één doorlopend dossier dat
            blijft leren van wat eerder is besloten.
          </p>
          <div className="cta">
            <a href="/contact" className="btn btn-primary">
              Neem contact op
            </a>
            <a href="/governance-ai" className="btn btn-outline">
              Zo borgen we verantwoord AI-gebruik
            </a>
          </div>
        </div>
      </section>

      {/* DE BESLUITCYCLUS */}
      <section>
        <div className="wrap">
          <div className="label">De besluitcyclus</div>
          <h2>Van vraagstuk tot evaluatie.</h2>
          <Flow />
          <Steps />
        </div>
      </section>

      {/* VOORBEELDFLOW (legacy-anker #dossiers) */}
      <section id="dossiers">
        <div className="wrap">
          <div className="label">Voorbeeldflow</div>
          <h2>Van vraagstuk naar besluitdossier.</h2>
          <div className="own">
            <ul>
              <li>
                <span className="ck">—</span>
                <span>Van bestuursstuk naar besluitdossier.</span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>Van risico naar expliciete afweging.</span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>Van besluit naar opvolgbare actie.</span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>Van losse documenten naar reconstrueerbare onderbouwing.</span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>Van afgerond besluit naar leerpunt voor het volgende.</span>
              </li>
            </ul>
            <DossierKaart
              titel="Dossier · investeringsbesluit"
              status="onderbouwd"
              rijen={[
                { label: "Bronnen", waarde: "samengevat & gekoppeld" },
                { label: "Risico's", waarde: "gesignaleerd" },
                { label: "Aannames", waarde: "expliciet" },
                { label: "Afwegingen", waarde: "alternatieven" },
                { label: "Besluit", waarde: "+ onderbouwing" },
                { label: "Acties", waarde: "toegewezen" },
                { label: "Evaluatie", waarde: "opvolging gepland" },
              ]}
            />
          </div>
        </div>
      </section>

      {/* AI IN DE PRAKTIJK */}
      <section>
        <div className="wrap">
          <div className="label">AI in de praktijk</div>
          <h2>Brongebonden ondersteuning, binnen uw context.</h2>
          <p className="lede">
            De AI in Bestuurdersportaal werkt brongebonden: ze ordent en ontsluit
            de documentcontext binnen uw eigen omgeving, met verwijzing naar de
            bron en de historie — niet op basis van een onzichtbaar
            achtergrondmodel. De analyse ondersteunt de afweging; het bestuur
            beslist.
          </p>
        </div>
      </section>

      {/* WAT KRIJGT EEN BESTUUR CONCREET */}
      <section>
        <div className="wrap">
          <div className="label">Concreet</div>
          <h2>Wat krijgt een bestuur concreet?</h2>
          <ul className="pledge">
            <li>Een eigen online besluitomgeving voor uw organisatie.</li>
            <li>Een gestructureerd besluitdossier per vraagstuk.</li>
            <li>
              AI-ondersteuning op uw eigen documentatie, dossiers en historie —
              samenvatten, toetsen, risico's signaleren en alternatieven ordenen,
              met verwijzing naar de bron.
            </li>
            <li>
              Vastlegging van aannames, risico's, overwegingen, voorwaarden en
              acties.
            </li>
            <li>Een reconstrueerbare audittrail of export voor verantwoording.</li>
            <li>
              Evaluatie en opvolging: aannames toetsen, effecten beoordelen,
              leerpunten vastleggen en opnieuw agenderen.
            </li>
          </ul>
        </div>
      </section>

      {/* GEBRUIKSSITUATIES (legacy-anker #gebruikssituaties) */}
      <section id="gebruikssituaties">
        <div className="wrap">
          <div className="label">Gebruikssituaties</div>
          <h2>Voor welk besluit?</h2>
          <p className="lede">
            Bestuurdersportaal is gemaakt voor besluiten die zorgvuldige
            voorbereiding, verantwoording en opvolging vragen.
          </p>
          <div className="who">
            <span className="chip">Beleidsbesluiten</span>
            <span className="chip">Investeringsbesluiten</span>
            <span className="chip">Uitbestedingsbesluiten</span>
            <span className="chip">Risicodossiers</span>
            <span className="chip">Commissieadviezen</span>
            <span className="chip">Toezicht- &amp; verantwoordingsdossiers</span>
            <span className="chip">Governance-evaluaties</span>
            <span className="chip">Pensioendossiers</span>
          </div>
        </div>
      </section>

      {/* RODE DRAAD */}
      <section>
        <div className="wrap">
          <div className="label">Rode draad</div>
          <h2>Een besluitomgeving, geen portaal.</h2>
          <p className="lede">
            Waar klassieke bestuurdersportalen vooral documenten ontsluiten en
            vergaderingen ondersteunen, richt Bestuurdersportaal zich op het
            besluit zelf: de voorbereiding, afweging, vastlegging, verantwoording
            en evaluatie. Niet alleen het besluit, maar ook de onderbouwing en de
            opvolging.
          </p>
          <p className="link-row">
            <a href="/" className="textlink">
              Waarom dit een eigen categorie is →
            </a>
          </p>
        </div>
      </section>

      {/* CTA */}
      <CtaBand
        kop="Zien hoe dit bij uw besluitvorming past?"
        primair={{ href: "/contact", label: "Neem contact op" }}
        secundair={[
          { href: "/governance-ai", label: "Zo borgen we verantwoord AI-gebruik" },
        ]}
      />

      <Footer variant="full" />
    </div>
  );
}
