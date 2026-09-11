import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";

// Beknopte privacyverklaring voor de publieke website en het contactformulier.
export const metadata: Metadata = {
  title: "Privacyverklaring",
  description:
    "Privacyverklaring van het Bestuurdersportaal: hoe wij omgaan met persoonsgegevens via de publieke website.",
  alternates: { canonical: "/privacy" },
  // Buiten de zoekresultaten: juridische pagina, hoort bij een bezoek aan de site.
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <div className="bp-doc">
      <Header variant="simple" />

      <div className="wrap intro">
        <h1>Privacyverklaring</h1>
        <div className="meta">Laatst bijgewerkt: 11 september 2026</div>
      </div>

      <div className="wrap body">
        <p>
          Bestuurdersportaal.com is verantwoordelijk voor de verwerking van
          persoonsgegevens via deze publieke website. Voor privacyvragen kunt u
          mailen naar {" "}
          <a href="mailto:privacy@the-paradox.com">privacy@the-paradox.com</a>.
        </p>

        <h2>Welke gegevens gebruiken wij?</h2>
        <p>
          Als u het contactformulier gebruikt, verwerken wij uw naam, organisatie,
          e-mailadres, type verzoek en eventueel uw bericht. Ook kunnen wij het
          tijdstip, de herkomstpagina en een gehashte versie van uw IP-adres
          vastleggen. Voor de beveiliging verwerkt Cloudflare Turnstile technische
          signalen. Vercel meet geanonimiseerde bezoekersstatistieken.
        </p>

        <h2>Waarom doen wij dat?</h2>
        <p>
          Wij gebruiken deze gegevens om uw verzoek te beantwoorden, op uw verzoek
          stappen te zetten richting een mogelijke samenwerking, misbruik te
          voorkomen en de website te verbeteren. Dit doen wij omdat het nodig kan
          zijn voor voorbereidende stappen op uw verzoek en vanwege ons
          gerechtvaardigd belang bij contact, beveiliging en verbetering van de
          website. Wij gebruiken contactverzoeken niet voor nieuwsbrieven,
          AI-training of geautomatiseerde besluitvorming.
        </p>

        <h2>Delen en bewaren</h2>
        <p>
          Alleen betrokken medewerkers en leveranciers voor hosting, database,
          e-mail, beveiliging en statistieken krijgen toegang voor zover dat nodig
          is. Zij mogen de gegevens niet voor eigen marketing gebruiken. Als een
          leverancier buiten de Europese Economische Ruimte verwerkt, gebruiken
          wij de daarvoor geldende Europese waarborgen.
        </p>
        <p>
          Wij bewaren contactgegevens totdat uw verzoek is afgehandeld en daarna
          alleen zolang dat nodig is voor opvolging, administratie of een juridisch
          geschil.
        </p>

        <h2>Uw keuzes en rechten</h2>
        <p>
          Naam, organisatie, e-mailadres en type verzoek zijn nodig om uw verzoek
          te behandelen. Zonder deze gegevens kunnen wij niet reageren. U kunt ons
          vragen om inzage, correctie, verwijdering, beperking of overdracht van uw
          gegevens en u kunt bezwaar maken. Stuur uw verzoek naar {" "}
          <a href="mailto:privacy@the-paradox.com">privacy@the-paradox.com</a>.
          U kunt ook een klacht indienen bij de {" "}
          <a href="https://autoriteitpersoonsgegevens.nl/" rel="external">
            Autoriteit Persoonsgegevens
          </a>.
        </p>

        <h2>Cookies</h2>
        <p>
          Wij gebruiken geen marketing- of trackingcookies. De website gebruikt
          cookieloze, geanonimiseerde statistieken van Vercel en beveiliging van
          Cloudflare Turnstile op het contactformulier.
        </p>
      </div>

      <Footer variant="simple" />
    </div>
  );
}
