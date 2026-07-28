# AI-startpunt — Ontwerpdocument

> **Status**: Revisie 1.0 — P1 gebouwd (2026-07-28)
> **Datum**: 2026-07-28
> **Scope**: het startscherm van `/ai` en de doorgroei naar een taakgerichte assistent, opgedeeld in vijf los uitleverbare plateaus (P1–P5).
> **Doel**: vastleggen wat P1 oplevert en waar de vervolgstappen landen, zodat elk plateau een eigen plek en afbakening heeft. Bron van waarheid blijft de code + `supabase/migrations/`; dit document beschrijft het *wat en waarom*.
> **Visuele referentie**: de werkopdracht noemt `03 Functioneel ontwerp/Designrichtingen portaal/startpunt-flow.html` (schermen: Startpunt · Scherpstellen · Aan het werk · Resultaat · Mijn voorbereidingen). **Dat bestand staat (nog) niet in de repo** — de map bevat wel `richting-a/b/c`, `prototype-c-cockpit` en `voortgangsmelding`. P1 is daarom gebouwd op de tekstuele spec uit de werkopdracht + de bestaande tokenlaag; lever `startpunt-flow.html` aan om deze referentie hard te maken. *Let op* (indien geleverd): het demofonds heet in die preview "Vitalis"; het echte demofonds is **Stichting Pensioenfonds Horizon**, en namen/cijfers zijn illustratief.

---

## Probleemstelling

`/ai` opende met een leeg invoerveld en vier statische voorbeeldvragen. Voor een bestuurder die het portaal een paar keer per maand opent, is dat het minst behulpzame startpunt: hij moet zelf bedenken wat hij kan vragen. Tegelijk staat de rijkste AI-functionaliteit (de agendavoorbereiding met bestuurlijke duiding en drie kritische vragen) alleen op de vergaderpagina.

Dit is een **vindbaarheidsprobleem**, geen functionaliteitsgat. De assistent moet zich taakgericht presenteren en doorverwijzen naar wat er al is — zonder nieuwe AI-aanroepen, prompts of antwoordmodi.

---

## Plateau-indeling (P1–P5)

Elk plateau is los uitleverbaar en bouwt op het vorige. De grens tussen "routeren naar bestaande functionaliteit" (P1) en "nieuwe interactie/AI-gedrag" (P3–P5) is bewust scherp: P1 voegt géén AI-logica toe.

### P1 — Startpunt: een ingang in plaats van een leeg invoerveld *(gebouwd — besluit 0085)*

**Scherm**: "Startpunt". Vervangt de lege staat op `/ai` (de oude `VOORGESTELDE_VRAGEN`-chips).

- **Blok "Speelt nu voor u"** — max drie server-afgeleide contextkaarten, lege weggelaten:
  - eerstvolgende vergadering, met het aantal agendapunten waarop de ingelogde gebruiker **zelf** nog geen inbreng plaatste;
  - de eerstvolgende actieve processtap waarvan de gebruiker (mede-)eigenaar is;
  - het meest recent toegevoegde, actieve document uit de **fondsbibliotheek** (niet generiek).
- **Blok "Wat wilt u doen"** — drie taakknoppen die routeren of scope zetten, zonder nieuwe AI-logica:
  - *Een agendapunt voorbereiden* → deeplink `/vergaderingen/{vergaderingId}#agendapunt-{agendapuntId}` (bestaand anker in `AgendapuntKaart.tsx`); de voorbereiding zelf start de gebruiker daar met de bestaande startchip in `VoorbereidingsBlok`.
  - *Een vraag over een document* → opent de bestaande chat met een vooraf gezette `document_scope` (bestaand mechanisme).
  - *Een vrije vraag stellen* → zet de cursor in het (altijd zichtbare) invoerveld; de chat blijft ongewijzigd.

Zodra er een bericht, een documentscope of een agendapunt-scope is, verdwijnt het startscherm en gedraagt `/ai` zich exact zoals voorheen (modi, bronselectie, @-mentions, verduidelijkingsvragen, onderbouwingspaneel).

**Architectuur**: `app/(dashboard)/ai/page.tsx` is een server-component (route A) die de sessie server-side afleidt, de gedeelde context ophaalt (`core/lib/portaalcontext.ts`, `React.cache()`-gededupliceerd, gedeeld met de homepage) en de mechanisch verhuisde client-component `_components/AssistentClient.tsx` rendert met een `_components/Startpunt.tsx`. Een `loading.tsx`-skelet dekt de eerste weergave. Geen migratie, geen RLS-/API-contractwijziging.

**Bewust buiten P1**: geen taakconfiguratie, geen bewaren/koppelen, geen voortgangsstappen, geen nieuwe/heropende antwoordmodi (`besluitrijpheid`/`persoonlijke_voorbereiding` blijven zonder knop — besluit 0068), geen tweede implementatie van de voorbereiding (besluiten 0036/0079).

### P2 — Mijn voorbereidingen: bewaren & koppelen

**Scherm**: "Mijn voorbereidingen". Een voorbereiding wordt bewaarbaar en koppelbaar aan het agendapunt/de vergadering, zodat de bestuurder later terugvindt wat hij voorbereidde. Vereist een datamodel-/RLS-ontwerp (privé per gebruiker, append-only auditlijn) en valt daarom nadrukkelijk buiten P1.

### P3 — Scherpstellen: taakconfiguratie vóór een voorbereiding

**Scherm**: "Scherpstellen". Een configuratiestap waarin de gebruiker stukken selecteert, secties kiest en de uitgebreidheid instelt vóórdat de voorbereiding start. Dit is de eerste nieuwe interactielaag; raakt de retrieval-scope en de bestaande voorbereidingsprompt.

### P4 — Antwoordmodi opnieuw zichtbaar

Besluit 0068 bracht de zichtbare antwoordmodi terug tot Auto · Feiten · Duiding · Sparren. `besluitrijpheid` en `persoonlijke_voorbereiding` bestaan als interne modus maar hebben geen knop. Ze in de UI terugbrengen is een bewuste afwijking van 0068 en **vergt een eigen besluit** — vandaar een apart plateau.

### P5 — Aan het werk / Resultaat: voortgang met benoemde stappen

**Schermen**: "Aan het werk" en "Resultaat". Een voortgangsweergave met benoemde stappen tijdens het genereren, plus een gestructureerde resultaatweergave. Bouwt op P3 (configuratie) en P2 (bewaren).

---

## Guardrails (gelden voor elk plateau)

- **RLS per `fonds_id`** via de anon-key; fonds altijd uit de sessie, nooit uit de URL/body.
- **Privacy van voorbereidingen/inbreng**: privé per gebruiker; een startscherm/overzicht toont nooit dat of wat een ánder bestuurslid voorbereidde. Tellingen als "zonder inbreng" tellen uitsluitend de eigen inbreng.
- **Human-in-the-loop + append-only audit**: elke AI-interactie blijft herleidbaar; nieuwe AI-paden krijgen prompt-/output-logging en een validatiestatus. P1 voegt géén AI-pad toe en dus géén `governance_event`.
- **Snapshot-integriteit** voor lopende procedures.
- **Eén bron voor context**: homepage en startpunt delen `core/lib/portaalcontext.ts`.
- **Tokenlaag**: uitsluitend bestaande tokens (`lint:colors` groen).

---

## Referenties

- Besluit **0085** — AI-startpunt P1 (dit plateau; twee besluitpunten: startpunt vervangt leeg invoerveld, en `/ai` routeert uitsluitend naar de bestaande voorbereiding).
- Besluiten **0036** / **0079** — duplicatieschuld van de voorbereiding (geaccepteerd resp. opgeruimd); P1 houdt de "alleen routeren"-lijn vast.
- Besluit **0068** — zichtbare antwoordmodi teruggebracht (raakt P4).
- Code: `core/lib/portaalcontext.ts`, `core/lib/portaalcontext-afleiding.ts`, `app/(dashboard)/ai/page.tsx`, `app/(dashboard)/ai/_components/{AssistentClient,Startpunt}.tsx`, `app/(dashboard)/ai/loading.tsx`, `app/(dashboard)/page.tsx`.
