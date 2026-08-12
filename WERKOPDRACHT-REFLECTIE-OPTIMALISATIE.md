# Werkopdracht: optimalisatie reflectiefunctie (plateau B-opt)

> **Opgesteld** 12 augustus 2026, ná oplevering van plateau B (live 05-08-2026).
> **Vorm** conform `WERKOPDRACHT-TEMPLATE.md`.
> **Goedgekeurd ontwerp:** `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` + `VOORSTEL-REFLECTIE-ANTWOORDPAD.md` — samen leidend.
> **Plak dit bestand als eerste bericht in een Claude Code-sessie in de repo-root.**

---

## ⛔ Gates

**Tranche 1 (fixes) — geen gate.** Bevat geen ontwerpwijziging en mag direct.

**Tranche 2 t/m 4 — één blokkerende voorwaarde:**

**De gebruikerstoets uit `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` §L, aangevuld met criteria 8 en 9 uit `VOORSTEL-REFLECTIE-ANTWOORDPAD.md` §7, is uitgevoerd en het toetsrecord staat vastgelegd onder `08 Test en acceptatie/`.**

Dit is dezelfde gate als besluit [`0122`](./decisions/0122-gebruikerstoets-voor-de-bouw-van-plateau-b.md), en hij is de vorige keer op een mondelinge bevestiging gepasseerd — zie **OP-B1**, dat nog open staat. De reden dat hij zwaar is, is ongewijzigd: besluit [`0112`](./decisions/0112-geen-reflectiemarkering-in-enige-registratie.md) sluit elke registratie van reflectiegedrag uit, dus **er is geen telemetrie die een verkeerde aanname later corrigeert.** Deze werkopdracht wijzigt precies de drie werkhypothesen die die toets had moeten valideren: de labels, het aantal vragen en de triggermomenten.

Voer de toets uit op mockups, vóór tranche 2. Leg deelnemers, scenario's, bevinding per criterium 1–9 en het doorgangsoordeel vast, en verwijs ernaar vanuit `HANDOVER.md` en `huidige-status.md`. **Daarmee sluit OP-B1 in dezelfde beweging.**

**Overige gates** (uitvoeringsvoorwaarden, elke sessie): `tsc --noEmit --skipLibCheck` groen vóór en na · `npm run sanity` en `npm run test:xtenant` groen vóór en na · `supabase/checks/2026_07_31_r1_structurele_gates.sql` schoon tegen de doeldatabase — **let op: die staat voor plateau B nog open (OP-B9) en moet hier alsnog gedraaid worden** · `scripts/check-service-role-leak.sh` staat pre-existing rood op een commentaarregel in `core/lib/app-fout-schrijf.ts` (OP-A9); constateer dat het rood **ongewijzigd** is, niet dat het groen is.

---

## Doel & context

De reflectiefunctie werkt, maar voelt als een vragenlijst en stuurt feitelijk naar drie verdiepingsvragen voordat er een concept ontstaat. Deze opdracht maakt de ingang compacter (acht → vier), maakt één goede verdiepingsvraag de standaard, herstelt een beloftebreuk in de knop *Aanpassen*, en maakt de vraagkeuze contextueel binnen harde guardrails — zonder de privacy-, non-directiviteits- en server-state-eigenschappen aan te tasten die de functie dragen.

**Besluit opdrachtgever 12-08-2026:** *Ik zie een risico* gaat als vierde ingang mee, met een vastgelegd verwijdercriterium (`VOORSTEL` §B). De afweging staat daar volledig; het advies luidde oorspronkelijk drie.

Beoogde eindervaring: één keuze, één scherpe vraag, één concept, binnen twee minuten. Het gevoel moet zijn *"dit helpt mij mijn eigen oordeel scherper te krijgen"* — niet *"ik moet een vragenlijst invullen"* en niet *"de AI vertelt mij wat ik moet denken"*.

## Goedgekeurd ontwerp

Leidend, in deze volgorde:

1. `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` — het *wat* en *waarom* van deze wijziging, inclusief de zes guardrails onder §A-bis.
2. `VOORSTEL-REFLECTIE-ANTWOORDPAD.md` — de zichtbare vorm van een reflectiebeurt: nieuwe systeemprompt, attributieplicht, lichte bronweergave, chips.
3. `03 Functioneel ontwerp/Bestuurdersportaal - Reflectiefunctie en verwijderbare gesprekken v1.0.md` §9 — het bestaande ontwerp, voor alles wat níet wijzigt.
4. Besluiten `0108`–`0113`, `0121`, `0123`, `0126`.

**Bij twijfel wint de code.** Er staan aantoonbaar onjuiste aannames in het technisch ontwerp van vóór de bouw van plateau B.

## Scope

**Wel — vier tranches, in deze volgorde:**

| # | Tranche | Onderdeel |
|---|---|---|
| **1** | Fixes | **1a** Actie `herformuleren` + werkende Aanpassen-flow (vervangt de huidige focus-op-chatbalk) |
| | | **1b** Triggerlogica: de `sparring`-proxy vervalt; alleen `besluitrijpheid` blijft over |
| | | **1c** De besluitmoment-variant van de openingsvraag daadwerkelijk meegeven |
| | | **1d** De ongebruikte parameter `laatsteBerichtIsReflectie` opruimen of expliciet verantwoorden |
| **2** | Compacte UX | **2a** Vier ingangen (`mis_iets`, `twijfel`, `risico`, `overtuigt`) met labels, subteksten en nieuwe kaartlayout |
| | | **2b** Migratie: CHECK op `gesprek_reflectie_state.ingang` van acht naar vier waarden, mét mapping van bestaande rijen |
| | | **2c** Eén verdiepingsvraag als standaard: `concept` wordt ná elk reflectieantwoord aangeroepen |
| | | **2d** Actie `verdiepen` + knop *Nog een stap verdiepen*; beurtplafond 3 blijft harde guardrail |
| | | **2e** Nieuw conceptformat (drie kopjes, twee voorwaardelijk) |
| | | **2f** **Lichte bronweergave tijdens reflectie** — drie standen; staat los van de vraagkeuze en kan hier mee. *Uitsluitend weergave; de logging blijft ongewijzigd* |
| **3** | Adaptieve verdieping | **3a** `core/lib/reflectie-richtingen.ts`: gesloten richtinglijsten, deterministische terugval, validator (inclusief AC-R1 t/m R8) |
| | | **3b** De verdiepingsbeurt wordt **niet gestreamd** maar gebufferd, gevalideerd en dan getoond |
| | | **3c** Promptwijziging: `SP_REFLECTIE_REGELS` wordt **vervangen** door de versie uit `VOORSTEL-REFLECTIE-ANTWOORDPAD.md` §1; `SP_REFLECTIE_CONCEPT_REGELS` aangepast; nieuwe hashpins |
| | | **3d** **Samenstellingsmarker**: de feitelijke bronsamenstelling van het oorspronkelijke antwoord wordt aan de reflectiecontext meegegeven. Zonder marker verbiedt de prompt elke uitspraak over herkomst |
| **4** | Optioneel | **4a** Knop *Wat pleit er tegen?* + `SP_REFLECTIE_TEGENPERSPECTIEF` |
| | | **4b** T1 (na een agendapuntvoorbereiding) als deterministische trigger, alleen als goedkoop |
| | | **4c** *Ik zie een risico* **weer verwijderen** — uitsluitend wanneer bij de toets **beide** verwijdercriteria uit `VOORSTEL` §B zich voordoen. Beslis dit vóór ingebruikname; daarna kost het opnieuw een migratie met datamapping |
| | | **4d** Antwoordchips met **voorvul-semantiek** (een chip is een opener, geen antwoord); alleen bij de eerste verdiepingsbeurt, maximaal drie plus *Iets anders* |

**Niet:**

- Documentvergelijking, dossierconsistentie of enige nieuwe platformcapability.
- Plateau C en D: publicatiebestemmingen, `decision_concerns`, dissent, AI-provenance, retentie.
- Persoonlijke reflectienotities (besluit `0113`).
- Een model dat beoordeelt of er "voldoende scherpte" is — **expliciet verworpen**, zie `VOORSTEL` §E. Bouw dit niet, ook niet als het onderweg elegant lijkt.
- Een uitspraak over de herkomst van het eerdere antwoord die het model zelf afleidt — **expliciet verworpen**, zie `ANTWOORDPAD` §0.2. Alleen de server-injectie is toegestaan.
- Het "meenemen" van de lichte bronweergave in de logging. 2f is uitsluitend weergave; wie de gelogde bronvermeldingen opschoont, raakt het auditspoor en besluit `0112` tegelijk.
- Elke vorm van reflectiemarkering, teller of geaggregeerde analyse — principieel uitgesloten.
- Herschrijven van de AI-toon-systeemprompt (staat op de "niet doen zonder expliciet voorstel"-lijst in `CLAUDE.md`).

## Impactklasse

**Architectuur + data + security.** Weging expliciet:

- **Architectuur** — de vraagkeuze introduceert een contextuele beslissing waar nu een vaste tabel staat; de flowvorm wijzigt van drie-vragen-dan-concept naar één-vraag-dan-concept.
- **Data** — geen nieuwe tabel, geen nieuwe kolom. Wél een gewijzigde CHECK-constraint met datamapping (tranche 2b).
- **Security** — `create or replace` op de bestaande `SECURITY DEFINER`-functie `reflectie_transitie`. Geen nieuwe policy, geen nieuwe grant, geen service-role.
- **Tenant** — geraakt maar niet gewijzigd: het fonds-scope-predicaat blijft ongemoeid.

**Gevolg 1:** de documentatiehaak vuurt. Let op: hij staat voor plateau A en B al open (**OP-B8**) — `02 Architectuur`, `03 Functioneel ontwerp`, `05 Security en compliance` en `09 Objectenmodel` zijn voor plateau B nog niet bijgewerkt. Werk die achterstand in dezelfde beweging weg of laat hem expliciet staan; verschuif de marker in `doc-actualisatie-log.md` pas ná de Word-doc-actualisatie.

**Gevolg 2:** de structurele gates A–H zijn verplicht — en waren voor plateau B nog niet gedraaid (**OP-B9**). Een bevinding is nu een productiebevinding.

## Relevante bestanden

| Pad | Waarvoor |
|---|---|
| `core/lib/reflectie-flow.ts` (+ `.sanity.ts`) | Ingangen, labels, transitietabel, `moetNaarConcept`, `effectieveStatus`. Tranche 1a, 1d, 2a, 2c, 2d |
| **Nieuw:** `core/lib/reflectie-richtingen.ts` (+ `.sanity.ts`) | Richtinglijsten, `standaardVraag()`, `valideerVerdiepingsvraag()`. Tranche 3a |
| `core/components/ReflectieKaart.tsx` | Drie ingangen, subteksten, layout, besluitmoment-variant. Tranche 1c, 2a |
| `core/components/ReflectieInvoer.tsx` | Aanpassen-flow, knop *Nog een stap verdiepen*, conceptknoppen. Tranche 1a, 2d, 4a |
| `app/api/reflectie/transitie/route.ts` | Actie-allowlist uitbreiden met `herformuleren` en `verdiepen`. Tranche 1a, 2d |
| `app/api/chat/route.ts` | Actiebepaling per beurt; `concept` ná elk antwoord; niet-gestreamde verdiepingsbeurt; promptkeuze. Tranche 2c, 3b, 3c |
| `core/lib/generatie-kern.ts` (+ `.sanity.ts`) | `SP_REFLECTIE_REGELS`, `SP_REFLECTIE_CONCEPT_REGELS`, nieuw tegenperspectiefblok, hashpins. Tranche 3c, 4a |
| `app/(dashboard)/ai/_components/AssistentClient.tsx` | Triggerlogica, kaartweergave, invoerbranches. Tranche 1b, 1c, 2a, 2d |
| `app/(dashboard)/vergaderingen/_components/AgendapuntChat.tsx` | **Identiek gedrag vereist** — elke wijziging landt op beide chats |
| **Nieuw:** `supabase/migrations/2026_XX_XX_bopt_reflectie_ingangen.sql` (+ `_ROLLBACK`) | CHECK-mapping + `create or replace reflectie_transitie`. Tranche 1a, 2b, 2d |
| `supabase/checks/2026_08_05_b_reflectie_flow.sql` | Uitbreiden met de nieuwe acties en de CHECK-mapping |
| `core/lib/audit-meta.sanity.ts` | Expliciete assertie dat `richting` nergens in een allowlist voorkomt |
| `core/components/AntwoordWeergave.tsx` + `AI-WEERGAVE-ONTWERP.md` | Lichte bronweergave tijdens reflectie. **Eén renderer voor `/ai` én de agendapuntchat (besluit `0079`)** — een wijziging landt altijd op beide |
| `evals/`, `ai-quality-lab/` | Prompttests voor vraagvorm, compactheid, terugval, conceptformat en toon (AC-E1 t/m E6) |

## Guardrails met bijzondere aandacht

Naast `CLAUDE.md` §Niet-onderhandelbare guardrails:

- **De zes guardrails bij de vraagkeuze (`VOORSTEL` §A-bis) zijn niet-onderhandelbaar.** De richting poort niets af, wordt nergens opgeslagen, wordt nooit als conclusie getoond, de vraag draagt een verplichte uitweg, de deterministische vraag blijft de terugval, en de vraag wordt niet gestreamd. Sneuvelt er één, dan is de wijziging niet meer wat er is goedgekeurd.
- **Geen reflectiemarkering, nergens.** Niet in `modus`, niet in `retrieval_meta`, niet in een aparte tabel, ook niet geaggregeerd. De gekozen *richting* is hier nadrukkelijk onderdeel van: die mag de request niet verlaten.
- **De client mag de flowstatus niet muteren.** De twee nieuwe acties lopen via dezelfde definer-functie, met dezelfde `for update`-herlezing. De vijf misbruikpogingen uit AC-18 moeten blijven falen.
- **Geen retrieval tijdens reflectie.** Ongewijzigd en onaantastbaar: geen embedding, geen RPC, geen FTS-terugval, geen reranker. Reflectietekst wordt nooit een zoekquery.
- **Het beurtplafond van 3 blijft hard**, ook nu het geen stuurmiddel meer is maar een vangnet. Server-side afgedwongen, niet alleen door een verborgen knop.
- **Nooit diagnosticeren.** De blocklist (AC-R4) is de machinale ondergrens, niet de norm — de norm staat in `SP_REFLECTIE_REGELS`.
- **Attributieplicht in plaats van rubrieken.** De drie vaste koppen verdwijnen; daarvoor in de plaats draagt élke dossieruitspraak een expliciete attributie ("in de stukken…", `[Bron N]`). Alles wat niet zo is gemarkeerd, is de inbreng van de bestuurder of de vraag — een eigen constatering van de assistent bestaat niet. Dit is de **vervanging** van een zichtbare garantie, niet het schrappen ervan.
- **Geen schijnzekerheid over bronherkomst.** Zie het scope-verbod hierboven; AC-R7 dwingt het af.
- **Beide chats gelijk.** `/ai` en de agendapuntchat delen het gedrag; een wijziging in één is een bug in de ander.

## Wat de bouw van plateau B heeft geleerd — lees dit vóór je begint

1. **`pgcrypto` staat op Supabase in het schema `extensions`.** Elke functie met een gepinde `search_path` die `digest()` aanroept, moet `extensions` daarin opnemen. Kostte bij B een `42883` op de eerste echte run.
2. **Structurele checks die blind op kolomnamen scannen, slaan alarm op legitieme velden.** De kolomscan op "reflectie" heeft een smalle allowlist per `tabel.kolom`; laat die smal.
3. **De `?`-jsonb-operator wordt door SQL-clients als parameterplaceholder gelezen.** Gebruik `jsonb_exists()`.
4. **`now()` is de transactiestarttijd.** Toets in checksuites op het *bestaan* van de verwachte rij, niet op volgorde.
5. **Zet een check die een tijd rood staat onderaan**, niet bovenaan.
6. **De SQL-editor kent geen psql-metacommando's.**
7. **De migratie draaien is geen formaliteit.** Bij plateau B bracht de eerste echte run twee fouten aan het licht die de statische review niet zag.

## Testaanpak

Volledig uitgeschreven in `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` §L. Kort:

- **TypeScript-sanity:** `reflectie-flow.sanity.ts` (nieuwe transitietabel + het aantal geweigerde combinaties opnieuw bevriezen), nieuw `reflectie-richtingen.sanity.ts` (gesloten lijsten, mapping oud→nieuw, validator positief én negatief, terugval bestaat per ingang), `generatie-kern.sanity.ts` (nieuwe hashpins + assertie op verboden formuleringen), `audit-meta.sanity.ts` (geen `richting`, geen reflectiesleutel).
- **SQL-check:** `verdiepen` bij `beurt = 3` faalt; `herformuleren` verhoogt `beurt` niet en wijzigt ingang noch bronset; beide acties falen vanuit elke andere status; oude ingangwaarden worden geweigerd; de migratiemapping laat geen rij achter; AC-18 en AC-24 blijven groen.
- **Prompttests** in `evals/` en het AI-quality-lab: per ingang realistische antwoorden, assert op vraagvorm en op het intreden van de terugval bij geforceerde diagnosetaal; conceptformat op kop, voorwaardelijkheid en letterlijke slotzin.
- **Toon en compactheid** (`ANTWOORDPAD` §7): AC-R1 t/m R8 als validatortests met terugval, AC-E1 t/m E6 als evalasserties. Let op **AC-E5**: over de vaste evalset moet de meerderheid van de eerste beurten géén contextzin bevatten. Een suite waarin bijna elke beurt broncontext heeft, is een gezakte suite — ook als elke afzonderlijke beurt correct is.
- **Privacytest, handmatig:** één volledige reflectie doorlopen en daarna `governance_log`, `retrieval_meta` en `profiel_log` controleren op elk spoor.
- **Gebruikerstoets:** zie de gate bovenaan.

## In te zetten subagents

`ai-governance-reviewer` (**verplicht** — non-directiviteit, de zes guardrails, geen schijnzekerheid), `supabase-rls-reviewer` (**verplicht** — gewijzigde definer-functie en CHECK), `code-reviewer`, `ontwerp-sync-reviewer` vóór merge.

*Bij plateau A en B bleken deze subagent-typen in de gebruikte omgeving niet beschikbaar. Constateer dat expliciet als het opnieuw zo is, in plaats van de review stilzwijgend over te slaan.*

## Werkmodus

Begin in **Plan-modus**. Lever eerst een implementatieplan per tranche met bestanden, RLS-impact, migratie-impact, testaanpak en risico's — inclusief een expliciete verificatie van de aannames in `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` tegen de werkelijke code. **Wijzig pas na expliciet akkoord.**

Lever **tranche 1 als losse, mergebare eenheid** op. Die bevat de beloftebreuk-fix en heeft geen gate; hem laten wachten op de gebruikerstoets is onnodig.

## Definition of Done

Volg `CLAUDE.md` §Definition of Done. Opdracht-specifiek:

- **Ontwerpdocs:** functioneel ontwerp naar **v1.1** (§9.1, §9.3, §9.6, §9.7); technisch ontwerp §6.1 bijwerken op de transitietabel.
- **Decision-records — vier nieuwe, want elke wijziging hieronder is een herziening van vastgesteld ontwerp:**

  | # | Onderwerp | Herziet |
  |---|---|---|
  | 1 | Vier reflectie-ingangen in plaats van acht, mét het verwijdercriterium voor `risico` | v1.0 §9.3 |
  | 2 | Eén verdiepingsvraag als standaard; verdieping op initiatief van de bestuurder | v1.0 §9.6 |
  | 3 | Adaptieve vraagkeuze binnen guardrails — **herziening van het non-classificatieprincipe**, met de zes guardrails letterlijk in het besluit | de regel "nooit classificeren op inhoud" in `ReflectieInvoer.tsx` en `reflectie-flow.ts` |
  | 4 | `herformuleren` als expliciete transitie; de normale invoerbalk blijft beëindigend | `0110` |
  | 5 | Reflectiebeurten zijn doorlopende tekst met **attributieplicht** in plaats van drie vaste rubrieken | v1.0 §9.6 en de gepinde promptregel |

  Besluit 3 is de belangrijkste. Zonder dat record staat er over een half jaar een principe in de code dat de code zelf niet meer waarmaakt.

- **Tests:** de vier sanity-suites, de uitgebreide SQL-check en de prompttests hierboven.
- **Documentatiehaak:** vuurt. Neem de openstaande achterstand uit OP-B8 mee of laat hem expliciet staan.

## Openstaande punten

Nieuwe restrisico's en bewust uitgestelde onderdelen in `00 Overzicht en status/openstaande-punten-en-risicos.md`, **mét eigenaar**. Een punt dat alleen in de release-historie staat, geldt als niet belegd.

**Bestaande punten die deze opdracht raakt:**

| # | Punt | Effect van deze opdracht |
|---|---|---|
| OP-B1 | Toetsrecord van de gebruikerstoets ontbreekt | **Wordt gesloten** door de gate bovenaan |
| OP-B8 | Documentatiehaak onvolledig voor plateau A en B | Wordt opnieuw geraakt; meenemen of expliciet laten staan |
| OP-B9 | Structurele gates A–H niet gedraaid; L3/L4/L12 open | Gates worden hier alsnog verplicht. **L3 blijft open en weegt zwaarder na deze wijziging niet — de dataroute verandert niet — maar hij is nog steeds niet ingevuld** |
| OP-B6 | Een ingetrokken bevroren bron verdwijnt zonder melding | Ongewijzigd. Het nieuwe conceptkopje "Wat hierover al vaststond" maakt het gemis zichtbaarder; heroverweeg een rustige inline-melding |

**Te verwachten nieuwe punten:**

- De vraagkeuze is niet deterministisch en per ontwerp niet meetbaar. Enige correctiemechanisme blijft de gebruikerstoets.
- `herformuleren` kent geen limiet; bewust, omdat een teller reflectiegedrag zou registreren.
- Bij vier ingangen verdwijnt de fijnmazigheid van acht. Als de toets uitwijst dat *uitlegbaarheid* of *evenwichtigheid* in de praktijk niet meer wordt aangeraakt, is dat een bevinding en geen detail.
- **`risico` staat naast `twijfel` en overlapt daar deels mee.** Het verwijdercriterium uit `VOORSTEL` §B is nu vastgelegd; belegd bij de toetsleider, te beslissen bij de gebruikerstoets en niet later. Zonder dat besluitmoment blijft de knop staan omdat niemand hem weghaalt — het patroon uit OP-C1.
- De lichte bronweergave (2f) kan als vertrouwensverlies landen in een portaal waarin bronvermelding het vertrouwen draagt. Toetscriterium 9 moet dat uitwijzen vóór brede uitrol.
- Het wegvallen van de drie rubrieken verplaatst de bewijsdiscipline van een zichtbare rubriek naar een tekstuele attributie. Dat is strenger op papier, maar minder zichtbaar voor wie meekijkt; AC-E4 is daarmee een blijvend aandachtspunt in elke prompt-herziening.

## Terugkoppeling

Rapporteer in het antwoordformat uit `CLAUDE.md`: samenvatting, aangepaste bestanden, RLS/security-impact, audit-logging-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's. Rapporteer **per tranche**.
