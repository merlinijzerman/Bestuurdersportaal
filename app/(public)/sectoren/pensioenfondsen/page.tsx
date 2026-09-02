import type { Metadata } from "next";
import Header from "../../_components/Header";
import Footer from "../../_components/Footer";
import Crumb from "../../_components/Crumb";
import CtaBand from "../../_components/CtaBand";

// /sectoren/pensioenfondsen — GATED (besluit 0037 #4). Deze pagina is gebouwd
// conform de conceptcopy pensioenfondsen v0.2, maar staat NIET in de
// marketing-allowlist (lib/platform-host.ts) en NIET in de sitemap. De route
// 404't dus tot de pensioen-SME de feitelijke uitspraken (🔎 [SME-VALIDATIE])
// heeft bevestigd en Merlin het pad expliciet vrijgeeft in de allowlist + sitemap.
// De copy is bewust claimveilig: geen garanties, geen uitspraken namens DNB/AFM.
export const metadata: Metadata = {
  title: {
    absolute:
      "Pensioenfondsen — WTP, uitbesteding & governance | Bestuurdersportaal",
  },
  description:
    "Besluitvorming rond WTP, uitbesteding en governance — voorbereid, onderbouwd en herleidbaar vastgelegd in één besluitomgeving voor pensioenfondsen.",
  alternates: { canonical: "/sectoren/pensioenfondsen" },
  openGraph: {
    title: "Pensioenfondsen — WTP, uitbesteding & governance",
    description:
      "Besluitvorming rond WTP, uitbesteding en governance — voorbereid, onderbouwd en herleidbaar vastgelegd in één besluitomgeving voor pensioenfondsen.",
    type: "website",
    url: "/sectoren/pensioenfondsen",
  },
};

const KENMERKEN: { titel: string; tekst: string }[] = [
  {
    titel: "Doorlopende strategische besluitvorming in het nieuwe stelsel",
    tekst:
      "Ook ná de transitie blijven fondsen samenhangende strategische en beleidsmatige besluiten nemen — over beleid, uitvoering en governance.",
  },
  {
    titel: "Uitbestedingsketen",
    tekst:
      "Veel fondsen besteden uitvoering, vermogensbeheer en administratie uit; het bestuur blijft verantwoordelijk en moet kunnen sturen op en verantwoording afleggen over uitbestede partijen.",
  },
  {
    titel: "Toezicht en verantwoording",
    tekst:
      "Fondsen opereren onder toezicht en leggen verantwoording af aan interne toezichtorganen en externe stakeholders.",
  },
  {
    titel: "Documentintensiteit",
    tekst:
      "Besluiten steunen op veel bronnen: beleidsstukken, adviezen, data en verslagen. Het overzicht en de onderbouwing daarvan bepalen mede de kwaliteit van het besluit.",
  },
];

const SITUATIES: { titel: string; tekst: string }[] = [
  {
    titel: "Uitbesteding en sturing op de uitvoeringsorganisatie",
    tekst:
      "Helpt bij het onderbouwen en vastleggen van besluiten over uitbesteding en het sturen op uitbestede partijen.",
  },
  {
    titel: "Beleggingsbeleid en risicohouding",
    tekst:
      "Ondersteunt de afweging en vastlegging rond beleggingsbeleid en risicohouding.",
  },
  {
    titel: "Risicobeheersing en compliance",
    tekst:
      "Verbindt risico's, beheersmaatregelen en beleidskaders aan het bestuurlijke besluit.",
  },
  {
    titel: "Bestuurs- en commissiebesluitvorming",
    tekst:
      "Ondersteunt de voorbereiding, advisering en besluitvorming van bestuur en commissies, met bronnen, aannames en opvolgpunten in één dossier.",
  },
  {
    titel: "Verantwoording richting intern toezicht en externe stakeholders",
    tekst:
      "Maakt afwegingen, besluiten en opvolging herleidbaar voor verantwoording aan interne toezichtorganen en externe stakeholders.",
  },
];

export default function PensioenfondsenPage() {
  return (
    <div className="bp-page">
      <Header variant="full" actief="/sectoren" />

      {/* HERO */}
      <section className="phero">
        <div className="grid-bg" />
        <div className="wrap">
          <Crumb
            items={[
              { label: "Sectoren", href: "/sectoren" },
              { label: "Pensioenfondsen" },
            ]}
          />
          <h1>Besluitvorming voor pensioenfondsen</h1>
          <p className="sub">
            Besluitvorming rond WTP, uitbesteding en governance — voorbereid en
            verantwoord met de relevante fondsdocumentatie, besluitcontext en
            bestuurlijke afwegingen in één omgeving.
          </p>
          <p className="intro">
            Pensioenfondsbesturen nemen besluiten met grote gevolgen, in een
            omgeving met veel documenten, betrokken partijen en een hoge
            verantwoordingsdruk. Bestuurdersportaal is ontwikkeld vanuit die
            context en ingericht rond de documenten, besluitdossiers en
            governancekaders van het fonds. Het helpt om afwegingen, bronnen,
            risico’s, aannames, besluiten en acties herleidbaar vast te leggen.
          </p>
          <div className="cta">
            <a href="/contact?type=pilot" className="btn btn-primary">
              Bespreek een pilot
            </a>
            <a href="/governance-ai" className="btn btn-outline">
              Zo borgen we verantwoord AI-gebruik
            </a>
          </div>
        </div>
      </section>

      {/* DE PENSIOENCONTEXT */}
      <section>
        <div className="wrap">
          <div className="label">De pensioencontext</div>
          <h2>Hoge eisen aan voorbereiding en verantwoording.</h2>
          <p className="lede">
            Besluitvorming bij pensioenfondsen kent een aantal kenmerken die hoge
            eisen stellen aan voorbereiding en verantwoording:
          </p>
          <div className="blocks">
            {KENMERKEN.map((k) => (
              <div key={k.titel} className="bl">
                <h3>{k.titel}</h3>
                <p>{k.tekst}</p>
              </div>
            ))}
          </div>
          <p className="note">
            Bestuurdersportaal is erop gericht deze context hanteerbaar te maken:
            van de voorbereiding en bronanalyse tot de afweging, het besluit, de
            opvolging en de verantwoording — in één omgeving.
          </p>
        </div>
      </section>

      {/* GEBRUIKSSITUATIES */}
      <section>
        <div className="wrap">
          <div className="label">Gebruikssituaties</div>
          <h2>Waar Bestuurdersportaal bij helpt.</h2>
          <p className="lede">
            Herkenbare besluitsituaties binnen een pensioenfonds waarin de omgeving
            ondersteunt. Elke situatie beschrijft ondersteuning, geen garantie of
            naleving.
          </p>
          <div className="principles">
            {SITUATIES.map((s, i) => (
              <div key={s.titel} className="pr">
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{s.titel}</h3>
                  <p>{s.tekst}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* VERANTWOORD AI-GEBRUIK */}
      <section>
        <div className="wrap">
          <div className="label">Verantwoord AI-gebruik</div>
          <h2>Brongebonden, binnen de context van het fonds.</h2>
          <p className="lede">
            De AI in Bestuurdersportaal werkt brongebonden binnen de eigen
            documentcontext van het fonds. AI ondersteunt, beslist niet: het bestuur
            houdt de regie. Rollen en rechten ondersteunen de afbakening van
            toegang, en logging en audittrail helpen om besluitvorming achteraf te
            reconstrueren. Beveiligings- en verwerkingsafspraken worden per omgeving
            vastgelegd.
          </p>
          <p className="link-row">
            <a href="/governance-ai" className="textlink">
              Lees hoe we verantwoord AI-gebruik borgen →
            </a>
          </p>
        </div>
      </section>

      {/* CTA */}
      <CtaBand
        kop="Verkennen wat dit voor uw fonds betekent?"
        tekst="Bespreek vrijblijvend een eerste besluitdossier of een pilot."
        primair={{ href: "/contact?type=pilot", label: "Bespreek een pilot" }}
        secundair={[{ href: "/contact", label: "Neem contact op" }]}
      />

      <Footer variant="full" />
    </div>
  );
}
