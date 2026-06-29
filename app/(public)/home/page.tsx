import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import DossierKaart from "../_components/DossierKaart";
import Flow from "../_components/Flow";
import Steps from "../_components/Steps";

// Homepage — 1:1 met de goedgekeurde homepage-mockup-v4. Alle teksten volgen de
// claimmatrix (FO §8): geen ISO/SOC/NEN-claims, AI ondersteunt maar besluit
// niet, "concept" waar van toepassing.
export const metadata: Metadata = {
  title: {
    absolute:
      "Bestuurdersportaal — eigen online besluitomgeving met AI voor besturen",
  },
  description: "AI-ondersteunde besluitomgeving voor besturen en commissies",
  keywords: [
    "bestuurdersportaal",
    "online bestuurdersomgeving",
    "digitale besluitomgeving",
    "eigen bestuursomgeving",
    "AI op eigen documenten",
    "AI op besluitdossiers",
    "besluitdossier bestuur",
    "historische besluitvorming",
    "governancecontext",
    "besluitvorming besturen",
    "commissies",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    title:
      "Bestuurdersportaal — eigen online besluitomgeving met AI voor besturen",
    description:
      "Een eigen online besluitomgeving voor besturen en commissies, waarin AI werkt met de eigen documentatie, besluitdossiers en historische context.",
    type: "website",
  },
};

export default function HomePage() {
  return (
    <div className="bp-home">
      <Header variant="home" />

      {/* HERO */}
      <section className="hero">
        <div className="grid-bg" />
        <div className="wrap">
          <div>
            <h1>Bestuurlijke besluitvorming. Door ontwerp.</h1>
            <p className="sub">
              Het Bestuurdersportaal helpt besturen en commissies om complexe
              besluiten zorgvuldig voor te bereiden, te onderbouwen, vast te
              leggen, te verantwoorden en te evalueren.
            </p>
            <p className="sub">
              Iedere organisatie krijgt een eigen online besluitomgeving waarin
              AI werkt met de eigen documentatie, besluitdossiers en historische
              context.
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
                Plan een demo
              </a>
              <a href="/login" className="btn btn-outline">
                Inloggen
              </a>
              <a
                href="https://the-paradox.com"
                target="_blank"
                rel="noopener"
                className="textlink"
              >
                Ontdek The Paradox →
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

      {/* PROBLEEM */}
      <section id="product">
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
            afhankelijkheden. De hoeveelheid groeit; de tijd om te oordelen
            niet. AI kan die complexiteit ordenen — maar alleen als het gebruik
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
          <p className="prob-statement">
            Waar klassieke bestuurdersportalen vooral documenten ontsluiten en
            vergaderingen ondersteunen, richt het Bestuurdersportaal zich op het
            besluit zelf: de voorbereiding, afweging, vastlegging, verantwoording
            en evaluatie.
          </p>
        </div>
      </section>

      {/* OPLOSSING */}
      <section id="voor-besturen">
        <div className="wrap">
          <div className="label">De oplossing</div>
          <h2>Eén omgeving voor de volledige besluitcyclus.</h2>
          <p className="lede">
            Het portaal begeleidt de weg van vraagstuk naar besluit — en van
            besluit naar verantwoording en evaluatie — in één samenhangende
            omgeving. Niet als losse stappen, maar als één doorlopend dossier dat
            blijft leren van wat eerder is besloten.
          </p>
          <Flow />
          <Steps />
        </div>
      </section>

      {/* EIGEN OMGEVING */}
      <section id="eigen-omgeving">
        <div className="wrap">
          <div className="label">Uw eigen omgeving</div>
          <h2>Een eigen omgeving voor uw bestuurlijke context.</h2>
          <p className="lede">
            Het Bestuurdersportaal is geen generieke AI-chat. Iedere organisatie
            krijgt een eigen online besluitomgeving die wordt ingericht rond de
            eigen documentatie, besluitdossiers, eerdere besluiten en
            governancecontext. Daardoor werkt de ondersteuning vanuit wat in úw
            organisatie geldt en eerder is besloten — niet vanuit algemene
            aannames.
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
                  <b>Historische context blijft beschikbaar</b>: eerdere
                  besluiten en onderbouwingen blijven vindbaar en herbruikbaar.
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

      {/* CONCREET */}
      <section>
        <div className="wrap">
          <div className="label">Concreet</div>
          <h2>Wat krijgt een bestuur concreet?</h2>
          <div className="value">
            <ul>
              <li>
                <span className="ck">—</span>
                <span>
                  <b>Een eigen online besluitomgeving</b> voor uw organisatie.
                </span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>
                  <b>Een gestructureerd besluitdossier</b> per vraagstuk.
                </span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>
                  <b>
                    AI-ondersteuning op uw eigen documentatie, dossiers en
                    historie
                  </b>{" "}
                  — samenvatten, toetsen, risico's signaleren en alternatieven
                  ordenen, met verwijzing naar de bron.
                </span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>
                  <b>Vastlegging</b> van aannames, risico's, overwegingen,
                  voorwaarden en acties.
                </span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>
                  <b>Een reconstrueerbare audittrail of export</b> voor
                  verantwoording.
                </span>
              </li>
              <li>
                <span className="ck">—</span>
                <span>
                  <b>Evaluatie en opvolging</b>: aannames toetsen, effecten
                  beoordelen, leerpunten vastleggen en opnieuw agenderen.
                </span>
              </li>
            </ul>
            <DossierKaart
              titel="Dossier · investeringsbesluit"
              status="v4"
              rijen={[
                { label: "Bronnen", waarde: "samengevat & gekoppeld" },
                { label: "Historie", waarde: "eerdere besluiten" },
                { label: "Risico's", waarde: "gesignaleerd" },
                { label: "Aannames", waarde: "expliciet" },
                { label: "Besluit", waarde: "+ onderbouwing" },
                { label: "Acties", waarde: "toegewezen" },
                { label: "Evaluatie", waarde: "opvolging gepland" },
              ]}
            />
          </div>
        </div>
      </section>

      {/* BRUG */}
      <section>
        <div className="wrap">
          <div className="label">The Paradox</div>
          <h2>Van besluitarchitectuur naar besluitpraktijk.</h2>
          <p className="lede">
            The Paradox onderzoekt en adviseert over betere besluitvorming in een
            wereld waarin menselijk oordeel en AI steeds meer samenkomen. Het
            Bestuurdersportaal vertaalt dat gedachtegoed naar een concrete
            digitale werkomgeving voor de dagelijkse bestuurspraktijk.
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
          <p className="bridge-quote">
            The Paradox levert het denkkader. Het Bestuurdersportaal maakt het
            toepasbaar in de bestuurspraktijk.
          </p>
          <p style={{ marginTop: "16px" }}>
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

      {/* VOOR WIE */}
      <section id="voorwie">
        <div className="wrap">
          <div className="label">Voor wie</div>
          <h2>
            Voor besturen en commissies waar besluiten aantoonbaar zorgvuldig
            moeten zijn.
          </h2>
          <p className="lede">
            Gebouwd voor bestuurlijke omgevingen waar besluiten gevolgen hebben
            en verantwoording vragen. Bestuursbureaus, secretariaten en
            GRC-teams ondersteunen daarbij het bestuurlijke proces.
          </p>
          <div className="blocks">
            <div className="bl">
              <h3>Besturen</h3>
              <p>
                Voor strategische en bestuurlijke besluiten waarbij informatie,
                risico's, alternatieven en verantwoordelijkheden zorgvuldig
                moeten worden gewogen.
              </p>
            </div>
            <div className="bl">
              <h3>Commissies</h3>
              <p>
                Voor commissies die besluiten voorbereiden, verdiepen of
                adviseren — bijvoorbeeld op het gebied van beleid, risico, audit,
                beleggingen, uitbesteding of governance.
              </p>
            </div>
            <div className="bl">
              <h3>Raden van toezicht</h3>
              <p>
                Voor toezicht op besluitvorming, onderbouwing, opvolging en
                bestuurlijke zorgvuldigheid.
              </p>
            </div>
            <div className="bl">
              <h3>Bestuursbureaus en secretariaten</h3>
              <p>
                Voor structuur, dossiervorming, procesondersteuning, opvolging
                van acties en voorbereiding van besluitvorming.
              </p>
            </div>
            <div className="bl">
              <h3>Governance-, risk- en compliance-teams</h3>
              <p>
                Voor toetsing, signalering, risicoduiding en borging van
                verantwoorde besluitvorming.
              </p>
            </div>
            <div className="bl spec">
              <h3>Pensioenfondsbesturen en -commissies</h3>
              <p>
                Als eerste specialisatie, waar toezicht, uitbesteding, WTP,
                datakwaliteit, risicobeheersing en bestuurlijke
                verantwoordelijkheid scherp samenkomen.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* GEBRUIKSSITUATIES */}
      <section id="gebruikssituaties">
        <div className="wrap">
          <div className="label">Gebruikssituaties</div>
          <h2>Voor welk besluit?</h2>
          <p className="lede">
            Het Bestuurdersportaal is gemaakt voor besluiten die zorgvuldige
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
            <span className="chip spec">WTP-besluiten (specialisatie)</span>
          </div>
        </div>
      </section>

      {/* SPECIALISATIE */}
      <section id="specialisatie">
        <div className="wrap">
          <div className="label">Specialisatie</div>
          <h2>Diepe expertise in de pensioensector.</h2>
          <p className="lede">
            De pensioensector is onze eerste specialisatie. Daar komen
            governance, toezicht, uitbesteding, WTP-transitie, datakwaliteit,
            risicobeheersing en bestuurlijke verantwoordelijkheid scherp en
            gelijktijdig samen. De pensioensector verdiept het product, maar
            beperkt het niet. De onderliggende besluitarchitectuur is toepasbaar
            in iedere omgeving waar besluiten zorgvuldig, transparant en
            reconstrueerbaar moeten zijn.
          </p>
        </div>
      </section>

      {/* ONDERSCHEID */}
      <section className="distinct">
        <div className="wrap">
          <div className="label">Onderscheid</div>
          <h2>
            Geen documentportaal. Geen vergadertool.{" "}
            <span>Geen losse AI-chat.</span>
          </h2>
          <p className="lede">
            Een eigen besluitomgeving. Bestaande tools beheren documenten,
            plannen vergaderingen of beantwoorden losse vragen zonder kennis van
            uw context. Het Bestuurdersportaal is een organisatiegebonden
            besluitomgeving, ontworpen rond de volledige besluitcyclus — van
            voorbereiding en afweging tot besluit, verantwoording, opvolging en
            evaluatie — en werkt vanuit uw eigen documentatie, dossiers en
            historie op de plek waar het besluit valt.
          </p>
        </div>
      </section>

      {/* GOVERNANCE & AI */}
      <section id="governance-ai">
        <div className="wrap">
          <div className="label">Governance &amp; AI</div>
          <h2>AI mag ondersteunen. Niet ongemerkt sturen.</h2>
          <p className="lede">AI-ondersteuning is bewust begrensd en zichtbaar gemaakt.</p>
          <div className="principles">
            <div className="pr">
              <span className="n">01</span>
              <div>
                <h3>Werkt binnen uw context</h3>
                <p>
                  AI werkt binnen de eigen ingerichte context van uw organisatie
                  — uw documenten, besluitdossiers en historie — en redeneert met
                  verwijzing naar de bron, niet op basis van een onzichtbaar
                  achtergrondmodel.
                </p>
              </div>
            </div>
            <div className="pr">
              <span className="n">02</span>
              <div>
                <h3>Feit vs. duiding</h3>
                <p>
                  Onderscheid tussen feitelijke analyse en bestuurlijke duiding
                  blijft expliciet.
                </p>
              </div>
            </div>
            <div className="pr">
              <span className="n">03</span>
              <div>
                <h3>Aannames zichtbaar</h3>
                <p>
                  Aannames, risico's en onzekerheden worden benoemd, niet
                  weggepoetst.
                </p>
              </div>
            </div>
            <div className="pr">
              <span className="n">04</span>
              <div>
                <h3>Rollen en rechten</h3>
                <p>
                  Wie wat mag zien en doen, is vastgelegd in rollen, rechten en
                  verantwoordelijkheden.
                </p>
              </div>
            </div>
            <div className="pr">
              <span className="n">05</span>
              <div>
                <h3>Reconstrueerbaar</h3>
                <p>
                  Een audittrail maakt achteraf navolgbaar hoe een besluit tot
                  stand kwam.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* VEILIGHEID */}
      <section>
        <div className="wrap">
          <div className="label">Veiligheid &amp; vertrouwen</div>
          <h2>Zorgvuldig met informatie, bewust met AI.</h2>
          <p className="lede">
            Elke organisatie krijgt een eigen omgeving die per organisatie wordt
            ingericht, met aandacht voor rollen en rechten, logging, beheerste
            documentcontext en verantwoord AI-gebruik. Definitieve beveiligings-
            en verwerkingsafspraken worden per omgeving vastgelegd.
          </p>
          <ul className="sec-list">
            <li>
              Een eigen, per organisatie ingerichte omgeving met eigen
              documentcontext.
            </li>
            <li>Beveiligde toegang op basis van rollen en rechten.</li>
            <li>
              Logging van relevante handelingen ten behoeve van
              controleerbaarheid.
            </li>
            <li>
              Beheerde documentcontext: AI werkt binnen het afgebakende dossier
              en de eigen context.
            </li>
            <li>
              Aandacht voor privacy, informatiebeveiliging en verantwoord
              AI-gebruik.
            </li>
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-band" id="contact">
        <div className="wrap inner">
          <div>
            <div className="label">Pilot / demo</div>
            <h2>Start met één besluitdossier in uw eigen omgeving.</h2>
            <p>
              De waarde wordt het snelst zichtbaar met een concreet bestuurlijk
              vraagstuk — een beleidsbesluit, governance-dossier,
              investeringsbesluit, risicodossier, commissieadvies,
              uitbestedingsbesluit of pensioendossier. We richten samen uw eigen
              omgeving in met uw documentatie, eerdere besluiten en
              governancecontext, werken één dossier uit van voorbereiding tot
              evaluatie, en u ervaart het verschil in de praktijk.
            </p>
          </div>
          <div className="btns">
            <a href="/contact" className="btn btn-primary">
              Plan een demo
            </a>
            <a href="/contact" className="btn btn-outline">
              Bespreek een pilot
            </a>
          </div>
        </div>
      </section>

      <Footer variant="home" />
    </div>
  );
}
