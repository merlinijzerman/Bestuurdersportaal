## Werkopdracht: AI-startpunt plateau 1 — ingang in plaats van leeg invoerveld

**Doel & context** — De AI-assistent opent nu met een leeg invoerveld en vier statische voorbeeldvragen. Voor een bestuurder die het portaal een paar keer per maand opent, is dat het minst behulpzame startpunt dat er is: hij moet zelf bedenken wat hij kan vragen. Tegelijk staat de rijkste AI-functionaliteit die het portaal heeft — de agendavoorbereiding met bestuurlijke duiding, aandachtspunten en drie kritische vragen — **alleen op de vergaderpagina**, waar je hem moet weten te vinden.

Dit plateau lost een **vindbaarheidsprobleem** op, geen functionaliteitsgat. `/ai` krijgt een startscherm dat toont wat er nu speelt en dat doorverwijst naar bestaande functionaliteit. Er wordt geen enkele nieuwe AI-aanroep, prompt of antwoordmodus toegevoegd.

**Goedgekeurd ontwerp/plan** — Visuele referentie: `03 Functioneel ontwerp/Designrichtingen portaal/startpunt-flow.html`, **uitsluitend het eerste scherm** ("Startpunt"). De schermen Scherpstellen, Aan het werk, Resultaat en Mijn voorbereidingen uit die preview horen bij latere plateaus en vallen expliciet buiten deze opdracht. Stel als onderdeel van deze opdracht een kort `AI-STARTPUNT-ONTWERP.md` op dat de plateau-indeling (P1 t/m P5) vastlegt, zodat vervolgstappen een plek hebben.

> **Let op bij het lezen van de preview:** het demofonds heet daar "Stichting Pensioenfonds Vitalis". Het echte demofonds is **Stichting Pensioenfonds Horizon**. Namen, cijfers en het aantal taken in de preview zijn illustratief, niet leidend.

---

### Scope

**Wel**

1. **Startscherm op `/ai`** — vervangt de huidige lege staat (de `VOORGESTELDE_VRAGEN`-chips die verschijnen bij `berichten.length <= 1`). Zodra er een gesprek loopt, verdwijnt het startscherm en gedraagt `/ai` zich precies zoals nu.
2. **Blok "Speelt nu voor u"** — maximaal drie contextkaarten, server-side afgeleid:
   - eerstvolgende vergadering, met het aantal agendapunten waarop de **ingelogde gebruiker zelf** nog geen inbreng heeft geplaatst;
   - de eerstvolgende actieve procedurestap waarvan de gebruiker (mede-)eigenaar is;
   - het meest recent toegevoegde document uit de bibliotheek.
   Kaarten zonder inhoud worden weggelaten, niet leeg getoond.
3. **Blok "Wat wilt u doen"** — drie taakknoppen die **routeren of scope zetten**, zonder nieuwe AI-logica:
   - *Een agendapunt voorbereiden* → deeplink naar `/vergaderingen/{vergaderingId}#agendapunt-{agendapuntId}`; het anker bestaat al (`AgendapuntKaart.tsx`, `id={`agendapunt-${punt.id}`}`). De voorbereiding zelf start de gebruiker daar met de bestaande startchip in `VoorbereidingsBlok`.
   - *Een vraag over een document* → opent de bestaande chat met een vooraf gezette `document_scope` op het gekozen document (bestaand mechanisme).
   - *Een vrije vraag stellen* → opent de bestaande chat, ongewijzigd.
4. **Gedeelde contexthelper** — de queries voor de contextkaarten worden geëxtraheerd uit `app/(dashboard)/page.tsx` naar één herbruikbare server-helper (bijvoorbeeld `core/lib/portaalcontext.ts`), zodat de homepage en het startpunt dezelfde bron gebruiken. De homepage blijft functioneel identiek.
5. **Auto-restore begrenzen tot de browsersessie** — zie §"Wanneer verschijnt het startpunt" hieronder. Zonder deze wijziging is het startscherm in de praktijk onbereikbaar.
6. **Ontwerpdocument + besluitregistratie** — zie Definition of Done.

**Niet**

- **Geen nieuwe AI-functionaliteit.** Geen nieuwe prompts, geen nieuwe route naast `/api/chat` of `/api/agendapunten/[id]/voorbereiding`, geen wijziging aan bestaande systeemprompts. De AI-toon-systeemprompt blijft onaangeroerd (`CLAUDE.md`).
- **Geen taakconfiguratiescherm** (stukkenselectie, secties, uitgebreidheid) — dat is plateau 3.
- **Geen bewaren of koppelen van voorbereidingen** — plateau 2.
- **Geen voortgangsweergave met benoemde stappen** — plateau 5.
- **Geen nieuwe of opnieuw zichtbaar gemaakte antwoordmodi.** In het bijzonder: `besluitrijpheid` en `persoonlijke_voorbereiding` bestaan als interne modus maar krijgen hier géén knop. Besluit `0068` heeft de zichtbare modi juist teruggebracht; daarvan afwijken vergt een eigen besluit (voorzien in plateau 4).
- **Geen tweede implementatie van de voorbereiding.** Het startpunt routeert naar de bestaande component; er komt geen gekopieerde variant bij. Besluiten `0036` en `0079` hebben die duplicatie net opgelost.
- Geen wijziging aan RLS-policies, datamodel, migraties, governance-logging of API-contracten.

---

### Wanneer verschijnt het startpunt

`AssistentClient.tsx` doet bij elke mount een **auto-restore** (Fase B2, comment rond regel 421): het haalt het meest recente niet-gearchiveerde gesprek op en zet dat terug, inclusief scope en antwoordmodus. Die query kijkt alleen naar `bijgewerkt`, niet naar sessie of tijd. Gevolg: wie vorige maand een vraag stelde, landt vandaag ná inloggen weer in dat oude gesprek — en ziet het startscherm nooit.

**Gewenst gedrag:**

| Situatie | Wat er gebeurt |
|---|---|
| Opnieuw inloggen | Startpunt — schoon gesprek |
| Nieuw browsertabblad | Startpunt |
| Binnen dezelfde sessie weg van `/ai` en terug (bijvoorbeeld via een brondocument) | Lopende gesprek blijft staan |
| Gesprek kiezen uit de gesprekken-lade | Dat gesprek wordt geladen, zoals nu |

**Uitvoering** — houd het actieve gesprek bij in `sessionStorage` in plaats van het uit de database af te leiden, en wis die markering expliciet in de uitlogfunctie in `core/components/Sidebar.tsx`. Bij mount wordt alleen hersteld als er een markering uit deze browsersessie is. Geen serverstate, geen nieuwe tabel, geen RLS- of auditgevolg.

**Belangrijk om te benoemen:** gesprekken worden hiermee **niet minder bewaard**. Fase B2 blijft intact — alle gesprekken staan in de gesprekken-lade en zijn met één klik terug te halen. Alleen het *automatisch terugzetten* vervalt. Neem dat expliciet op in de besluitregistratie, zodat later niemand concludeert dat de persistentie is teruggedraaid.

---

### Architectuurpunt dat in Plan-modus beslist moet worden

`app/(dashboard)/ai/page.tsx` is een **client-component** (`"use client"`, ±66 KB). De contextkaarten vragen server-side data. Er zijn twee routes, met verschillende afruil:

- **A — server-wrapper.** De huidige client-component verhuist ongewijzigd naar `app/(dashboard)/ai/_components/AssistentClient.tsx`; `page.tsx` wordt een server-component die `vereisModuleToegang("ai", …)` doet, de context ophaalt en `<Startpunt>` of `<AssistentClient>` rendert. Schoon en snel (geen extra round-trip), maar het verplaatst een groot bestand. `CLAUDE.md` vraagt voor zo'n verplaatsing een expliciet voorstel.
- **B — API-route.** Nieuwe `app/api/startpunt/route.ts` die de client-component aanroept. Raakt `page.tsx` niet, maar geeft een extra round-trip, een tragere eerste weergave en zet de tenantcontrole in een tweede laag.

**Voorkeur: A**, mits de verplaatsing aantoonbaar puur mechanisch is (geen inhoudelijke wijziging in het verplaatste bestand, diff toont alleen het pad). Leg beide opties met de afweging voor in het implementatieplan; wijzig pas na akkoord.

---

**Relevante bestanden / modules** — `app/(dashboard)/ai/page.tsx` (startstaat; zie architectuurpunt), nieuwe `app/(dashboard)/ai/_components/Startpunt.tsx`, nieuwe `core/lib/portaalcontext.ts` (gedeelde contextqueries), `app/(dashboard)/page.tsx` (queries eruit halen, gedrag gelijk), `core/lib/fonds-sessie.ts` + `core/lib/module-gate-page.ts` (bestaande patronen voor sessie en modulegate — volgen, niet omzeilen), `app/(dashboard)/ai/_components/AssistentClient.tsx` (auto-restore begrenzen), `core/components/Sidebar.tsx` (sessiemarkering wissen bij uitloggen), `app/(dashboard)/vergaderingen/_components/AgendapuntKaart.tsx` (alleen lezen: het anker waarnaar gerouteerd wordt). Claude Code verifieert tegen de werkelijke code.

**Guardrails (zie `CLAUDE.md`)** — bevestig naleving van: RLS per `fonds_id` (alleen anon-key), append-only audit, human-in-the-loop, migratie-eerst-dan-deploy, snapshot-integriteit, geen schijnzekerheid. Specifiek voor deze opdracht:

- **Privacy van voorbereidingen.** Voorbereidingen en aantekeningen zijn **privé per gebruiker** (zie de comment in `AgendapuntKaart.tsx` en de `gesprekken`-RLS "alleen-auteur"). Het startscherm mag nooit tonen dat of wat een ánder bestuurslid heeft voorbereid. "Agendapunten zonder uw inbreng" telt uitsluitend de eigen inbreng.
- **Geen fonds uit de URL.** De contexthelper leidt het fonds af via `haalFondsSessie()` / `vereisModuleToegang()`, nooit uit een parameter of request-body.
- **Performance.** Volg het patroon uit UI-performance tranche 1: de gedeelde helper wordt met `React.cache()` per request gededupliceerd, zodat het startpunt geen extra query-waterval oplevert bovenop de layout. Voeg een `loading.tsx`-skelet toe als `/ai` er nog geen heeft.
- **`npm run lint:colors` blijft groen** — het startscherm gebruikt uitsluitend bestaande tokens. Let op de samenloop met `WERKOPDRACHT-HUISSTIJL-T1`: wordt die eerder gemerged, bouw dan op de nieuwe tokenwaarden.

**In te zetten subagents (zie `SUBAGENTS-ONTWERP.md` §4 trigger-matrix)** — `code-reviewer` (verplicht); `supabase-rls-reviewer` (de contexthelper leest vergaderingen, agendapunten, inbreng, procedurestappen en documenten over meerdere tabellen heen); `ontwerp-sync-reviewer` vóór merge (nieuw ontwerpdocument). `ai-governance-reviewer` is **niet** nodig en dat wordt expliciet vastgesteld: deze opdracht voegt geen AI-aanroep, prompt of outputpad toe. Geen migraties voorzien.

**Werkmodus** — begin in **Plan-modus**: lever eerst een implementatieplan met bestanden, de afweging A versus B uit het architectuurpunt, RLS-impact van de gedeelde contexthelper, migratie-impact (verwachting: geen), testaanpak en risico's — waaronder expliciet: hoe voorkomen wordt dat de homepage-refactor gedragsverandering introduceert. **Wijzig pas na expliciet akkoord.**

---

### Acceptatiecriteria

1. **Geen leeg invoerveld meer.** Wie `/ai` opent zonder lopend gesprek in deze browsersessie, ziet het startscherm met contextkaarten en taakknoppen. De oude `VOORGESTELDE_VRAGEN`-chips zijn vervangen, niet ernaast gezet.
2. **Opnieuw inloggen geeft een schoon gesprek.** Na uitloggen en opnieuw inloggen, en in een nieuw browsertabblad, verschijnt het startpunt — niet het laatste gesprek. Binnen dezelfde sessie blijft een lopend gesprek staan bij het verlaten en terugkeren naar `/ai`. Alle gesprekken blijven bereikbaar via de gesprekken-lade.
3. **Bestaand gedrag intact.** Zodra een gesprek loopt — nieuw of hersteld uit de gesprekshistorie — is `/ai` functioneel identiek aan vóór deze wijziging: modi, bronselectie, @-mentions, agendapunt-scope, verduidelijkingsvragen en het onderbouwingspaneel werken ongewijzigd.
4. **Routeren, niet dupliceren.** "Een agendapunt voorbereiden" brengt de gebruiker naar het bestaande agendapunt op de vergaderpagina, met het juiste agendapunt in beeld via het bestaande anker. Er is geen tweede implementatie van de voorbereiding ontstaan; `AgendapuntChat`, `VoorbereidingsBlok` en `AntwoordWeergave` zijn ongewijzigd.
5. **Context klopt of ontbreekt.** Elke getoonde kaart is aantoonbaar afgeleid uit de eigen fondsdata van de ingelogde gebruiker. Is er geen vergadering, geen actieve procedurestap of geen recent document, dan wordt die kaart weggelaten. Een gebruiker zonder enige context ziet een begrijpelijk startscherm met alleen de taakknoppen en de vrije vraag — geen lege kaders, geen foutmelding.
6. **Geen privacylek.** Het startscherm toont geen inbreng, aantekening of voorbereiding van een andere gebruiker. Verifieer dit met twee accounts binnen hetzelfde fonds.
7. **Eén bron voor de context.** De homepage en het startpunt gebruiken dezelfde helper; de homepage rendert functioneel identiek aan vóór de wijziging (zelfde blokken, zelfde tellingen, zelfde volgorde).
8. **Geen extra query-last.** Per server-render worden de gedeelde contextqueries aantoonbaar maximaal 1× uitgevoerd (verifieerbaar via tijdelijke dev-logging; logging verwijderd vóór merge). `/ai` toont binnen ~100 ms een skelet of laadindicator.
9. **Geen functionele wijziging elders.** Geen wijziging in governance-events, RLS-policies, migraties, API-contracten, antwoordmodi of de moduleregistry.
10. **Verificatie groen.** `./node_modules/.bin/tsc --noEmit --skipLibCheck`, `npm run lint:colors`, `npm run lint:boundaries`, `npm run sanity` en `bash scripts/cross-tenant-ci.sh` zijn groen. De cross-tenant-suite is hier **verplicht**: de opdracht introduceert nieuwe tenant-gescopete reads.

---

### Besluitpunten voor `decisions/`

Laatste bestaande entry is `0083`; verifieer het eerstvolgende vrije nummer (let op: `0082` ontbreekt in de reeks).

1. **Het startpunt vervangt het lege invoerveld op `/ai`.** Gevolg: de assistent presenteert zich als taakgericht in plaats van conversationeel. Benoem het geaccepteerde nadeel — de intensieve gebruiker die direct wil typen, krijgt één extra scherm tussen zich en het invoerveld. Beschrijf hoe dat is gemitigeerd (vrije vraag direct zichtbaar op het startscherm, en het startscherm verdwijnt zodra een gesprek loopt).
2. **Auto-restore wordt begrensd tot de browsersessie.** Fase B2 herstelde bij elke mount het meest recente gesprek. Leg vast dat dit vervalt bij een nieuwe sessie, dat gesprekken onverminderd bewaard blijven en via de gesprekken-lade bereikbaar zijn, en waarom dit nodig is (zonder deze wijziging is het startpunt onbereikbaar voor iedere terugkerende gebruiker). Benoem het geaccepteerde nadeel: wie zijn gesprek van gisteren wil hervatten, moet dat nu zelf uit de lade kiezen.
3. **Twee ingangen naar dezelfde agendavoorbereiding.** Vanaf nu is de voorbereiding bereikbaar via de vergaderpagina én via `/ai`. Leg vast dat `/ai` uitsluitend **routeert** en dat een tweede implementatie principieel is uitgesloten — dit is de schuld die `0036` accepteerde en `0079` heeft opgeruimd. Verwijs naar beide.

Neem in beide gevallen ook de negatieve gevolgen op, conform `decisions/TEMPLATE.md` §Gevolgen.

---

**Definition of Done (zie `CLAUDE.md`)** — functionaliteit volgens bovenstaande acceptatiecriteria; RLS-impact van de contexthelper gecontroleerd en vastgesteld; audit-logging aantoonbaar ongewijzigd (geen nieuwe AI-interactie, dus geen nieuw governance-event); tests toegevoegd of gemotiveerd niet — voor de contexthelper is een `core/lib/portaalcontext.sanity.ts` met pure afleidingslogica (tellingen, selectie, weglaten van lege kaarten) het aangewezen patroon; `tsc --noEmit --skipLibCheck` groen; `lint:colors`, `lint:boundaries` en `sanity` groen; `bash scripts/cross-tenant-ci.sh` groen; nieuw `AI-STARTPUNT-ONTWERP.md` opgesteld (inclusief de plateau-indeling P1–P5) en de ontwerp-sync-check groen; `HANDOVER.md` release-historie bijgewerkt; decision-entry aangemaakt voor de twee besluitpunten hierboven.

**Documentatiehaak** — dit is een **kleine release**: nieuwe UI-ingang, geen architectuur-, data-, security- of tenant-impact. `HANDOVER.md` + de decision-entry volstaan; de `00–09`-set en de as-built Word-doc blijven ongemoeid en de marker in `00 Overzicht en status/doc-actualisatie-log.md` wordt **niet** bijgewerkt. Wordt in Plan-modus alsnog optie B gekozen (nieuwe API-route), dan komt er een API-contract bij en verandert die weging — leg dat dan expliciet voor.

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md` (samenvatting, aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's). Neem daarin op: (a) welke route uit het architectuurpunt is gekozen en waarom, (b) het bewijs dat de homepage functioneel identiek is gebleven na het extraheren van de queries, en (c) de uitkomst van de privacycontrole met twee accounts binnen één fonds.
