import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import Crumb from "../_components/Crumb";
import CtaBand from "../_components/CtaBand";

// /governance-ai — verantwoord AI-gebruik in besluitvorming (copy v0.2 §5).
// Claimdiscipline (contentplan §4): bewust géén "volledig veilig / compliant /
// voldoet aan DNB-AFM / data blijft in NL-EU / geen training op klantdata /
// eigen database per klant / ISO-SOC-NEN-gecertificeerd". Veilige formuleringen
// per schrijverszelfcheck.
export const metadata: Metadata = {
  title: {
    absolute:
      "Governance & AI — verantwoord AI-gebruik in besluitvorming | Bestuurdersportaal",
  },
  description:
    "AI mag ondersteunen, niet ongemerkt sturen. Brongebonden, met feit en duiding gescheiden, aannames zichtbaar, rollen en rechten vastgelegd en een reconstrueerbare audittrail.",
  alternates: { canonical: "/governance-ai" },
  openGraph: {
    title: "Governance & AI — verantwoord AI-gebruik in besluitvorming",
    description:
      "AI mag ondersteunen, niet ongemerkt sturen. Brongebonden, met feit en duiding gescheiden, aannames zichtbaar, rollen en rechten vastgelegd en een reconstrueerbare audittrail.",
    type: "website",
    url: "/governance-ai",
  },
};

const PRINCIPES: { titel: string; tekst: string }[] = [
  {
    titel: "Werkt binnen uw context",
    tekst:
      "AI werkt binnen de eigen ingerichte context van uw organisatie — uw documenten, besluitdossiers en historie — en redeneert met verwijzing naar de bron, niet op basis van een onzichtbaar achtergrondmodel.",
  },
  {
    titel: "Feit vs. duiding",
    tekst:
      "Het onderscheid tussen feitelijke analyse en bestuurlijke duiding blijft expliciet.",
  },
  {
    titel: "Aannames zichtbaar",
    tekst:
      "Aannames, risico's en onzekerheden worden benoemd, niet weggepoetst.",
  },
  {
    titel: "Rollen en rechten",
    tekst:
      "Wie wat mag zien en doen, is vastgelegd in rollen, rechten en verantwoordelijkheden.",
  },
  {
    titel: "Reconstrueerbaar",
    tekst:
      "Een audittrail maakt achteraf navolgbaar hoe een besluit tot stand kwam.",
  },
];

export default function GovernanceAiPage() {
  return (
    <div className="bp-page">
      <Header variant="full" actief="/governance-ai" />

      {/* HERO */}
      <section className="phero">
        <div className="grid-bg" />
        <div className="wrap">
          <Crumb items={[{ label: "Governance & AI" }]} />
          <h1>AI mag ondersteunen. Niet ongemerkt sturen.</h1>
          <p className="sub">
            In een bestuurlijke omgeving telt niet alleen wat AI kan, maar hoe
            verantwoord ze wordt ingezet. Bij Bestuurdersportaal is
            AI-ondersteuning bewust begrensd en zichtbaar gemaakt.
          </p>
          <div className="cta">
            <a href="/contact" className="btn btn-primary">
              Neem contact op
            </a>
          </div>
        </div>
      </section>

      {/* VIJF UITGANGSPUNTEN */}
      <section>
        <div className="wrap">
          <div className="label">Uitgangspunten</div>
          <h2>Vijf uitgangspunten voor verantwoord AI-gebruik.</h2>
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

      {/* VEILIGHEID EN VERTROUWEN */}
      <section>
        <div className="wrap">
          <div className="label">Veiligheid &amp; vertrouwen</div>
          <h2>Zorgvuldig met informatie, bewust met AI.</h2>
          <p className="lede">
            Elke organisatie krijgt een eigen omgeving die per organisatie wordt
            ingericht, met aandacht voor rollen en rechten, logging, beheerste
            documentcontext en verantwoord AI-gebruik. Definitieve beveiligings- en
            verwerkingsafspraken worden per omgeving vastgelegd.
          </p>
          <ul className="pledge">
            <li>Een eigen, per organisatie ingerichte omgeving met eigen documentcontext.</li>
            <li>Beveiligde toegang op basis van rollen en rechten.</li>
            <li>Logging van relevante handelingen ten behoeve van controleerbaarheid.</li>
            <li>
              Beheerde documentcontext: AI werkt binnen het afgebakende dossier en
              de eigen context.
            </li>
            <li>Aandacht voor privacy, informatiebeveiliging en verantwoord AI-gebruik.</li>
          </ul>
        </div>
      </section>

      {/* WAT DE OMGEVING NIET DOET */}
      <section>
        <div className="wrap">
          <div className="label">Grenzen</div>
          <h2>Wat de omgeving niet doet.</h2>
          <div className="duo">
            <div className="col">
              <div className="tag">De omgeving ondersteunt</div>
              <ul>
                <li>
                  <span className="ck">+</span>
                  <span>Ordent, toetst en signaleert — met verwijzing naar de bron.</span>
                </li>
                <li>
                  <span className="ck">+</span>
                  <span>Maakt aannames, risico's en afwegingen zichtbaar.</span>
                </li>
                <li>
                  <span className="ck">+</span>
                  <span>Legt navolgbaar vast hoe een besluit tot stand kwam.</span>
                </li>
              </ul>
            </div>
            <div className="col">
              <div className="tag">De omgeving doet niet</div>
              <ul>
                <li>
                  <span className="ck">—</span>
                  <span>Geen besluiten nemen in plaats van het bestuur.</span>
                </li>
                <li>
                  <span className="ck">—</span>
                  <span>Geen uitspraken namens toezichthouders.</span>
                </li>
                <li>
                  <span className="ck">—</span>
                  <span>
                    Geen advies dat de verantwoordelijkheid van het bestuur
                    overneemt.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* EU AI ACT — verdieping */}
      <section>
        <div className="wrap">
          <div className="label">EU AI Act</div>
          <h2>Wat de EU AI Act betekent voor verantwoord AI-gebruik.</h2>
          <p className="lede">
            De EU AI Act vergroot de noodzaak om zorgvuldig met AI om te gaan. Ze
            versterkt dezelfde uitgangspunten: brongebonden werken, menselijk
            toezicht, transparantie en verantwoording. Bestuurdersportaal helpt die
            randvoorwaarden in de bestuurspraktijk in te richten — met het oordeel
            altijd bij het bestuur.
          </p>
          <p className="link-row">
            <a href="/governance-ai/eu-ai-act" className="textlink">
              EU AI Act &amp; verantwoord AI-gebruik →
            </a>
          </p>
        </div>
      </section>

      {/* CTA */}
      <CtaBand
        kop="Vragen over verantwoord AI-gebruik in uw context?"
        primair={{ href: "/contact", label: "Neem contact op" }}
      />

      <Footer variant="full" />
    </div>
  );
}
