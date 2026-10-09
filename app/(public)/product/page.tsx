import type { Metadata } from "next";
import Header from "../_components/Header";
import Footer from "../_components/Footer";
import ProductFeed from "../_components/ProductFeed";
import { OPEN_GRAPH_IMAGE } from "../open-graph";

// De zes productfragmenten staan in een bladerbare beeldstroom.
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

      <ProductFeed />

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
