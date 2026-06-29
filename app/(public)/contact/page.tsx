import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import ContactForm from "./_components/ContactForm";

// Contactpagina (W2). Formulier + server-side verwerking via /api/contact
// (opslag in contact_aanvragen + e-mailnotificatie, soft-fail). 1:1 met
// contact-mockup-v4. Claimdiscipline: geen toezeggingen over reactietermijnen
// die we niet kunnen waarmaken ("meestal binnen enkele werkdagen").
export const metadata: Metadata = {
  title: "Plan een demo of bespreek een pilot",
  description:
    "Plan een demo of bespreek een pilot met het Bestuurdersportaal — een AI-ondersteunde besluitomgeving voor besturen en commissies.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <div className="bp-contact">
      <Header variant="simple" />

      <div className="wrap wide">
        <div className="contact-grid">
          <div className="intro">
            <div className="label">Contact</div>
            <h1>Plan een demo of bespreek een pilot</h1>
            <p>
              We laten u graag zien hoe het Bestuurdersportaal één besluit van
              vraagstuk tot audittrail ondersteunt — en bespreken hoe een pilot
              er voor uw bestuur of commissie uitziet.
            </p>
            <p>
              De waarde wordt het snelst zichtbaar met één concreet bestuurlijk
              vraagstuk.
            </p>
            <div className="what">
              <div>
                <span className="d">—</span>
                <span>
                  <b>Demo</b> — een rondleiding langs een voorbeeld-besluitdossier.
                </span>
              </div>
              <div>
                <span className="d">—</span>
                <span>
                  <b>Pilot</b> — samen één echt besluitdossier inrichten.
                </span>
              </div>
              <div>
                <span className="d">—</span>
                <span>
                  <b>Vraag of samenwerking</b> — kort schakelen over de
                  mogelijkheden.
                </span>
              </div>
            </div>
          </div>

          <ContactForm />
        </div>
      </div>

      <Footer variant="simple" />
    </div>
  );
}
