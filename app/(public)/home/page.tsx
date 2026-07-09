import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import DossierKaart from "../_components/DossierKaart";
import Flow from "../_components/Flow";
import Cmp from "../_components/Cmp";
import CtaBand from "../_components/CtaBand";

// Homepage — compacte commerciële voorkant (copy v0.2 §1 + onderscheidingsblok
// §10). Claimdiscipline (contentplan §0.1/§4): veilige werkwoorden, AI
// ondersteunt maar besluit niet, geen certificerings-/hosting-/encryptieclaims.
// Primaire CTA overal "Neem contact op" (Bouwoverdracht §1).
export const metadata: Metadata = {
  title: {
    absolute:
      "Bestuurdersportaal — eigen online besluitomgeving met AI voor besturen",
  },
  description:
    "Een eigen online besluitomgeving voor besturen en commissies, waarin AI werkt met de eigen documentatie, besluitdossiers en historische context — van vraagstuk tot verantwoording en evaluatie.",
  alternates: { canonical: "/" },
  openGraph: {
    title:
      "Bestuurdersportaal — eigen online besluitomgeving met AI voor besturen",
    description:
      "Een eigen online besluitomgeving voor besturen en commissies, waarin AI werkt met de eigen documentatie, besluitdossiers en historische context.",
    type: "website",
    url: "/",
  },
};

// Legacy-fragment-redirect (SpoorB §5): oude onepager-ankers doorsturen naar de
// nieuwe zelfstandige pagina's. Fragmenten bereiken de server niet, dus dit
// gebeurt client-side, en alleen op "/".
const legacyHash = `(function(){var m={'#gebruikssituaties':'/product#gebruikssituaties','#voor-besturen':'/voor-wie','#eigen-omgeving':'/product#dossiers','#governance-ai':'/governance-ai','#product':'/product','#voorwie':'/voor-wie'};var d=m[window.location.hash];if(d&&window.location.pathname==='/'){window.location.replace(d);}})();`;

export default function HomePage() {
  return (
    <div className="bp-home">
      <script dangerouslySetInnerHTML={{ __html: legacyHash }} />
      <Header variant="full" />

      {/* HERO */}
      <section className="hero">
        <div className="grid-bg" />
        <div className="wrap">
          <div>
            <h1>Bestuurlijke besluitvorming. Door ontwerp.</h1>
            <p className="sub">
              Bestuurdersportaal helpt besturen en commissies om complexe
              besluiten zorgvuldig voor te bereiden, te onderbouwen, vast te
              leggen, te verantwoorden en te evalueren. Iedere organisatie krijgt
              een eigen online besluitomgeving waarin AI werkt met de eigen
              documentatie, besluitdossiers en historische context.
            </p>
            <p className="flowline">
              Van vraagstuk naar besluit. Van besluit naar verantwoording en
              evaluatie.
            </p>
            <p className="built">
              Gebouwd op het besluitvormingsdenken van The Paradox — waar
              menselijk oordeel, AI-ondersteuning en governance samenkomen.
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
          <DossierKaart
            titel="Besluitdossier"
            status="concept"
            rijen={[
              { label: "Bronnen", waarde: "12 documenten" },
              { label: "Historie", waarde: "3 eerdere besluiten" },
              { label: "Risico's", waarde: "3 gesignaleerd" },
              { label: "Aannames", waarde: "5 vastgelegd" },
              { label: "Besluit", waarde: "onderbouwd" },
              { label: "Acties", waarde: "4 toegewezen" },
              { label: "Evaluatie", waarde: "opvolging gepland" },
            ]}
          />
        </div>
      </section>

      {/* HET VRAAGSTUK */}
      <section>
        <div className="wrap">
          <div className="label">Het vraagstuk</div>
          <h2>
            Besturen krijgen meer informatie.
            <br />
            Niet automatisch betere besluiten.
          </h2>
          <p className="lede">
            Bestuurders en commissies verwerken steeds meer: documenten,
            adviezen, risicoanalyses, toezichtskaders en onderlinge
            afhankelijkheden. De hoeveelheid groeit; de tijd om te oordelen niet.
            AI kan die complexiteit ordenen — maar alleen als het gebruik
            transparant, controleerbaar en rolzuiver is ingericht, en werkt
            vanuit de eigen context van de organisatie. Zonder die voorwaarden
            ontstaat het risico op schijnzekerheid: antwoorden die overtuigend
            klinken, maar onvoldoende herleidbaar of toetsbaar zijn.
          </p>
          <div className="probcols">
            <div className="probcol">
              <h3>Meer input, minder overzicht</h3>
              <p>Informatie stapelt; de rode draad raakt zoek.</p>
            </div>
            <div className="probcol">
              <h3>AI zonder context</h3>
              <p>
                Generieke AI kent uw dossiers, historie en kaders niet — en
                stuurt onzichtbaar.
              </p>
            </div>
            <div className="probcol">
              <h3>Verantwoording achteraf</h3>
              <p>
                Wie besloot wat, op welke gronden — vaak moeilijk te
                reconstrueren.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ONDERSCHEIDINGSBLOK (§10) */}
      <section className="distinct">
        <div className="wrap">
          <div className="label">Onderscheid</div>
          <h2>
            Geen documentportaal. Geen vergadertool.{" "}
            <span>Geen losse AI-chat.</span>
          </h2>
          <p className="lede">
            Een eigen besluitomgeving. Bestaande tools beheren documenten, plannen
            vergaderingen of beantwoorden losse vragen zonder kennis van uw
            context. Bestuurdersportaal is een organisatiegebonden
            besluitomgeving, ontworpen rond de volledige besluitcyclus — van
            voorbereiding en afweging tot besluit, verantwoording, opvolging en
            evaluatie — en werkt vanuit uw eigen documentatie, dossiers en
            historie op de plek waar het besluit valt.
          </p>
          <Cmp />
          <p className="cmp-note">
            Bestuurdersportaal vult het gat tussen documentbeheer, vergaderen,
            risicobeheersing en AI. Het richt zich op de bestuurlijke afweging
            zelf: welke informatie is gebruikt, welke risico's en aannames zijn
            expliciet gemaakt, welk besluit is genomen, welke acties volgen
            daaruit en hoe kan dit later worden gereconstrueerd?
          </p>
          <p className="link-row">
            <a href="/product" className="textlink">
              Bekijk hoe het werkt →
            </a>
          </p>
        </div>
      </section>

      {/* DE OPLOSSING — BESLUITCYCLUS */}
      <section>
        <div className="wrap">
          <div className="label">De oplossing</div>
          <h2>Eén omgeving voor de volledige besluitcyclus.</h2>
          <p className="lede">
            Bestuurdersportaal begeleidt de weg van vraagstuk naar besluit — en
            van besluit naar verantwoording en evaluatie — in één samenhangende
            omgeving. Niet als losse stappen, maar als één doorlopend dossier dat
            blijft leren van wat eerder is besloten.
          </p>
          <Flow />
          <p className="link-row">
            <a href="/product" className="textlink">
              Bekijk de besluitcyclus →
            </a>
          </p>
        </div>
      </section>

      {/* UW EIGEN OMGEVING */}
      <section>
        <div className="wrap">
          <div className="label">Uw eigen omgeving</div>
          <h2>Een eigen omgeving voor uw bestuurlijke context.</h2>
          <p className="lede">
            Bestuurdersportaal is geen generieke AI-chat. Iedere organisatie
            krijgt een eigen online besluitomgeving, ingericht rond de eigen
            documentatie, besluitdossiers, eerdere besluiten en governancecontext.
            Daardoor werkt de ondersteuning vanuit wat in úw organisatie geldt en
            eerder is besloten — niet vanuit algemene aannames.
          </p>
          <div className="own">
            <ul>
              <li>
                <span className="ck">—</span>
                <span>
                  <b>Een eigen online besluitomgeving per organisatie</b>,
                  ingericht op uw bestuurlijke context.
                </span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>
                  <b>AI werkt met uw eigen documentatie en besluitdossiers</b>,
                  met verwijzing naar de bron.
                </span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>
                  <b>Historische context blijft beschikbaar</b>: eerdere besluiten
                  en onderbouwingen blijven vindbaar en herbruikbaar.
                </span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>
                  <b>Governancecontext ingericht per organisatie</b>: rollen,
                  rechten, kaders en beleid.
                </span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>
                  <b>Nieuwe vraagstukken bouwen voort op eerdere besluiten</b>,
                  zodat lijn en consistentie zichtbaar blijven.
                </span>
              </li>
            </ul>
            <DossierKaart
              titel="Uw omgeving"
              status="ingericht"
              rijen={[
                { label: "Eigen documentatie", waarde: "gekoppeld" },
                { label: "Besluitdossiers", waarde: "doorzoekbaar" },
                { label: "Historie", waarde: "eerdere besluiten" },
                { label: "Governancecontext", waarde: "rollen & kaders" },
                { label: "AI-ondersteuning", waarde: "binnen uw context" },
              ]}
            />
          </div>
        </div>
      </section>

      {/* GOVERNANCE-TEASER */}
      <section>
        <div className="wrap">
          <div className="label">Vertrouwen &amp; governance</div>
          <h2>AI ondersteunt, maar stuurt niet ongemerkt.</h2>
          <p className="lede">
            Verantwoord AI-gebruik is bewust begrensd en zichtbaar gemaakt. De AI
            werkt binnen uw eigen context, houdt feit en duiding gescheiden, maakt
            aannames zichtbaar, respecteert rollen en rechten, en legt via een
            audittrail navolgbaar vast hoe een besluit tot stand kwam.
          </p>
          <p className="link-row">
            <a href="/governance-ai" className="textlink">
              Zo borgen we verantwoord AI-gebruik →
            </a>
          </p>
          <p className="link-row">
            <a href="/governance-ai/eu-ai-act" className="textlink">
              EU AI Act &amp; verantwoord AI-gebruik →
            </a>
          </p>
        </div>
      </section>

      {/* VOOR WIE */}
      <section>
        <div className="wrap">
          <div className="label">Voor wie</div>
          <h2>Voor de organen die samen tot een besluit komen.</h2>
          <p className="lede">
            Bestuurdersportaal ondersteunt besturen en directies, commissies,
            raden van toezicht, bestuursbureaus en secretariaten, en
            GRC/compliance — de organen die samen tot een besluit komen.
          </p>
          <p className="link-row">
            <a href="/voor-wie" className="textlink">
              Kijk of het bij uw rol past →
            </a>
          </p>
        </div>
      </section>

      {/* THE PARADOX */}
      <section>
        <div className="wrap">
          <div className="label">The Paradox</div>
          <h2>Van besluitarchitectuur naar besluitpraktijk.</h2>
          <p className="lede">
            The Paradox onderzoekt en adviseert over betere besluitvorming in een
            wereld waarin menselijk oordeel en AI steeds meer samenkomen.
            Bestuurdersportaal vertaalt dat gedachtegoed naar een concrete
            digitale werkomgeving voor de dagelijkse bestuurspraktijk. The Paradox
            levert het denkkader; Bestuurdersportaal maakt het toepasbaar.
          </p>
          <div className="bridge">
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
              rel="noopener"
              className="textlink"
            >
              Ontdek The Paradox →
            </a>
          </p>
        </div>
      </section>

      {/* PROOF POINT — PENSIOEN */}
      <section>
        <div className="wrap">
          <div className="label">Eerste specialisatie</div>
          <h2>Pensioen als eerste specialisatie.</h2>
          <p className="lede">
            Pensioenfondsen nemen ingrijpende besluiten in een omgeving met veel
            documenten, een uitbestedingsketen, toezicht en hoge
            verantwoordingsdruk. Het is de eerste sector waarvoor we
            Bestuurdersportaal het diepst hebben ingericht — de onderliggende
            besluitarchitectuur is toepasbaar in elke omgeving waar besluiten
            zorgvuldig en reconstrueerbaar moeten zijn.
          </p>
          <p className="link-row">
            <a href="/sectoren/pensioenfondsen" className="textlink">
              Bekijk de pensioenspecialisatie →
            </a>
          </p>
        </div>
      </section>

      {/* AFSLUITENDE CTA */}
      <CtaBand
        label="Pilot / demo"
        kop="Start met één besluitdossier in uw eigen omgeving."
        tekst="De waarde wordt het snelst zichtbaar met een concreet bestuurlijk vraagstuk. We richten samen uw eigen omgeving in en werken één dossier uit — van voorbereiding tot evaluatie."
        primair={{ href: "/contact", label: "Neem contact op" }}
        secundair={[{ href: "/product", label: "Bekijk hoe het werkt" }]}
      />

      <Footer variant="full" />
    </div>
  );
}
