# AI-assistent — verbeterpunten bij opsteltaken (memo/notitie/document)

> Vastgelegd 2026-08-09 (plansessie Cowork) zodat de punten niet wegzakken. Nog niet als werkopdracht uitgewerkt; twee scoping-keuzes staan open (zie onderaan).

## Punt 1 — Register/anti-affirmatie bij opsteltaken

**Constatering.** Vraag je de assistent "stel een memo op", dan verschijnt in de memotekst "Uw signaal is terecht om nader te onderzoeken" — de assistent valideert en adresseert de opdrachtgever ín het document.

**Oorzaak (geverifieerd, `core/lib/generatie-kern.ts`).** De standaard-toon voor de bestuurder-stand (`TOON_BLOK`, regel 57) instrueert "u bent geen rapport-generator, u bent een gesprekspartner. Schrijf alsof u tegenover deze bestuurder zit" + u-vorm + endorse't openers als "Goede vraag...". Bij een documentvraag springt alleen de "koppen-mogen"-clausule aan; het register blijft dat van een gesprekspartner. Het juiste opsteller-register bestaat al (`TOON_BLOK_BUREAU`, regel 112) maar is gated aan de bureau-stand.

**Fix.**
1. Detecteer een **opsteltaak** (memo/notitie/oplegger/brief/concept/voorstel opstellen/schrijven/maken) als pure heuristiek in `vraagtype.ts` (klasse D).
2. Wissel dan van register: niet de gesprekspartner-`TOON_BLOK`, maar een **opsteller-register** (nieuw, gepind blok — `TOON_BLOK` is nulgrens G23, dus niet muteren; selecteren zoals `bureauToon ? TOON_BLOK_BUREAU : TOON_BLOK`). Ontsluit géén nieuwe bevoegdheid; corrigeert alleen de toon.
3. **Anti-affirmatie/adressering-regel:** het document richt zich tot de beoogde lezer (het bestuur), niet tot de opdrachtgever; geen "uw signaal is terecht"/"goede vraag"/"terecht dat u..."; begin met de probleemstelling/conclusie. Pas deze regel óók toe op het transformatie-pad (`SP_TRANSFORMATIE_REGELS`, "herschrijf dit als memo").
4. **Eval-fixture:** de partnerbegrip-memo als regressiecase die faalt bij requester-validatie in de body. Detectie = D; de tekstregel = M (geen compliance-guardrail, dus M mét eval verdedigbaar).

## Punt 2 — Opmaak van de gegenereerde Word-export

**Constatering.** De uit de chat gegenereerde memo (`.docx`) ziet er kaal uit.

**Oorzaak (geverifieerd).** Twee exportpaden zijn uit elkaar gelopen. De **afschrift/bundel-export** (`core/lib/afschrift-docx.ts`, T6) kreeg de designbehandeling: accentkleur `ACCENT="1F3A5F"` op Titel + Heading 1, ondertitel-stijl, kop/voet-stijl (`KopVoet`), gestileerde kaderblokken (`pBdr` + fill `F4F6F9`), bodygrootte `sz=21`. De **chat-antwoord → Word-export** (`core/lib/antwoord-docx.ts`, T2 — het pad dat de memo maakte) bleef de kale versie: geen kleur, geen ondertitel/meta-stijl, geen kop/voet. Verder:
- **Geen lettertype in béíde paden** (geen theme-part, geen `rFonts`/`docDefaults`) → Word valt terug op zijn default; grootste "generieke" factor.
- **Nep-lijsten** in `antwoord-docx` (`blokNaarXml`, regel 95-103): letterlijke prefixes `• `/`1. ` zonder `numbering.xml` → geen hangende inspring, genummerde lijsten hernummeren niet.
- **Markdown-blockquote `>` lekt** als letterlijke tekst; de parser (`antwoord-parser.ts`) kent geen quote-blok (Blok-union = alinea/kop/lijst/tabel).

**Fix (geïsoleerd, puur, golden-getest — tests bewegen mee).**
1. Geef `antwoord-docx` de afschrift-stijlen: accentkleur op Titel/Heading 1, expliciete bodygrootte, een meta/ondertitel-stijl voor het Aan/Van/Betreft-blok.
2. Zet in `docx-primitieven.ts` één huisstijl-sans via `docDefaults` (`rFonts`) zodat **beide** exports meeliften. `ACCENT` is nu een placeholder (`1F3A5F`, "config-inhaakplek T5-A6") — koppel aan de portal-accentkleur.
3. Repareer de blockquote in de parser (quote-blok toevoegen, of het `>`-teken strippen).
4. Optioneel: echte lijsten via een `numbering.xml`-part (hangende inspring + auto-nummering); optioneel paginanummer-voet.

## Openstaande scoping-keuzes (vóór uitwerking tot werkopdracht)

1. Anti-affirmatie **alleen bij opsteltaken**, of *breed* uit de assistent (ook gewone antwoorden — grotere toon-ingreep, risico op kilheid)?
2. Een **eigen opsteller-toonblok** voor de bestuurder-stand, of de bestaande bureau-toon hergebruiken (dan bureau-*bevoegdheden* los houden van de *toon*)?
3. Word-opmaak: alléén `antwoord-docx` optrekken naar afschrift-niveau, of meteen één gedeelde stijllaag voor beide exports (consistenter, iets meer werk)?
