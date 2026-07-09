import type { Metadata } from "next";
import Header from "../../_components/Header";
import Footer from "../../_components/Footer";
import Crumb from "../../_components/Crumb";
import CtaBand from "../../_components/CtaBand";

// /governance-ai/eu-ai-act — verdieping onder Governance & AI (contentplan v1.0 §11).
// GEEN eigen hoofdmenu-item: dit is bewust een verdiepingspagina onder /governance-ai.
// Claimdiscipline (contentplan §6, claimregister): uitsluitend Live/Beperkt-live-
// formuleringen. Bewust GÉÉN absolute compliance-claims ("EU AI Act compliant",
// "volledig compliant", "juridisch geborgd", "voldoet aan alle eisen"),
// geen integriteitshash-claim, geen automatische validatie-notificatie. Het oordeel
// blijft altijd bij het bestuur; Bestuurdersportaal geeft geen juridisch advies.

const TITEL =
  "EU AI Act & verantwoord AI-gebruik — brongebonden, controleerbaar en uitlegbaar | Bestuurdersportaal";
const OMSCHRIJVING =
  "De EU AI Act vergroot de noodzaak om zorgvuldig met AI om te gaan. Bestuurdersportaal helpt AI-gebruik in de bestuurspraktijk brongebonden, controleerbaar en bestuurlijk uitlegbaar te maken — met het oordeel altijd bij het bestuur.";

export const metadata: Metadata = {
  title: { absolute: TITEL },
  description: OMSCHRIJVING,
  alternates: { canonical: "/governance-ai/eu-ai-act" },
  openGraph: {
    title: "EU AI Act & verantwoord AI-gebruik",
    description: OMSCHRIJVING,
    type: "website",
    url: "/governance-ai/eu-ai-act",
  },
};

// Sectie 3 — wat de EU AI Act op hoofdlijnen vraagt (tijdloos; géén deadlines).
const HOOFDLIJNEN: string[] = [
  "De AI Act werkt risicogebaseerd: hoe hoger het risico, hoe zwaarder de eisen.",
  "Verplichtingen hangen af van uw rol, de context en de concrete use-case.",
  "Niet elk bestuurlijk AI-gebruik is automatisch hoog-risico.",
  "AI-geletterdheid, transparantie, menselijk toezicht en verantwoord gebruik zijn breed relevant.",
  "Formele classificatie en juridische beoordeling blijven maatwerk.",
];

// Sectie 4 — categorievergelijking (geen concurrenten bij naam).
const VERGELIJK: { chat: string; portaal: string }[] = [
  { chat: "Open chat, los van het proces", portaal: "Contextgebonden besluitomgeving" },
  { chat: "Losse output", portaal: "Brongebonden onderbouwing" },
  { chat: "Geen governance-spoor", portaal: "Vastlegging van gebruik en opvolging" },
  { chat: "Individuele promptpraktijk", portaal: "Rollen, rechten en bestuurlijke afspraken" },
  { chat: "Antwoordgericht", portaal: "Besluitvormingsgericht" },
];

// Sectie 5 — claimveilige functie-kaarten (uitsluitend Live/Beperkt-live uit §6).
const ONDERSTEUNING: { titel: string; tekst: string }[] = [
  {
    titel: "Brongebonden antwoorden",
    tekst: "AI werkt met beheerde documentcontext en toont de gebruikte bronnen.",
  },
  {
    titel: "Expliciete gebruiksmodi",
    tekst:
      "Gebruikers zien waarop een antwoord is gebaseerd en wanneer algemene kennis wordt gebruikt.",
  },
  {
    titel: "Menselijke validatie",
    tekst: "AI-output in besluitdossiers kan worden beoordeeld en gevalideerd.",
  },
  {
    titel: "Rollen en rechten",
    tekst: "Toegang en validatie kunnen per organisatie en rol worden ingericht.",
  },
  {
    titel: "Logging en audittrail",
    tekst:
      "Relevante AI-interacties en governance-gebeurtenissen worden vastgelegd, zodat gebruik en opvolging beter reconstrueerbaar zijn.",
  },
];

// Sectie 6 — van governance-thema naar praktijk. Publieke tabel op basis van het
// interne claimregister (§6): uitsluitend toegestane publieke formuleringen.
const PRAKTIJK: { thema: string; praktijk: string }[] = [
  {
    thema: "Transparantie over herkomst",
    praktijk: "Brongebonden antwoorden binnen beheerde documentcontext, met de gebruikte bronnen in beeld.",
  },
  {
    thema: "Zichtbaarheid van AI-gebruik",
    praktijk: "Expliciete gebruiksmodi maken zichtbaar wanneer algemene kennis wordt gebruikt.",
  },
  {
    thema: "Menselijk toezicht",
    praktijk: "AI-output in besluitdossiers kan door de bevoegde rol worden beoordeeld en gevalideerd.",
  },
  {
    thema: "Rollen en verantwoordelijkheden",
    praktijk: "Toegang en validatie worden per organisatie en rol ingericht.",
  },
  {
    thema: "Verantwoording en reconstrueerbaarheid",
    praktijk:
      "Relevante AI-interacties en governance-gebeurtenissen worden vastgelegd, zodat gebruik en opvolging beter reconstrueerbaar zijn.",
  },
];

export default function EuAiActPage() {
  return (
    <div className="bp-page">
      <Header variant="full" actief="/governance-ai" />

      {/* HERO — Sectie 1 */}
      <section className="phero">
        <div className="grid-bg" />
        <div className="wrap">
          <Crumb
            items={[
              { label: "Governance & AI", href: "/governance-ai" },
              { label: "EU AI Act" },
            ]}
          />
          <h1>EU AI Act &amp; verantwoord AI-gebruik</h1>
          <p className="sub">
            <strong>Van losse AI-chat naar beheerste AI-governance.</strong> De EU
            AI Act vergroot de noodzaak om zorgvuldig met AI om te gaan.
            Bestuurdersportaal helpt AI-gebruik in de bestuurspraktijk brongebonden,
            controleerbaar en bestuurlijk uitlegbaar te maken — met het oordeel altijd
            bij het bestuur.
          </p>
          <div className="cta">
            <a href="/contact" className="btn btn-primary">
              Bespreek verantwoord AI-gebruik
            </a>
            <a href="/governance-ai" className="btn btn-outline">
              Bekijk hoe governance werkt
            </a>
          </div>
        </div>
      </section>

      {/* WAAROM DIT UW BESTUUR RAAKT — Sectie 2 */}
      <section>
        <div className="wrap">
          <div className="label">Waarom dit uw bestuur raakt</div>
          <h2>Besturen zijn aanspreekbaar op hóe AI is gebruikt.</h2>
          <p className="lede">
            AI is snel onderdeel geworden van hoe stukken worden voorbereid en
            afwegingen worden gemaakt. Tegelijk groeit de verwachting dat besturen
            kunnen uitleggen hoe AI is ingezet — richting toezicht,
            verantwoordingsorganen en interne governance. De EU AI Act vergroot die
            urgentie.
          </p>
          <p className="lede">
            Voor pensioenfondsbesturen ligt de nadruk meestal niet op het ontwikkelen
            van AI-modellen, maar op verantwoord gebruik, inrichting, toezicht en
            verantwoording van AI binnen de bestuurspraktijk.
          </p>
          <div className="principles">
            {["Mogen wij dit?", "Hoe leggen we het uit?", "Wie is verantwoordelijk?"].map(
              (vraag) => (
                <div key={vraag} className="pr">
                  <span className="n" aria-hidden="true">
                    ?
                  </span>
                  <div>
                    <h3>{vraag}</h3>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      </section>

      {/* WAT DE EU AI ACT OP HOOFDLIJNEN VRAAGT — Sectie 3 */}
      <section>
        <div className="wrap">
          <div className="label">Op hoofdlijnen</div>
          <h2>Wat de EU AI Act op hoofdlijnen vraagt.</h2>
          <p className="lede">
            De EU AI Act geeft de kaders voor verantwoord AI-gebruik. Op hoofdlijnen:
          </p>
          <div className="principles">
            {HOOFDLIJNEN.map((t, i) => (
              <div key={i} className="pr">
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p>{t}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="lede">
            De toepassing is gefaseerd en risicogebaseerd. Bestuurdersportaal geeft
            geen juridisch advies; we helpen u de randvoorwaarden voor verantwoord
            AI-gebruik praktisch in te richten.
          </p>
        </div>
      </section>

      {/* GEEN LOSSE AI-CHAT — Sectie 4 */}
      <section>
        <div className="wrap">
          <div className="label">Het onderscheid</div>
          <h2>Geen losse AI-chat, maar beheerste AI-governance.</h2>
          <p className="lede">
            Een generieke AI-chat geeft antwoorden zonder herkomst, zonder
            rol-scheiding en zonder spoor. Voor bestuurlijke besluitvorming is dat
            onvoldoende.
          </p>
          <div className="cmp">
            <table>
              <thead>
                <tr>
                  <th scope="col">Generieke AI-chat</th>
                  <th scope="col">AI binnen Bestuurdersportaal</th>
                </tr>
              </thead>
              <tbody>
                {VERGELIJK.map((r, i) => (
                  <tr key={i}>
                    <td data-label="Generieke AI-chat">{r.chat}</td>
                    <td data-label="AI binnen Bestuurdersportaal">{r.portaal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* HOE BESTUURDERSPORTAAL ONDERSTEUNT — Sectie 5 */}
      <section>
        <div className="wrap">
          <div className="label">Ondersteuning in de praktijk</div>
          <h2>Hoe Bestuurdersportaal verantwoord AI-gebruik ondersteunt.</h2>
          <div className="principles">
            {ONDERSTEUNING.map((p, i) => (
              <div key={p.titel} className="pr">
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{p.titel}</h3>
                  <p>{p.tekst}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* VAN GOVERNANCE-THEMA NAAR PRAKTIJK — Sectie 6 */}
      <section>
        <div className="wrap">
          <div className="label">Van thema naar praktijk</div>
          <h2>Van governance-thema naar praktijk.</h2>
          <div className="cmp">
            <table>
              <thead>
                <tr>
                  <th scope="col">Governance-thema</th>
                  <th scope="col">Hoe dit in de bestuurspraktijk terugkomt</th>
                </tr>
              </thead>
              <tbody>
                {PRAKTIJK.map((r) => (
                  <tr key={r.thema}>
                    <th scope="row">{r.thema}</th>
                    <td data-label="Hoe dit in de bestuurspraktijk terugkomt">
                      {r.praktijk}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA — Sectie 7 */}
      <CtaBand
        kop="Bespreek verantwoord AI-gebruik in uw bestuur"
        tekst="Benieuwd hoe verantwoord AI-gebruik er in uw bestuurspraktijk uitziet? Neem contact op voor een verkennend gesprek."
        primair={{ href: "/contact", label: "Neem contact op" }}
      />

      <Footer variant="full" />
    </div>
  );
}
