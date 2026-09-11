import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import { OPEN_GRAPH_IMAGE } from "../open-graph";

// /voor-wie v0.8 — samenvoeging van de oude /voor-wie, /sectoren en
// /sectoren/pensioenfondsen. Die twee routes redirecten hierheen.
export const metadata: Metadata = {
  title: { absolute: "Voor wie: besturen en commissies — Bestuurdersportaal" },
  description:
    "Voor de organen die samen tot een besluit komen: bestuur, commissies, toezicht, bestuursbureau en GRC. Pensioenfondsen zijn de eerste specialisatie.",
  alternates: { canonical: "/voor-wie" },
  openGraph: {
    title: "Voor wie: besturen en commissies — Bestuurdersportaal",
    description:
      "Voor de organen die samen tot een besluit komen: bestuur, commissies, toezicht, bestuursbureau en GRC. Pensioenfondsen zijn de eerste specialisatie.",
    type: "website",
    url: "/voor-wie",
    images: [OPEN_GRAPH_IMAGE],
  },
};

export default function Pagina() {
  return (
    <div className="bp-page">
      <Header actief="/voor-wie" />

      <section className="phero">
        <div className="grid-bg"></div>
        <div className="wrap">
          <div className="eyebrow-label">Voor wie</div>
          <h1>Voor de organen die samen tot een besluit komen.</h1>
          <p className="lede">
            Gebouwd voor bestuurlijke omgevingen waar besluiten gevolgen hebben en verantwoording
            vragen. Pensioenfondsen zijn de eerste sector waarvoor we het diepst hebben ingericht.
          </p>
          <p><a href="/product" className="textlink">Bekijk hoe een besluitdossier werkt →</a></p>
        </div>
      </section>

      <section className="sec-cool">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Rollen</div>
            <h2>Wie werkt er in een besluitdossier?</h2>
          </div>
          <div className="rolgrid">
            <div className="rol">
              <h3>Besturen en directies</h3>
              <p>Veel informatie, beperkte tijd, grote verantwoordingsdruk. Voor besluiten waarbij informatie, risico&apos;s, alternatieven en verantwoordelijkheden tegen elkaar moeten worden gewogen.</p>
              <span className="out">Levert op: besluitdossier, afwegingsoverzicht.</span>
            </div>
            <div className="rol">
              <h3>Commissies</h3>
              <p>Voorbereiding en advisering moeten navolgbaar zijn richting bestuur — op beleid, risico, audit, beleggingen, uitbesteding of governance.</p>
              <span className="out">Levert op: adviesdossier, opvolglijst.</span>
            </div>
            <div className="rol">
              <h3>Raden van toezicht en commissarissen</h3>
              <p>Toezicht op besluitkwaliteit vraagt inzicht in onderbouwing, opvolging en bestuurlijke zorgvuldigheid.</p>
              <span className="out">Levert op: reconstrueerbaar besluitdossier.</span>
            </div>
            <div className="rol">
              <h3>Bestuursbureaus en secretariaten</h3>
              <p>Dossiervorming, acties, versies en opvolging zijn vaak versnipperd. Hier staan ze bij het besluit waar ze bij horen.</p>
              <span className="out">Levert op: gestructureerd dossier, actieoverzicht.</span>
            </div>
            <div className="rol">
              <h3>Governance, risk en compliance</h3>
              <p>Risico&apos;s, beheersmaatregelen en beleidskaders staan vaak los van het bestuurlijke besluit. Hier hangen ze eraan vast.</p>
              <span className="out">Levert op: besluit met gekoppelde risico&apos;s.</span>
            </div>
          </div>
          <p className="sharp">Ongeacht de rol draait het om hetzelfde: navolgbaar maken waarop een besluit rust.</p>
        </div>
      </section>

      <section className="sec-app">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Herkenning</div>
            <h2>Past dit bij uw organisatie?</h2>
            <p className="lede">
              Bestuurdersportaal is niet aan één sector gebonden, maar aan een type besluitvorming.
              Herkent u deze kenmerken, dan sluit het waarschijnlijk aan.
            </p>
          </div>
          <div className="chips">
            <span className="chip">toezicht op de besluitvorming</span>
            <span className="chip">hoge verantwoordingsdruk, intern en extern</span>
            <span className="chip">uitbestedingsketens waarin het bestuur verantwoordelijk blijft</span>
            <span className="chip">documentintensieve besluiten met veel bronnen</span>
            <span className="chip">commissies, toezicht en bestuursbureaus die samen tot een besluit komen</span>
            <span className="chip">AI die alleen binnen kaders toepasbaar is</span>
          </div>
        </div>
      </section>

      <section className="sec-cool">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Eerste specialisatie</div>
            <h2>Pensioenfondsen.</h2>
            <p className="lede">
              Bij pensioenfondsen komen toezicht, uitbesteding, risicobeheersing en bestuurlijke
              verantwoordelijkheid tegelijk samen. Het is de sector waarvoor we het product het
              diepst hebben ingericht — de opzet eronder is breder toepasbaar.
            </p>
          </div>
          <div className="trio">
            <div className="m">
              <div className="st">Uitbestedingsketen</div>
              <h3>Verantwoordelijk op afstand</h3>
              <p>Uitvoering, vermogensbeheer en administratie zijn vaak uitbesteed. Het bestuur
                 blijft verantwoordelijk en moet kunnen sturen én verantwoorden.</p>
            </div>
            <div className="m">
              <div className="st">Toezicht</div>
              <h3>Verantwoording is de norm</h3>
              <p>Fondsen leggen verantwoording af aan interne toezichtorganen en externe
                 stakeholders — vaak over besluiten van jaren terug.</p>
            </div>
            <div className="m">
              <div className="st">Documentintensiteit</div>
              <h3>Veel bronnen per besluit</h3>
              <p>Beleidsstukken, adviezen, data en verslagen. Het overzicht daarvan bepaalt mede
                 de kwaliteit van het besluit.</p>
            </div>
          </div>
          <div className="sec-head" style={{marginTop: '56px', marginBottom: '0'}}>
            <div className="eyebrow-label">Gebruikssituaties</div>
            <h2>Waar het bij helpt.</h2>
            <p className="lede">Elke situatie beschrijft ondersteuning, geen garantie of naleving.</p>
          </div>
          <div className="kaartjes">
            <div className="kaartje"><h3>Uitbesteding en sturing</h3><p>Besluiten over uitbesteding en het sturen op uitbestede partijen onderbouwen en vastleggen.</p></div>
            <div className="kaartje"><h3>Beleggingsbeleid en risicohouding</h3><p>De afweging en de vastlegging rond beleggingsbeleid en risicohouding ondersteunen.</p></div>
            <div className="kaartje"><h3>Risicobeheersing en compliance</h3><p>Risico&apos;s, beheersmaatregelen en beleidskaders aan het bestuurlijke besluit verbinden.</p></div>
            <div className="kaartje"><h3>Bestuurs- en commissiebesluiten</h3><p>Voorbereiding, advisering en besluitvorming met bronnen, aannames en opvolgpunten in één dossier.</p></div>
            <div className="kaartje"><h3>Verantwoording</h3><p>Afwegingen, besluiten en opvolging herleidbaar maken voor intern toezicht en externe stakeholders.</p></div>
            <div className="kaartje"><h3>Evaluatie</h3><p>Toetsen of voorwaarden zijn nagekomen en of de aannames klopten.</p></div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
