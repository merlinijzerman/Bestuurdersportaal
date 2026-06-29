import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";

// Contact-placeholder (W1). Het volledige contactformulier met server-side
// verwerking, rate limiting en e-mailafhandeling volgt in W2 (contact-mockup-v4
// + /api/contact). Tot die tijd: een statische pagina met directe mailto-links,
// zonder formulier of backend. Claimdiscipline: geen toezeggingen over
// reactietermijnen die we niet kunnen waarmaken.
export const metadata: Metadata = {
  title: "Plan een demo of bespreek een pilot",
  description:
    "Plan een demo of bespreek een pilot met het Bestuurdersportaal — een AI-ondersteunde besluitomgeving voor besturen en commissies.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <div className="bp-doc">
      <Header variant="simple" />

      <div className="wrap intro">
        <div className="meta">Contact</div>
        <h1>Plan een demo of bespreek een pilot</h1>
        <p className="lead">
          We laten u graag zien hoe het Bestuurdersportaal één besluit van
          vraagstuk tot audittrail ondersteunt — en bespreken hoe een pilot er
          voor uw bestuur of commissie uitziet. De waarde wordt het snelst
          zichtbaar met één concreet bestuurlijk vraagstuk.
        </p>
      </div>

      <div className="wrap body">
        <p>
          Neem rechtstreeks contact op via e-mail. Vermeld kort uw organisatie,
          rol en of het om een demo, pilot, algemene vraag of samenwerking gaat.
        </p>
        <ul>
          <li>
            <a href="mailto:merlin.ijzerman@the-paradox.com">
              merlin.ijzerman@the-paradox.com
            </a>
          </li>
          <li>
            <a href="mailto:robert.timmer@the-paradox.com">
              robert.timmer@the-paradox.com
            </a>
          </li>
        </ul>
        <div className="callout">
          Een online contactformulier volgt binnenkort. Tot die tijd kunt u ons
          rechtstreeks per e-mail bereiken.
        </div>
        <p>
          Wij gebruiken uw gegevens alleen om uw verzoek te behandelen en contact
          met u op te nemen. Lees meer in onze{" "}
          <a href="/privacy" className="textlink">
            privacyverklaring
          </a>
          .
        </p>
      </div>

      <Footer variant="simple" />
    </div>
  );
}
