# MVP-demoscript — Bestuurdersportaal

**Laatst bijgewerkt:** 2026-07-04
**Doel:** eerlijk, stapsgewijs demoscript langs de wérkende functionaliteit. Per stap: wat tonen, wat zeggen, en wat níét tonen of beloven. Doelgroep: mede-initiatiefnemers, potentiële klantfondsen, reviewers.
**Vooraf regelen:** werkende login op het demo-fonds (*Stichting Pensioenfonds Horizon*); minimaal één recent geüpload en geïndexeerd document; een geplande vergadering met agendapunt; een lopende procedure/Decision Object. Duur: 30–45 minuten.

**Gouden regel:** benoem bij elke stap dat dit een MVP is — demonstreerbaar, niet productiegeschikt. Overdrijf niets; alle stuurcijfers in het Klantbeeld/dashboard zijn dummydata en dat zeggen we ook.

## Stap 1 — Login en dashboard

- **Tonen:** inloggen op de app-host; persoonlijke homepage met notificaties en dashboard.
- **Zeggen:** "Beveiligde omgeving per fonds: alle data is via row-level security aan het fonds gebonden. Wat u hier aan Wtp-cijfers ziet is bewust demo-data."
- **Niet tonen/beloven:** geen MFA-claim voor bestuurders (MFA geldt alleen voor de platform-back-office); geen echte deelnemercijfers; geen SSO.

## Stap 2 — Bibliotheek en upload

- **Tonen:** documentbibliotheek; upload van een PDF of DOCX; documentstatus/metadata; laten zien dat het document na verwerking doorzoekbaar is.
- **Zeggen:** "PDF, Word, Excel en PowerPoint worden geëxtraheerd, in stukken geknipt en geïndexeerd voor de AI-assistent. Bestandsvalidatie en een uploadlimiet van 25 MB zitten erop; elke metadata-wijziging wordt gelogd."
- **Niet tonen/beloven:** geen gescande (beeld-only) PDF uploaden in deze route — die wordt geweigerd (OCR zit alleen op het beheer-/her-extractpad); **geen malwarescan beloven** (staat bewust als overgeslagen stap); grote bestanden geven 5–20 seconden wachttijd (synchrone samenvatting).

## Stap 3 — AI-assistent met bronverwijzing

- **Tonen:** stel een inhoudelijke vraag over het zojuist geüploade of een bestaand fondsdocument (bijv. "Wat zegt ons beleggingsplan over renterisico?"). Toon het antwoord, de bronvermelding en het onderbouwingspaneel; klik een bron open. Toon eventueel document-scope (@-mention) en een transformatie ("vat samen voor de agenda").
- **Zeggen:** "De assistent antwoordt uitsluitend op basis van fondsdocumenten en een gecureerde generieke bibliotheek, met herleidbare bronnen. Elke interactie wordt gelogd in het governance-log — dat laten we zo zien."
- **Niet tonen/beloven:** **geen actuele-webinformatie-vragen** (web-retrieval is niet gebouwd; besluit hierover staat open); geen garanties op foutloosheid — benoem dat menselijke toetsing het uitgangspunt is; prompt-injection-mitigatie staat nog open, dus geen "AI-veiligheid is af"-claim.

## Stap 4 — Vergadering en agendapunt

- **Tonen:** vergaderkalender; een vergadering met agendapunten en gekoppelde stukken; de AI-voorbereiding per agendapunt (privé); "Vraag de AI over dit agendapunt".
- **Zeggen:** "Per agendapunt kan een bestuurder zich privé laten voorbereiden op basis van de stukken en het eigen profiel; de toelichting van het agendapunt gaat als gelabelde context mee."
- **Niet tonen/beloven:** geen Teams-/agenda-integratie (alleen ontworpen); geen versioning van vergaderstukken; geen e-mailuitnodigingen.

## Stap 5 — Stemming

- **Tonen:** een stemronde bij een agendapunt; stem uitbrengen; eventueel volmacht.
- **Zeggen:** "Stemmen inclusief volmachten worden vastgelegd en gerapporteerd."
- **Niet tonen/beloven:** het systeem **stelt geen rechtsgeldigheid vast** — het registreert en rapporteert; statutaire toetsing blijft aan het bestuur.

## Stap 6 — Procedure / Decision Object (kern van de demo)

- **Tonen:** een lopende procedure; de statusmachine (readiness-ladder, statusovergangen), aannames/dissent/acties; de auditdossier-export (HTML) openen en het hash-gebaseerde, append-only auditspoor benoemen.
- **Zeggen:** "Dit is governance-by-design: elk besluit doorloopt een controleerbaar proces met 17 statussen, verplichte onderbouwing en een onwijzigbaar auditlog met hash per gebeurtenis. Het volledige dossier is exporteerbaar voor toezichthouder of accountant."
- **Niet tonen/beloven:** geen decision rights/escalatie/scenario's (Plateau 3 — ambitie); nieuwe proceduretemplates vergen nu nog een code-wijziging.

## Stap 7 — Risicomatrix

- **Tonen:** risico-overzicht, een risico met maatregelen; wijzigingslog.
- **Zeggen:** "Risico's en maatregelen met auditlog; koppeling met procedures is voorzien."
- **Niet tonen/beloven:** bewerken van kans/impact zit in een volgende iteratie; geen automatische risicoscoring.

## Stap 8 — Beheer

- **Tonen:** gebruikersbeheer, procescatalogus en organen (import van standaardlijsten).
- **Zeggen:** "Fondsbeheer: rollen (beheerder/voorzitter/bestuurder), catalogus als data — configureerbaar zonder deploy."
- **Niet tonen/beloven:** rolgebaseerde zichtbaarheid in de navigatie is cosmetisch — de echte autorisatie zit server-side (dat is een pluspunt, benoem het zo); geen self-service tenant-aanmaak.

## Stap 9 (optioneel) — Platform-back-office

- **Tonen:** apart inloggen op de beheer-surface met MFA; generieke bibliotheek/curatie (incl. OCR); contact-inbox; het twee-fasen auditlog.
- **Zeggen:** "De platformlaag staat volledig los van de fondsomgevingen: eigen identiteiten, verplichte MFA, en elk handelen wordt vooraf én achteraf hash-geketend gelogd. Generieke bronnen (wetgeving, toezichtdocumenten) worden hier gecureerd en zijn read-only voor fondsen."
- **Niet tonen/beloven:** zware handelingen (identiteiten aanmaken, tenantbeheer) lopen bewust nog via gecontroleerde SQL-bootstrap, niet via de UI; vier-ogen-principe komt vóór productie.

## Afsluiting — verwachtingen zetten

Benoem expliciet, zonder ernaar gevraagd te worden:

1. Dit is een **MVP**: werkend en demonstreerbaar, niet productiegeschikt.
2. Open punten vóór een pilot: afronding security-hardening (malwarescan, CSRF, prompt-injection, eindverificatie), geautomatiseerde tests/CI, e-maildomein, compliance-dossier (DPA's, DPIA, bewaartermijnen).
3. Klantbeeld/stuurcijfers zijn dummy tot er een datakoppeling met de uitvoerder is.
4. Web-bronnen (DNB/AFM live) zijn een openstaand besluit, geen feature.

Volledige lijst: `mvp-beperkingen.md`.
