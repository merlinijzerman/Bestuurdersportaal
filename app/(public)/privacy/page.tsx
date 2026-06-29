import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";

// Privacyverklaring — 1:1 met privacy-mockup-v4. Geen certificeringsclaims.
export const metadata: Metadata = {
  title: "Privacyverklaring",
  description:
    "Privacyverklaring van het Bestuurdersportaal: hoe wij omgaan met persoonsgegevens via de publieke website.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="bp-doc">
      <Header variant="simple" />

      <div className="wrap intro">
        <h1>Privacyverklaring</h1>
        <div className="meta">Laatst bijgewerkt: 29 juni 2026</div>
      </div>

      <div className="wrap body">
        <p>
          Deze privacyverklaring beschrijft hoe het Bestuurdersportaal omgaat met
          persoonsgegevens die via deze website worden verwerkt.
        </p>
        <p>
          Deze verklaring is opgesteld voor de publieke website van het
          Bestuurdersportaal, waaronder de homepage, contactpagina en
          loginpagina. Voor specifieke klantomgevingen kunnen aanvullende
          afspraken gelden, bijvoorbeeld in een verwerkersovereenkomst of
          gebruiksovereenkomst.
        </p>

        <h2>1. Wie zijn wij?</h2>
        <p>
          Het Bestuurdersportaal is een AI-ondersteunde besluitomgeving voor
          besturen en commissies. De publieke website wordt gebruikt om
          informatie te geven over het Bestuurdersportaal en om contact-, demo-
          en pilotverzoeken te ontvangen.
        </p>
        <p>
          Contact voor privacyvragen:{" "}
          <a href="mailto:privacy@the-paradox.com">privacy@the-paradox.com</a>
        </p>
        <p>
          Algemene contactadressen:{" "}
          <a href="mailto:merlin.ijzerman@the-paradox.com">
            merlin.ijzerman@the-paradox.com
          </a>
          ,{" "}
          <a href="mailto:robert.timmer@the-paradox.com">
            robert.timmer@the-paradox.com
          </a>
        </p>
        <div className="callout">
          Let op: de definitieve juridische entiteit achter het
          Bestuurdersportaal moet nog worden vastgesteld. Zodra deze bekend is,
          wordt deze privacyverklaring daarop aangepast.
        </div>

        <h2>2. Welke persoonsgegevens verwerken wij?</h2>
        <p>
          Wanneer u het contactformulier gebruikt, kunnen wij de volgende
          gegevens verwerken:
        </p>
        <ul>
          <li>naam;</li>
          <li>organisatie;</li>
          <li>rol of functie;</li>
          <li>e-mailadres;</li>
          <li>telefoonnummer, indien u dit invult;</li>
          <li>
            type verzoek, bijvoorbeeld demo, pilot, algemene vraag of
            samenwerking;
          </li>
          <li>de inhoud van uw bericht;</li>
          <li>
            technische gegevens die nodig zijn om het formulier veilig en
            betrouwbaar te verwerken, zoals datum en tijd van verzending en
            eventueel IP-adres.
          </li>
        </ul>
        <p>
          Wij vragen u om geen gevoelige persoonsgegevens of vertrouwelijke
          bestuursinformatie via het publieke contactformulier te delen.
        </p>

        <h2>3. Waarom verwerken wij deze gegevens?</h2>
        <p>Wij verwerken persoonsgegevens voor de volgende doelen:</p>
        <ol>
          <li>het beantwoorden van uw vraag;</li>
          <li>het opvolgen van een demo-, pilot- of contactverzoek;</li>
          <li>het kunnen plannen van een kennismaking of demonstratie;</li>
          <li>
            het verbeteren van de betrouwbaarheid en beveiliging van het
            formulier;
          </li>
          <li>
            het voorkomen van misbruik, spam of onbevoegd gebruik van de website.
          </li>
        </ol>
        <p>
          Wij gebruiken de gegevens uit het contactformulier niet automatisch
          voor nieuwsbrieven of commerciële mailinglijsten. Als wij in de
          toekomst nieuwsbrieven of marketingcommunicatie willen versturen, vragen
          wij daarvoor afzonderlijk toestemming wanneer dat nodig is.
        </p>

        <h2>4. Op welke grondslag verwerken wij persoonsgegevens?</h2>
        <p>
          Voor het behandelen van contact-, demo- en pilotverzoeken verwerken wij
          persoonsgegevens op basis van ons gerechtvaardigd belang om te kunnen
          reageren op verzoeken van bezoekers en potentiële gebruikers.
        </p>
        <p>
          Wanneer uw verzoek betrekking heeft op een mogelijke opdracht, pilot of
          overeenkomst, kan verwerking ook nodig zijn om op uw verzoek stappen te
          nemen voorafgaand aan het sluiten van een overeenkomst.
        </p>
        <p>
          Voor eventuele toekomstige nieuwsbrieven of marketingcommunicatie
          gebruiken wij alleen een passende grondslag, zoals toestemming wanneer
          dat vereist is.
        </p>

        <h2>5. Met wie delen wij persoonsgegevens?</h2>
        <p>Inzendingen via het contactformulier worden doorgestuurd naar:</p>
        <ul>
          <li>
            <a href="mailto:merlin.ijzerman@the-paradox.com">
              merlin.ijzerman@the-paradox.com
            </a>
            ;
          </li>
          <li>
            <a href="mailto:robert.timmer@the-paradox.com">
              robert.timmer@the-paradox.com
            </a>
            .
          </li>
        </ul>
        <p>
          Wij delen persoonsgegevens niet met derden voor eigen commerciële
          doeleinden.
        </p>
        <p>
          Voor de werking van de website, hosting, e-mailafhandeling, beveiliging
          en eventuele formulierverwerking kunnen wij gebruikmaken van technische
          dienstverleners. Met deze partijen maken wij passende afspraken over
          beveiliging en verwerking van persoonsgegevens.
        </p>

        <h2>6. Waar worden gegevens verwerkt?</h2>
        <p>
          De definitieve inrichting van hosting, e-mailverwerking en eventuele
          opslag moet nog worden vastgesteld. Zodra deze definitief is, wordt deze
          privacyverklaring aangepast.
        </p>
        <p>
          Uitgangspunt is dat persoonsgegevens zorgvuldig worden verwerkt en dat
          passende afspraken worden gemaakt met betrokken dienstverleners.
        </p>

        <h2>7. Hoe lang bewaren wij persoonsgegevens?</h2>
        <p>
          Wij bewaren persoonsgegevens niet langer dan nodig is voor het doel
          waarvoor ze zijn verzameld.
        </p>
        <p>
          Voor contact-, demo- en pilotverzoeken hanteren wij als uitgangspunt dat
          gegevens maximaal 12 maanden na het laatste contactmoment worden
          bewaard, tenzij:
        </p>
        <ul>
          <li>er een klantrelatie of pilot ontstaat;</li>
          <li>
            langere bewaring nodig is voor administratie, juridische onderbouwing
            of geschilafhandeling;
          </li>
          <li>
            u eerder verzoekt om verwijdering en er geen reden is om de gegevens
            langer te bewaren.
          </li>
        </ul>
        <p>
          Deze bewaartermijn is een voorlopig uitgangspunt en wordt definitief
          vastgesteld bij de verdere inrichting van de website en processen.
        </p>

        <h2>8. Beveiliging</h2>
        <p>
          Wij nemen passende technische en organisatorische maatregelen om
          persoonsgegevens te beschermen tegen verlies, misbruik, onbevoegde
          toegang en ongeoorloofde wijziging.
        </p>
        <p>Voor de publieke website betekent dit onder meer aandacht voor:</p>
        <ul>
          <li>beveiligde verbindingen;</li>
          <li>beperkte toegang tot ontvangen contactverzoeken;</li>
          <li>server-side validatie van formulieren;</li>
          <li>maatregelen tegen spam en misbruik;</li>
          <li>zorgvuldige inrichting van e-mail- en hostingdiensten.</li>
        </ul>
        <p>
          Er worden geen certificeringsclaims gedaan, tenzij deze feitelijk zijn
          vastgesteld.
        </p>

        <h2>9. Cookies en analytics</h2>
        <p>
          Op dit moment is het uitgangspunt dat de publieke website geen
          marketingcookies plaatst.
        </p>
        <p>
          Als wij gebruikmaken van functionele cookies, analytische cookies of
          vergelijkbare technieken, dan beperken wij dit tot wat nodig is voor de
          werking en verbetering van de website. Voor cookies waarvoor toestemming
          nodig is, vragen wij vooraf toestemming.
        </p>
        <p>
          Deze paragraaf moet definitief worden gemaakt zodra duidelijk is welke
          analytics- of cookietools worden gebruikt.
        </p>

        <h2>10. AI en contactverzoeken</h2>
        <p>
          Contactverzoeken via de publieke website worden gebruikt om uw vraag te
          beantwoorden of een demo of pilot op te volgen.
        </p>
        <p>
          Wij gebruiken de inhoud van contactverzoeken niet zonder nadere
          beoordeling voor training van AI-modellen of publieke
          marketingdoeleinden.
        </p>
        <p>
          Als AI-ondersteuning in de toekomst wordt gebruikt bij het verwerken of
          samenvatten van contactverzoeken, wordt beoordeeld of aanvullende
          informatie of afspraken nodig zijn.
        </p>

        <h2>11. Uw privacyrechten</h2>
        <p>
          U heeft op grond van de AVG verschillende rechten met betrekking tot uw
          persoonsgegevens. U kunt onder meer verzoeken om:
        </p>
        <ul>
          <li>inzage in uw persoonsgegevens;</li>
          <li>correctie van onjuiste gegevens;</li>
          <li>verwijdering van gegevens;</li>
          <li>beperking van verwerking;</li>
          <li>bezwaar tegen verwerking;</li>
          <li>overdraagbaarheid van gegevens, voor zover van toepassing.</li>
        </ul>
        <p>
          U kunt een verzoek sturen naar:{" "}
          <a href="mailto:privacy@the-paradox.com">privacy@the-paradox.com</a>
        </p>
        <p>
          Wij kunnen u vragen om uw identiteit te bevestigen voordat wij een
          privacyverzoek afhandelen.
        </p>

        <h2>12. Klacht indienen</h2>
        <p>
          Als u vindt dat wij niet zorgvuldig omgaan met uw persoonsgegevens, kunt
          u contact met ons opnemen via:{" "}
          <a href="mailto:privacy@the-paradox.com">privacy@the-paradox.com</a>
        </p>
        <p>
          U heeft daarnaast het recht om een klacht in te dienen bij de Autoriteit
          Persoonsgegevens.
        </p>

        <h2>13. Wijzigingen</h2>
        <p>
          Wij kunnen deze privacyverklaring aanpassen als de website,
          contactformulieren, technische inrichting of dienstverlening wijzigt.
        </p>
        <p>De meest recente versie staat altijd op deze website.</p>
      </div>

      <Footer variant="simple" />
    </div>
  );
}
