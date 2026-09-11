import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import ContactForm from "./_components/ContactForm";

// Contactpagina v0.8. De primaire CTA op de site is "Plan een live demo".
// De introductie blijft bewust algemeen: geen vaste duur, agenda of voorbereiding
// beloven. `/contact?type=pilot` preselecteert de pilot-optie.
// Bewust buiten de zoekresultaten (noindex): deze pagina hoort bij een bezoek
// aan de site, niet als los zoekresultaat.
export const metadata: Metadata = {
  title: { absolute: "Plan een live demo — Bestuurdersportaal" },
  description:
    "Maak kennis met Bestuurdersportaal en bespreek wat het platform voor uw organisatie kan betekenen.",
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
              Maak kennis met Bestuurdersportaal. We laten zien hoe het platform
              werkt en bespreken wat het voor uw organisatie kan betekenen.
            </p>
            <p className="privacy-note">
              Laat uw gegevens achter. We nemen contact op om een passend moment
              af te spreken.
            </p>
          </div>

          <ContactForm initialType={initialType} />
        </div>
      </div>

      <Footer variant="simple" />
    </div>
  );
}
