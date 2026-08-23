// ============================================================================
//  H-04 — herkomst van een navigatie beoordelen (bevinding uit de API-review).
// ----------------------------------------------------------------------------
//  HET PROBLEEM
//  Vier GET-routes schrijven een auditrecord. Onder een `Lax`-sessiecookie
//  stuurt een TOP-LEVEL NAVIGATIE de sessie mee, dus een `<img src="…">`, een
//  link in een e-mail of een redirect vanaf een vreemde site laat de browser van
//  een ingelogde bestuurder zo'n GET doen. Er ontstaat dan een inzage- of
//  downloadspoor dat die bestuurder nooit heeft veroorzaakt.
//
//  Er lekt geen data naar de aanvaller: de respons is voor hem niet leesbaar en
//  RLS blijft gelden. Wat lekt is de omgekeerde richting — hij kan een
//  GEBEURTENIS in het dossier van het slachtoffer schrijven. En dat spoor is
//  hier geen ruis maar bewijs: `document_inzage` is de enige registratie van wie
//  welk document inzag, en `procedure_log` en `governance_events` voeden het
//  auditdossier. Een vervuild spoor is duurder dan een leeg spoor.
//
//  DE KEUZE (BESLUIT 23-08-2026)
//  Beoordelen op `Sec-Fetch-Site` — de header die de browser zelf zet en die
//  een pagina niet kan vervalsen. Drie andere richtingen zijn overwogen en
//  afgewezen: het schrijfeffect naar POST verplaatsen (zuiverst, maar de
//  afschrift-download is een 307 naar een signed URL en verzet zich daartegen),
//  `SameSite=Strict` op de sessiecookie (lost de hele categorie op, maar breekt
//  elke inkomende deeplink uit e-mail), en niets doen.
//
//  VIER UITKOMSTEN, en de derde is waar het interessant wordt:
//
//    same-origin / same-site  → het eigen vlak. Normaal verwerken.
//    none                     → de gebruiker navigeerde zélf (getypt adres,
//                               bladwijzer). Een aanvallerspagina kan deze
//                               waarde niet produceren. Normaal verwerken.
//    cross-site               → precies de vorm die H-04 beschrijft. WEIGEREN,
//                               en niets schrijven.
//    header ontbreekt         → niet te beoordelen. Wél verwerken en wél
//                               schrijven, maar het record draagt
//                               `herkomst: "niet_verifieerbaar"`.
//
//  WAAROM DE LAATSTE NIET FAIL-CLOSED IS. Fail-closed zou hier betekenen: een
//  bestuurder op een oudere browser kan geen document meer openen. Safari stuurt
//  `Sec-Fetch-Site` pas sinds 16.4 (2023). De prijs van die strengheid valt op
//  legitieme gebruikers, terwijl de winst nihil is: een aanvaller kan de header
//  niet weglaten — de browser zet hem, niet de pagina.
//
//  De prijs die we WEL betalen is dat zo'n record minder zeker is. Daarom staat
//  dat IN het record en niet in een comment: het auditspoor doet dan geen
//  bewering die het niet kan waarmaken. Een lezer van het dossier ziet het
//  verschil tussen "dit is gecontroleerd eigen verkeer" en "dit kon ik niet
//  vaststellen", in plaats van beide als hetzelfde te lezen.
// ============================================================================

/** Wat we over de herkomst van deze aanroep kunnen vaststellen. Gaat mee in het
 *  auditrecord — als WAARDE, zodat "niet vastgesteld" en "eigen vlak" niet op
 *  elkaar lijken. */
export type Herkomst = "eigen_surface" | "directe_navigatie" | "niet_verifieerbaar";

export type HerkomstOordeel =
  | { readonly toegestaan: true; readonly herkomst: Herkomst }
  | { readonly toegestaan: false; readonly reden: "cross-site" };

/** De letterlijke waarden uit de Fetch Metadata-spec. Alles wat hier niet in
 *  staat — inclusief een ontbrekende header — telt als niet te beoordelen. */
const EIGEN_VLAK = new Set(["same-origin", "same-site"]);

/**
 * Beoordeelt of deze aanroep vanaf een vreemde site is gestart.
 *
 * Leest uitsluitend `Sec-Fetch-Site`. Bewust NIET `Referer`: die is door de
 * verwijzende pagina te onderdrukken en zegt dus niets als hij ontbreekt.
 * `Sec-Fetch-Site` wordt door de browser gezet en is niet door de pagina te
 * beïnvloeden — dat verschil is de hele waarde van deze controle.
 */
export function beoordeelNavigatieHerkomst(req: Request): HerkomstOordeel {
  const site = req.headers.get("sec-fetch-site");

  if (site === "cross-site") {
    return { toegestaan: false, reden: "cross-site" };
  }
  if (site !== null && EIGEN_VLAK.has(site)) {
    return { toegestaan: true, herkomst: "eigen_surface" };
  }
  if (site === "none") {
    return { toegestaan: true, herkomst: "directe_navigatie" };
  }
  // Ontbrekend of onbekend (een toekomstige waarde uit de spec valt hier ook
  // in). Doorlaten, maar het record draagt de onzekerheid.
  return { toegestaan: true, herkomst: "niet_verifieerbaar" };
}

/** Antwoord op een geweigerde cross-site-aanroep.
 *
 *  403 en niet 401: de sessie is geldig, de HERKOMST is het bezwaar. Het bericht
 *  is voor een mens die per ongeluk op zo'n link klikt; het geeft een aanvaller
 *  niets wat hij niet al wist, want hij kán de respons niet lezen. */
export function crossSiteGeweigerd(label: string): Response {
  // Wél loggen, NIET in het auditspoor. Een geweigerde poging is interessant
  // voor wie de logs leest, maar hem in governance_events of document_inzage
  // zetten zou precies doen wat deze maatregel voorkomt: de aanvaller een regel
  // laten schrijven in het dossier van het slachtoffer.
  console.warn(`[${label}] cross-site navigatie geweigerd (H-04)`);
  return Response.json(
    {
      error:
        "Deze actie kan niet vanaf een andere website worden gestart. Open het item opnieuw vanuit het portaal.",
    },
    { status: 403 }
  );
}
