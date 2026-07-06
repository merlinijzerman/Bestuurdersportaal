import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import Crumb from "../_components/Crumb";
import CtaBand from "../_components/CtaBand";

// /voor-wie — de organen die samen tot een besluit komen (copy v0.2 §3).
// Besluit 0035 #1: 5 doelgroepblokken; pensioen als verwijzing (niet als 6e
// blok), diepte-uitwerking op /sectoren/pensioenfondsen.
export const metadata: Metadata = {
  title: {
    absolute: "Voor wie — besturen, commissies, RvT, GRC | Bestuurdersportaal",
  },
  description:
    "Voor besturen en commissies waar besluiten aantoonbaar zorgvuldig moeten zijn — van bestuur en toezicht tot bestuursbureau en GRC.",
  alternates: { canonical: "/voor-wie" },
  openGraph: {
    title: "Voor wie — besturen, commissies, RvT, GRC",
    description:
      "Voor besturen en commissies waar besluiten aantoonbaar zorgvuldig moeten zijn — van bestuur en toezicht tot bestuursbureau en GRC.",
    type: "website",
    url: "/voor-wie",
  },
};

const DOELGROEPEN: { titel: string; tekst: string; output: string }[] = [
  {
    titel: "Besturen en directies",
    tekst:
      "Veel informatie, beperkte tijd, grote verantwoordingsdruk. Voor strategische en bestuurlijke besluiten waarbij informatie, risico's, alternatieven en verantwoordelijkheden zorgvuldig moeten worden gewogen. Bestuurdersportaal helpt de besluitvorming voor te bereiden, alternatieven te expliciteren en besluiten herleidbaar vast te leggen.",
    output: "besluitdossier, afwegingsoverzicht",
  },
  {
    titel: "Commissies",
    tekst:
      "Voorbereiding en advisering moeten navolgbaar zijn richting bestuur — op beleid, risico, audit, beleggingen, uitbesteding of governance. De omgeving helpt commissieadvies te onderbouwen met bronnen, risico's, aannames en opvolgpunten.",
    output: "adviesdossier, opvolglijst",
  },
  {
    titel: "Raden van toezicht / raden van commissarissen",
    tekst:
      "Toezicht op besluitkwaliteit vraagt inzicht in onderbouwing, opvolging en bestuurlijke zorgvuldigheid. De omgeving helpt afwegingen, risico's en besluitvorming beter reconstrueerbaar te maken.",
    output: "reconstrueerbaar besluitdossier",
  },
  {
    titel: "Bestuursbureaus en secretariaten",
    tekst:
      "Dossiervorming, acties, versies en opvolging zijn vaak versnipperd. Bestuurdersportaal helpt structuur aan te brengen in besluitdossiers, procesondersteuning, opvolging van acties en voorbereiding van besluitvorming.",
    output: "gestructureerd dossier, actieoverzicht",
  },
  {
    titel: "Governance-, risk- en compliance-teams",
    tekst:
      "Risico's, controls en beleidskaders staan vaak los van het bestuurlijke besluit. De omgeving helpt toetsing, signalering, risicoduiding en de borging van verantwoorde besluitvorming direct aan de besluitvorming te koppelen.",
    output: "besluit met gekoppelde risico's en controls",
  },
];

export default function VoorWiePage() {
  return (
    <div className="bp-page">
      <Header variant="full" actief="/voor-wie" />

      {/* HERO */}
      <section className="phero">
        <div className="grid-bg" />
        <div className="wrap">
          <Crumb items={[{ label: "Voor wie" }]} />
          <h1>
            Voor besturen en commissies waar besluiten aantoonbaar zorgvuldig
            moeten zijn
          </h1>
          <p className="sub">
            Gebouwd voor bestuurlijke omgevingen waar besluiten gevolgen hebben en
            verantwoording vragen. Bestuursbureaus, secretariaten en GRC-teams
            ondersteunen daarbij het bestuurlijke proces.
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

      {/* DOELGROEPBLOKKEN */}
      <section>
        <div className="wrap">
          <div className="label">Doelgroepen</div>
          <h2>Voor de organen die samen tot een besluit komen.</h2>
          <div className="blocks">
            {DOELGROEPEN.map((d) => (
              <div key={d.titel} className="bl">
                <h3>{d.titel}</h3>
                <p>{d.tekst}</p>
                <span className="out">Relevante output: {d.output}.</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PENSIOEN-VERWIJZING */}
      <section>
        <div className="wrap">
          <div className="label">Eerste specialisatie</div>
          <h2>Pensioenfondsbesturen en -commissies.</h2>
          <p className="lede">
            Pensioenfondsen zijn onze eerste specialisatie: toezicht, uitbesteding,
            risicobeheersing en bestuurlijke verantwoordelijkheid komen daar scherp
            en gelijktijdig samen.
          </p>
          <p className="link-row">
            <a href="/sectoren/pensioenfondsen" className="textlink">
              Bekijk de pensioenspecialisatie →
            </a>
          </p>
        </div>
      </section>

      {/* RODE DRAAD */}
      <section>
        <div className="wrap">
          <div className="label">Rode draad</div>
          <h2>Ongeacht de rol: navolgbare besluitvorming.</h2>
          <p className="lede">
            Ongeacht de rol draait het om hetzelfde: navolgbaar maken welke
            informatie is gebruikt, welke afwegingen zijn gemaakt en hoe een
            besluit tot stand is gekomen.
          </p>
        </div>
      </section>

      {/* CTA */}
      <CtaBand
        kop="Past dit bij uw rol?"
        primair={{ href: "/contact", label: "Neem contact op" }}
        secundair={[
          { href: "/product", label: "Bekijk hoe het werkt" },
          { href: "/sectoren", label: "Past dit bij uw sector?" },
        ]}
      />

      <Footer variant="full" />
    </div>
  );
}
