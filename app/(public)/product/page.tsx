import type { Metadata } from "next";
import Image from "next/image";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import { OPEN_GRAPH_IMAGE } from "../open-graph";

// /product v0.8 — per module één sectie met het bijbehorende productfragment.
export const metadata: Metadata = {
  title: { absolute: "Product: modules voor het besluitproces — Bestuurdersportaal" },
  description:
    "Modules die samen het besluitproces bedienen: een brongebonden AI-assistent op uw eigen bibliotheek, vergaderingen met voorbereiding, en besluitdossiers.",
  alternates: { canonical: "/product" },
  openGraph: {
    title: "Product: modules voor het besluitproces — Bestuurdersportaal",
    description:
      "Modules die samen het besluitproces bedienen: een brongebonden AI-assistent op uw eigen bibliotheek, vergaderingen met voorbereiding, en besluitdossiers.",
    type: "website",
    url: "/product",
    images: [OPEN_GRAPH_IMAGE],
  },
};

export default function Pagina() {
  return (
    <div className="bp-page">
      <Header actief="/product" />

      <section className="phero">
        <div className="grid-bg"></div>
        <div className="wrap">
          <div className="eyebrow-label">Product</div>
          <h1>Modules die samen het besluitproces bedienen.</h1>
          <p className="lede">
            Een brongebonden AI-assistent die put uit uw eigen bibliotheek en context. Vergaderingen
            met voorbereiding per agendapunt. En complete besluitdossiers met risico&apos;s, aannames,
            voorwaarden en opvolging — inclusief afschrift en auditdossier.
          </p>
          <p><a href="/governance-ai" className="textlink">Zo begrenzen we het AI-gebruik →</a></p>
        </div>
      </section>

      <section className="sec-cool">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Vergaderingen</div>
            <h2>De stukken en de vraag komen bij elkaar.</h2>
          </div>
          <div className="duoshot">
            <div className="tekst">
              <h3>Alles bij het agendapunt</h3>
              <p>Het voorstel, de samenvatting en de gerichte verdieping staan bij het onderwerp
                 waarover wordt besloten — niet in een aparte map en niet in een los gesprek.</p>
              <ul className="lijst">
                <li><span className="ck">—</span><span>Stukken koppelen uit de bibliotheek of direct uploaden.</span></li>
                <li><span className="ck">—</span><span>Een samenvatting per stuk, met het gevraagde besluit erbij.</span></li>
                <li><span className="ck">—</span><span>Aandachtspunten of kritische vragen opvragen voor de vergadering.</span></li>
                <li><span className="ck">—</span><span>Eigen aantekeningen en inbreng vooraf van andere leden.</span></li>
              </ul>
            </div>
            <div>
              <div className="pshot"><Image src="/website/01-voorbereiding-agendapunt.png" width={1200} height={675} alt="Productweergave: een agendapunt met voorstel, samenvatting en verdiepingsvragen." /></div>
              <p className="bijschrift">Voorbereiding bij het agendapunt · demonstratiedata</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec-app">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Besluitdossier</div>
            <h2>Wat het besluit draagt, staat op papier.</h2>
          </div>
          <div className="duoshot omgekeerd">
            <div className="tekst">
              <h3>Aannames, risico&apos;s en voorwaarden</h3>
              <p>Elk besluitdossier kent dezelfde vaste onderdelen. Wat open staat blijft zichtbaar,
                 ook als het bestuur besluit door te gaan.</p>
              <ul className="lijst">
                <li><span className="ck">—</span><span><b>Aannames</b> met een onzekerheid en een evaluatiecriterium.</span></li>
                <li><span className="ck">—</span><span><b>Risico&apos;s</b> met impact, kans, categorie en beheersmaatregel.</span></li>
                <li><span className="ck">—</span><span><b>Voorwaarden</b> met KPI, drempelwaarde en monitorfrequentie.</span></li>
                <li><span className="ck">—</span><span><b>Afwijkende standpunten</b> apart genoteerd in plaats van weggemasseerd.</span></li>
              </ul>
            </div>
            <div>
              <div className="pshot"><Image src="/website/03-risicos-en-aannames.png" width={1200} height={675} alt="Productweergave: het onderbouwingspaneel met aannames, risico's en voorwaarden." /></div>
              <p className="bijschrift">De afweging wordt expliciet · demonstratiedata</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec-cool">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Processen</div>
            <h2>Elke stap laat zien wat nog ontbreekt.</h2>
            <p className="lede">
              Een besluitdossier doorloopt vaste fasen. Bij de actieve stap staat wat gereed is,
              wat nog moet gebeuren en wie aan zet is.
            </p>
          </div>
          <div className="duoshot">
            <div className="tekst">
              <ul className="lijst">
                <li><span className="ck">—</span><span>Aanleiding en intake</span></li>
                <li><span className="ck">—</span><span>Onderbouwing</span></li>
                <li><span className="ck">—</span><span>Risico- en kaderscheck</span></li>
                <li><span className="ck">—</span><span>Bestuursoverleg en agendering</span></li>
                <li><span className="ck">—</span><span>Besluit vastleggen</span></li>
                <li><span className="ck">—</span><span>Implementatie en evaluatie</span></li>
              </ul>
              <p className="bijschrift">Een stap sluit pas als de checklist en het vereiste bewijsstuk er zijn.
                Doorgaan mag — met een reden die wordt vastgelegd.</p>
            </div>
            <div>
              <div className="pshot"><Image src="/website/04-besluit-heeft-een-route.png" width={1200} height={675} alt="Productweergave: de fasen van een besluitproces met de actieve stap en de openstaande vereisten." /></div>
              <p className="bijschrift">Het besluit heeft een route · demonstratiedata</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec-app">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Afschrift en audit</div>
            <h2>Het besluit draagt zijn motivering.</h2>
          </div>
          <div className="duoshot omgekeerd">
            <div className="tekst">
              <h3>Besluit, voorwaarden en opvolging</h3>
              <p>Formulering, motivering, verworpen alternatieven en voorwaarden blijven bijeen.
                 Acties krijgen een eigenaar en een termijn, en de evaluatie staat geagendeerd
                 voordat iemand erom vraagt.</p>
              <ul className="lijst">
                <li><span className="ck">—</span><span>Een afschrift van het besluitmoment als bevroren snapshot.</span></li>
                <li><span className="ck">—</span><span>Een auditdossier van de huidige stand of van dat moment.</span></li>
                <li><span className="ck">—</span><span>Acties gekoppeld aan de voorwaarde die ze bewaken.</span></li>
              </ul>
            </div>
            <div>
              <div className="pshot"><Image src="/website/05-besluit-en-voorwaarden.png" width={1200} height={675} alt="Productweergave: een vastgelegd besluit met motivering, alternatieven en voorwaarden." /></div>
              <p className="bijschrift">Besluit en voorwaarden vastgelegd · demonstratiedata</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec-cool">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">AI-assistent</div>
            <h2>Ondersteuning die haar bronnen laat zien.</h2>
          </div>
          <div className="duoshot">
            <div className="tekst">
              <p>De assistent zoekt in uw eigen bibliotheek, uw dossiers en uw eerdere besluiten,
                 en daarnaast in een centraal gecureerd kader met wet- en regelgeving en
                 toezichtdocumentatie. Onder elk antwoord staat welke bronnen zijn gebruikt.</p>
              <ul className="lijst">
                <li><span className="ck">—</span><span>U kiest wat u terugkrijgt: samenvatting, aandachtspunten of kritische vragen.</span></li>
                <li><span className="ck">—</span><span>Verwijzing per stelling: document, hoofdstuk, pagina.</span></li>
                <li><span className="ck">—</span><span>Zichtbaar of het antwoord alleen op eigen documenten rust.</span></li>
                <li><span className="ck">—</span><span>Doorvragen — feitelijker, kritischer, korter — blijft in hetzelfde spoor.</span></li>
              </ul>
              <p style={{marginTop: '18px'}}><a href="/governance-ai" className="textlink">Zo begrenzen we het AI-gebruik →</a></p>
            </div>
            <div>
              <div className="pshot"><Image src="/website/02-antwoorden-zichtbare-bronnen.png" width={1200} height={675} alt="Productweergave: een antwoord met het paneel Onderbouwing en bronnen." /></div>
              <p className="bijschrift">Antwoorden met zichtbare bronnen · demonstratiedata</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec-app">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow-label">Integratiemogelijkheden</div>
            <h2>Een optionele koppeling met Microsoft 365.</h2>
          </div>
          <div className="duoshot omgekeerd">
            <div className="tekst">
              <p>Bestuurdersportaal kan worden gekoppeld aan Microsoft 365. Documenten uit
                 SharePoint blijven in hun bestaande omgeving en worden als bron aan het dossier
                 verbonden. Gebruikers kunnen via hun vertrouwde werkaccount inloggen.</p>
              <p className="bijschrift">Illustratieve weergave — geen applicatiescherm.</p>
            </div>
            <div>
              <div className="pshot"><Image src="/website/06-microsoft-365-sharepoint.png" width={1200} height={675} alt="Illustratie van een optionele integratie tussen Microsoft 365, SharePoint en het besluitdossier." /></div>
              <p className="bijschrift">Optionele Microsoft 365-integratie · illustratieve weergave</p>
            </div>
          </div>
        </div>
      </section>


      <section className="sec-cool" id="demo">
        <div className="wrap">
          <div className="ctapanel">
            <div>
              <h2>Bekijk een herkenbaar besluitdossier in een live demo.</h2>
              <p>We lopen door één dossier — voorbereiding, afweging, besluit en opvolging.</p>
            </div>
            <div className="acts">
              <a href="/contact" className="btn btn-primary">Plan een live demo</a>
              <a href="/contact?type=pilot" className="btn btn-outline">Bespreek daarna een pilot met uw eigen dossier</a>
              <span className="fine">Dertig minuten, online. Geen voorbereiding nodig.</span>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
