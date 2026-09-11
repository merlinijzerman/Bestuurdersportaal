import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import ContactForm from "./_components/ContactForm";

// Contactpagina v0.8. De primaire CTA op de site is "Plan een live demo", dus
// deze pagina vertelt wat daarna gebeurt: dertig minuten, online, één dossier.
// Claimdiscipline ongewijzigd: geen reactietermijn toegezegd, geen e-mailadres
// in de front-end. `/contact?type=pilot` preselecteert de pilot-optie.
// Bewust buiten de zoekresultaten (noindex): deze pagina hoort bij een bezoek
// aan de site, niet als los zoekresultaat.
export const metadata: Metadata = {
  title: { absolute: "Plan een live demo — Bestuurdersportaal" },
  description:
    "Dertig minuten, online: we lopen door één besluitdossier — voorbereiding, afweging, besluit en opvolging. Geen voorbereiding nodig.",
  alternates: { canonical: "/contact" },
  robots: { index: false, follow: true },
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const initialType = typeof sp.type === "string" ? sp.type : undefined;

  return (
    <div className="bp-contact">
      <Header variant="simple" />

      <div className="wrap wide">
        <div className="contact-grid">
          <div className="intro">
            <div className="label">Contact</div>
            <h1>Plan een live demo.</h1>
            <p>
              Dertig minuten, online. We lopen door één besluitdossier —
              voorbereiding, afweging, besluit en opvolging. Neem gerust een
              lopend vraagstuk in gedachten.
            </p>
            <div className="what">
              <div>
                <span className="d">—</span>
                <span>
                  <b>Een vraag</b> — kort schakelen over de mogelijkheden.
                </span>
              </div>
              <div>
                <span className="d">—</span>
                <span>
                  <b>Een verkenning</b> — bespreken of dit bij uw organisatie past.
                </span>
              </div>
              <div>
                <span className="d">—</span>
                <span>
                  <b>Een pilot</b> — samen één besluitdossier inrichten met uw
                  eigen stukken.
                </span>
              </div>
            </div>
            <p className="privacy-note">
              Geen voorbereiding nodig. We vragen niet vooraf om documenten.
            </p>
          </div>

          <ContactForm initialType={initialType} />
        </div>
      </div>

      <Footer variant="simple" />
    </div>
  );
}
