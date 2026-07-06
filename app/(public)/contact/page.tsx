import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import ContactForm from "./_components/ContactForm";

// Contactpagina (W2 / copy v0.2 §7). Formulier + server-side verwerking via
// /api/contact (opslag in contact_aanvragen + e-mailnotificatie, soft-fail).
// Claimdiscipline: bewust géén reactietermijn toegezegd (besluit 0035 #6), geen
// e-mailadres in de front-end (FO REQ-PV-016/045), introtekst zonder salesdruk.
// `/contact?type=pilot` preselecteert de pilot-optie in het formulier.
export const metadata: Metadata = {
  title: "Contact | Bestuurdersportaal",
  description:
    "Neem laagdrempelig contact op — een vraag, een verkenning, een demo of een pilot. We denken graag met u mee.",
  alternates: { canonical: "/contact" },
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
            <h1>Neem contact op</h1>
            <p>
              Een vraag, een verkenning of een concrete pilot — neem contact op
              zoals het u past. Start desgewenst met één besluitdossier in uw
              eigen omgeving.
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
                  <b>Een demo of pilot</b> — een voorbeeld zien of samen één
                  besluitdossier inrichten.
                </span>
              </div>
            </div>
          </div>

          <ContactForm initialType={initialType} />
        </div>
      </div>

      <Footer variant="simple" />
    </div>
  );
}
