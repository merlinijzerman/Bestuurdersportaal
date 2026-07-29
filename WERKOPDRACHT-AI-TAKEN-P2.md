# Werkopdracht: taakgericht startpunt — voorbeeldvragen en "Een document doorgronden"

> Plansessie Cowork, 28-07-2026. Plak deze werkopdracht als eerste bericht in een
> Claude Code-sessie in de repo-root. Zie `decisions/0004` en `WERKOPDRACHT-TEMPLATE.md`.

---

**Doel & context** — het AI-startpunt (besluit 0085) biedt nu drie taakkaarten die alle
drie hetzelfde doen: ze zetten de gebruiker in het invoerveld. Deze opdracht maakt twee
van die drie taken echt taakgericht. De vrije vraag krijgt voorbeeldvragen die uit de
eigen context komen; "een vraag over een document" wordt een opdracht die de gebruiker
scherpstelt vóórdat de assistent begint. De eerste taakkaart (agendapunt voorbereiden)
blijft ongewijzigd.

**Goedgekeurd ontwerp/plan** — `03 Functioneel ontwerp/Designrichtingen portaal/document-doorgronden.html`
is **normatief** voor schermopzet, teksten en gedrag. Dat bestand bevat vier schermen
(startpunt, scherpstellen, chat na start, voorbeeldvragen) plus een toelichtingstabel
met wat er ten opzichte van het eerdere concept bewust is geschrapt.

**Volgorde** — deze opdracht bouwt voort op `WERKOPDRACHT-AI-COMPOSITIE.md`. Die is
uitgevoerd maar staat nog **ongecommit** in de working tree, en de `decisions/`-entry
voor het samenvoegen van de kopbalken (besluitpunt 1 daaruit) ontbreekt nog. Rond dat
eerst af; begin hier pas daarna.

---

## Vertrekpunt — geverifieerd tegen de code op 28-07-2026

| Wat | Waar | Betekenis voor deze opdracht |
|---|---|---|
| `document_scope?: { document_ids?: string[]; algemene_kennis?: boolean }` | `app/api/chat/route.ts:184` | de API accepteert **al een lijst** documenten; meerdere stukken is een UI-vraag, geen API-wijziging |
| `kiesDocument` / `mentionSuggesties` | `AssistentClient.tsx:241, 1043, 1067` | de documentkiezer bestaat al als `@`-mention-typeahead; hergebruiken, niet herbouwen |
| `STARTVRAGEN` + chips | `AgendapuntChat.tsx:75` en de render rond regel 903-924 | het chip-patroon voor voorbeeldvragen bestaat al; alleen zichtbaar zolang er geen gesprek is |
| `VOORBEREIDING_VRAAG` | `AgendapuntChat.tsx` | precedent: een taak start als **gewone gebruikersbeurt** in de chat. De comment erbij legt uit waarom (welkomst-slice + natuurlijke dialoog) |
| antwoordmodi-vocabulaire | `core/lib/vraagtype.ts:147-153` | feitelijk, bronoverzicht, historisch, duiding, besluitrijpheid, sparring, persoonlijke_voorbereiding |
| `maak_korter` / `maak_concreter` | `core/lib/vraagtype.ts` (`VERVOLGACTIE_PROMPT`) | lengte wordt **achteraf** geregeld; daarom géén lengteknop vooraf (zie "Niet in scope") |
| `procedure_requirements` | `supabase/migrations/2026_05_07_decision_object.sql:315 e.v.` | weet per processtap welk bewijsstuk vereist is en of het er is → bron voor gat-vragen |
| contextquery's | `Startpunt.tsx` | volgende vergadering, agendapunten zonder eigen inbreng, eerstvolgende processtap, recent document — **al geladen**, geen extra query nodig |
| `Voortgang.tsx` | nieuw, besluit 0087 | voortgangsregels tijdens het wachten; hergebruiken in plaats van een eigen wachtscherm |

---

## Scope

### Deel A — voorbeeldvragen bij de vrije vraag

**A1. Een vragenpool met herkomst, geen vaste lijst.**

Bouw geen hardcoded array maar een pool waaraan generatoren kandidaten leveren:

```ts
type Startvraag = {
  tekst: string;
  bron: "context" | "signaal" | "vraagsoort";
  vraagsoort: Antwoordmodus | null;   // uit vraagtype.ts
  gewicht: number;
};
```

Twee generatoren vullen de pool. Beide gebruiken uitsluitend gegevens die
`Startpunt.tsx` **al ophaalt**; er komt geen enkele nieuwe query bij.

- **`context`** — titels uit de context in vaste zinsvormen. Bijvoorbeeld:
  *"Welk besluit wordt gevraagd bij «{agendapunt}»?"*, *"Welke risico's zitten er voor
  het fonds in «{document}»?"*
- **`signaal`** — afgeleid van wat er **ontbreekt** of knelt: een agendapunt zonder
  eigen inbreng, een naderende deadline op de eerstvolgende processtap, een
  `procedure_requirements`-regel die nog niet vervuld is. Bijvoorbeeld:
  *"Bij «{stap}» ontbreekt nog {vereist stuk} — wat betekent dat voor de voortgang?"*

**A2. Spreiding over vraagsoorten is een selectieregel, geen generator.**

Toon **maximaal één vraag per `vraagsoort`**, zodat de drie zichtbare vragen van
verschillend soort zijn (bijvoorbeeld één duiding, één besluitrijpheid, één historisch)
in plaats van drie varianten van hetzelfde. Zo laten de chips en passant zien *wat voor
soort* vragen de assistent aankan.

**A3. Sorteren op procesfase.**

De fase van de lopende procedure (`beeldvorming` / `oordeelsvorming` / `besluitvorming`
/ `in_evaluatie`) bepaalt de **volgorde**, niet de inhoud: in beeldvorming wegen
feitelijke en historische vragen zwaarder, in oordeelsvorming duiding en aannames, in
besluitvorming besluitrijpheid. Eén weegfunctie, geen aparte vragensets per fase.

**A4. Cap van drie, en log welke bron is aangeklikt.**

Toon er drie. Registreer bij het aanklikken **welke `bron`** de vraag leverde, zodat na
enkele weken meetbaar is welke generator werkt. Voeg dat veld toe aan de **bestaande**
chat-logging; maak **geen** nieuwe tabel en **geen** nieuw `governance_events`-type —
dat zou de append-only auditketen raken voor een puur UI-signaal.

Zichtbaarheid volgt `AgendapuntChat`: chips alleen zolang er nog geen gesprek is.

### Deel B — "Een document doorgronden"

**B1. Naam en entree.** De taakkaart heet voortaan **"Een document doorgronden"**
(was: "Een vraag over een document"; de oude naam beloofde één chatvraag). Klikken opent
een **scherpsteltoestand binnen `/ai`** — geen eigen route. Bewuste consequentie: geen
browser-terug en geen deeplink vanuit de bibliotheek. Kop met kruimelpad "Startpunt ›"
en een knop Annuleren, conform de mockup.

**B2. Context — één document, kiezer hergebruikt.** Voorgevuld met het recente document
uit de startpuntcontext, met een knop *wijzigen* die de bestaande
`@`-mention-typeahead-suggestiebron hergebruikt (`kiesDocument` / `mentionSuggesties`).
Eén document in dit plateau.

**B3. Wat wilt u terugkrijgen.** Vier onderdelen, elk een eigen kop in het antwoord:

| Sectie | Toelichting in de UI |
|---|---|
| Samenvatting | De kern in tien regels. |
| Bestuurlijke aandachtspunten | Wat vraagt aandacht of actie van het bestuur. |
| Kritische vragen | Drie vragen om in de vergadering te stellen. |
| Afwijkingen | Wat wijkt af van de vorige versie. |

**Afwijkingen is voorwaardelijk.** Alleen selecteerbaar als er aantoonbaar een eerdere
versie van het stuk in de bibliotheek staat. Is die er niet, dan staat de optie
uitgegrijsd **mét de reden** ("er staat geen eerdere versie van dit stuk in de
bibliotheek") — niet zomaar verborgen. Is die er wel, benoem dan waarmee vergeleken
wordt. Bepaal in Plan-modus hoe "vorige versie" betrouwbaar wordt vastgesteld; is er
geen sluitende relatie in het datamodel, **meld dat en laat de sectie uit dit plateau**
in plaats van hem op een gok aan te bieden.

Minimaal één sectie verplicht: bij nul aangevinkte secties is de startknop uit.

**B4. "Wat ik ga doen" — eerlijke teksten.** Een recap die meebeweegt met de keuzes.
De voettekst zegt uitsluitend wat de code waarmaakt:

> Het antwoord verschijnt in dit gesprek en blijft bewaard bij uw gesprekken. De vraag,
> de gebruikte bronnen en het antwoord worden vastgelegd in de Governance Log. Tijdens
> het opstellen ziet u per stap wat er gebeurt.

**Neem twee zinnen uit het eerdere concept NIET over:**

- ~~"Het resultaat wordt bewaard bij het agendapunt"~~ — de voorbereidingsroute *leest*
  alleen; er wordt niets bij een agendapunt bewaard, en bij een los document is er geen
  agendapunt.
- ~~"Geschatte tijd: 20-30 seconden"~~ — vervangen door de voortgangsmelding
  (`Voortgang.tsx`, besluit 0087). Een hardgecodeerd getal wordt onwaar zodra retrieval
  traag is.

**B5. Na "Start" landt de gebruiker in het gewone chatvenster.** Geen eigen
resultaatscherm. De taak wordt een normale gebruikersbeurt met een **leesbare zin**:

> Doorgrond «Actuarieel rapport Q2 2026» — samenvatting en bestuurlijke aandachtspunten.

Daarmee is het antwoord een gewone beurt: het blijft bewaard (fase B2), staat in de
gesprekkenlade, en de bestaande vervolgacties uit `vraagtype.ts` werken meteen. Dit
volgt het `VOORBEREIDING_VRAAG`-precedent uit `AgendapuntChat.tsx`.

**B6. Auditcriterium — parameters loggen, niet alleen de zin.** Omdat de zichtbare
vraag korter is dan de instructie die de assistent krijgt, moet de Governance Log de
**parameters** vastleggen: document-id('s), gekozen secties, en de gebruikte
promptvariant. Zonder dat is achteraf niet te reconstrueren waarom een antwoord eruit
ziet zoals het eruit ziet. Sluit aan op de bestaande chat-logging; geen nieuw
audit-event-type.

### Deel C — uniforme vervolgweergave, ook in de agenda

Onder elk AI-antwoord staan twee rijen die er identiek uitzien maar iets anders doen:
**vervolgvragen** starten een nieuwe vraag, **vervolgacties** bewerken het antwoord dat
er al staat. Beide zijn nu ronde pillen met dezelfde klassen. Referentie voor de nieuwe
vorm: `03 Functioneel ontwerp/Designrichtingen portaal/vervolgvragen.html`, **optie 1
(Rijen)** — goedgekeurd 28-07-2026.

**C1. Nieuwe vorm.**

- **Vervolgvragen** zijn zinnen en krijgen dus **regels**, niet pillen: volledige
  breedte, links uitgelijnd, `rounded-lg`, een gedempte `→` vooraan, onder elkaar met
  een kopje **"Hierover doorvragen"**. Hover: accentrand + `bg-accent-tint`.
- **Vervolgacties** zijn korte etiketten en blijven klein: `rounded-lg`, gedempte tekst,
  lichte rand, in één rij eronder. Ze mogen visueel niet met de vragen concurreren.

Daarmee is het verschil afleesbaar zonder uitleg: wat een pijl heeft start iets nieuws,
de grijze knopjes bewerken wat er staat.

**C2. Eén gedeelde component — geen tweede implementatie.**

`AntwoordWeergave.tsx` is al de gedeelde laag voor AI-antwoorden (besluit 0079) en wordt
door **beide** schermen geïmporteerd (`AssistentClient.tsx:13` en
`AgendapuntChat.tsx:43`). Voeg daar een component toe, bijvoorbeeld `Vervolgblok`, en
gebruik die op beide plekken.

**Belangrijke constraint:** de component **berekent de acties niet zelf** maar krijgt ze
als prop. De twee schermen bepalen ze namelijk verschillend en dat is bewust:
`AssistentClient.tsx` leidt `documentGericht` af uit de onderbouwing, terwijl
`AgendapuntChat.tsx:869` hard `true` meegeeft met de comment *"de agenda is altijd
stukgericht"*. Die logica moet blijven waar hij staat; alleen de weergave wordt gedeeld.

**C3. De twee schermen zijn al uit elkaar gelopen — trek dat gelijk.**

| | `AssistentClient` | `AgendapuntChat` |
|---|---|---|
| vulling | `bg-card` | `bg-white` |
| rand | `border-line` | `border-app-line-strong` |
| padding | `py-1` | `py-1.5` |
| kopje boven de vragen | "Vervolgvragen" | geen |

Na deze opdracht komt alles uit één component en is dit verschil weg.

**C4. `hover:bg-warn-tint` weghalen — maar niet blind.**

De hover kleurt de knop okergeel (`#FAF1DF`, het waarschuwingstoken). Dat is een restant
van de warme huisstijl van vóór tranche 1; naast het violet accent vloekt het. Vervang
door `hover:bg-accent-tint`.

De klasse staat op **tien** plekken, waarvan **acht** fout en **twee goed**:

| Vervangen | Laten staan |
|---|---|
| `AgendapuntChat.tsx:811, 851, 879, 919` | `notulen/_components/SegmentBeheer.tsx:220` |
| `AssistentClient.tsx:1328, 1380, 1416, 1468` | `beheer/_components/BeheerClient.tsx:549` |

Die laatste twee zijn **wél** waarschuwingsknoppen (`border-warn/30 text-warn-ink`) —
daar is `warn-tint` semantisch juist. Een globale zoek-en-vervang breekt ze. Regel 1468
is de `@`-mention-dropdown: die hoort `bg-app-zebra` te krijgen, geen accenttint, want
het is een lijstrij en geen actie.

**C5. Startvragen meenemen.** `AgendapuntChat.tsx:919` (`STARTVRAGEN`) en de
voorbeeldvragen uit deel A zijn hetzelfde soort element als vervolgvragen: een klikbare
zin die een vraag start. Geef ze dezelfde rijvorm, zodat er in het hele portaal één
verschijningsvorm is voor "klik hier om dit te vragen".

### Niet in scope

- **Meerdere documenten tegelijk** (plateau 2c). De API kan het al, maar zonder cap en
  zonder meting verdunt het de goede passages. Pas na meting van deel B.
- **Een lengteknop (kort/volledig).** Bewust geschrapt: `maak_korter` en `maak_concreter`
  bestaan al als vervolgactie, dus lengte hoort achteraf, niet vooraf. "Kort — ongeveer
  één A4" is de vaste norm. Dit halveert bovendien de promptmatrix van zestien naar acht.
- **Rol- of expertisegedreven vragen** (`bestuurlijke_rol`, `primaire_expertise_id`).
  Technisch mogelijk, bewust niet gedaan: een pensioenfondsbestuur is collegiaal
  verantwoordelijk, en vragen weglaten op grond van iemands rol bouwt onzichtbaar de
  kokers die goed bestuur juist moet doorbreken.
- **Vragen die collega's stelden.** Privacyvraagstuk binnen een orgaan waar dissent
  beschermd is.
- **Door een taalmodel gegenereerde voorbeeldvragen.** Kost latency op een scherm dat
  direct moet staan, en is nieuwe AI-functionaliteit — volgens `CLAUDE.md` niet zonder
  prompt- en outputlogging.
- Wijzigingen aan taakkaart 1 (agendapunt voorbereiden), aan retrieval, aan de
  antwoordmodi of aan de AI-toon-systeemprompt.

---

## Besluitpunten

**1. Asymmetrie tussen taak 1 en taak 2.** Na deze opdracht kan een document met
kiesbare secties worden doorgrond, terwijl een agendapunt een vaste prompt met drie
vaste secties houdt. Twee mentale modellen voor dezelfde handeling — "iets voorbereiden".
Leg vóór merge vast of dat bewust zo blijft of dat convergentie op de rol staat. Nu
beslissen is goedkoper dan later.

**2. "Vorige versie" bij Afwijkingen.** Zie B3: als het datamodel geen betrouwbare
versierelatie kent, is de eerlijke uitkomst dat deze sectie uit het plateau valt. Leg
de bevinding voor in plaats van hem te benaderen met een titelvergelijking.

---

## Acceptatiecriteria

1. Op het startpunt verschijnen maximaal drie voorbeeldvragen, alle drie gevuld met
   echte gegevens uit de context van de ingelogde gebruiker — geen generieke tekst.
2. De drie getoonde vragen hebben elk een verschillende `vraagsoort`.
3. Er is minstens één vraag afkomstig van de `signaal`-generator zodra er een
   onvervulde requirement of een agendapunt zonder inbreng is.
4. Bij het aanklikken van een voorbeeldvraag wordt de `bron` meegelogd in de bestaande
   chat-logging. **Geen nieuwe tabel, geen nieuw `governance_events`-type.**
5. Voorbeeldvragen verdwijnen zodra er een gesprek loopt (patroon `AgendapuntChat`).
6. Deel A voegt **nul** nieuwe database-query's toe aan het startpunt; aantoonbaar via
   de bestaande contextlading.
7. "Een document doorgronden" opent de scherpsteltoestand binnen `/ai`; Annuleren keert
   terug naar het startpunt zonder gesprek aan te maken.
8. Een ander document kiezen gebruikt de bestaande typeahead-suggestiebron; er is geen
   tweede zoekimplementatie bijgekomen.
9. Bij nul aangevinkte secties is de startknop uitgeschakeld.
10. "Afwijkingen" is uitsluitend selecteerbaar bij een aantoonbaar eerdere versie, en
    toont anders de reden. Bij twijfel over het datamodel is besluitpunt 2 voorgelegd.
11. De recap-voettekst bevat **geen** belofte over opslaan bij een agendapunt en **geen**
    tijdsindicatie.
12. Na Start staat de gebruiker in het gewone chatvenster, met een leesbare
    gebruikersbeurt; het gesprek verschijnt in de gesprekkenlade en de vervolgacties
    werken.
13. De Governance Log bevat per taakuitvoering de parameters (document-id's, secties,
    promptvariant), niet alleen de zichtbare zin.
14. **Evalronde uitgevoerd vóór oplevering:** een steekproef over de acht
    sectiecombinaties is beoordeeld in `ai-quality-lab`/`evals`, met een expliciet
    oordeel of elke combinatie een bruikbaar bestuurlijk antwoord geeft. Combinaties die
    zakken worden gerepareerd of uitgezet — niet stil opgeleverd.
15. `tsc --noEmit --skipLibCheck` groen; `npm run lint:colors` groen.
16. Geen enkele kleurtokenwaarde gewijzigd; geen wijziging aan `THEMABARE_TOKENS`.
17. Vervolgvragen worden als rijen getoond (volledige breedte, `→` vooraan, kopje
    "Hierover doorvragen"); vervolgacties als kleine gedempte knopjes eronder. Conform
    optie 1 in `vervolgvragen.html`.
18. Beide schermen renderen dit via **één** component in `AntwoordWeergave.tsx`; er is
    geen tweede implementatie van dezelfde markup meer.
19. Die component ontvangt de vervolgacties als prop; de bepaling ervan (inclusief het
    harde `documentGericht = true` van de agenda) staat nog steeds in het aanroepende
    scherm.
20. In `AssistentClient.tsx` en `AgendapuntChat.tsx` komt `hover:bg-warn-tint` niet meer
    voor. In `SegmentBeheer.tsx:220` en `BeheerClient.tsx:549` staat hij **nog wel** —
    daar is hij semantisch juist.
21. De `@`-mention-dropdown (`AssistentClient.tsx:1468`) gebruikt `bg-app-zebra` als
    hover, niet `accent-tint`.
22. Startvragen in de agenda en voorbeeldvragen uit deel A hebben dezelfde rijvorm als
    vervolgvragen.

---

## Relevante bestanden

- `app/(dashboard)/ai/_components/Startpunt.tsx` — taakkaarten, contextlading, vragenpool
- `app/(dashboard)/ai/_components/AssistentClient.tsx` — scherpsteltoestand, typeahead-hergebruik, start van de beurt
- `core/lib/vraagtype.ts` — vraagsoorten en vervolgacties (lezen, niet wijzigen)
- `app/(dashboard)/ai/_components/AntwoordWeergave.tsx` — gedeelde laag (besluit 0079); hier komt de nieuwe `Vervolgblok`-component
- `app/(dashboard)/vergaderingen/_components/AgendapuntChat.tsx` — referentiepatroon (`STARTVRAGEN`, `VOORBEREIDING_VRAAG`) **en** doelbestand voor deel C
- Referentie: `03 Functioneel ontwerp/Designrichtingen portaal/vervolgvragen.html` (optie 1)
- `app/api/chat/route.ts` — `document_scope`, logging van parameters
- Referentie: `03 Functioneel ontwerp/Designrichtingen portaal/document-doorgronden.html`

**Guardrails (zie `CLAUDE.md`)** — RLS per `fonds_id` via uitsluitend de anon-key;
append-only audit (`governance_events` en `*_log` nooit UPDATE/DELETE); human-in-the-loop
(de assistent signaleert en spiegelt, besluit nooit); snapshot-integriteit; geen
schijnzekerheid. Deze opdracht zou **geen migratie** nodig moeten hebben — blijkt dat
wel zo, dan is dat een signaal dat de scope verkeerd begrepen is: stop en leg voor.

**In te zetten subagents** — `code-reviewer` en `ai-governance-reviewer` (verplicht:
deze opdracht raakt promptsamenstelling en logging), `audit-evidence-reviewer` voor
criterium 4 en 13, en `ontwerp-sync-reviewer` vóór merge. Motiveer kort waarom
`supabase-rls-reviewer` wel of niet nodig was.

**Werkmodus** — begin in **Plan-modus**. Lever eerst een implementatieplan met: de
werkelijke regelnummers, de opzet van de vragenpool, de bevinding over "vorige versie"
(besluitpunt 2), de logging-aanpak voor criterium 4 en 13, en de evalopzet voor
criterium 14. **Wijzig pas na expliciet akkoord.**

**Definition of Done (zie `CLAUDE.md`)** — acceptatiecriteria 1-16 aantoonbaar; tests
toegevoegd of gemotiveerd niet; `tsc` groen; ontwerpdoc bijgewerkt + sync-check groen;
`HANDOVER.md` release-historie bijgewerkt; `decisions/`-entries voor besluitpunt 1 en —
indien van toepassing — besluitpunt 2.

**Documentatiehaak** — dit is **geen** kleine release: er komt nieuw AI-gedrag bij
(samengestelde instructies) en de logging wordt uitgebreid. Actualiseer daarom naast
`HANDOVER.md` ook het functioneel ontwerp voor de AI-module, en beoordeel expliciet of
`05 Security en compliance` en `07 Compliance, privacy en juridisch` bijwerking nodig
hebben vanwege criterium 13. Werk de marker in
`00 Overzicht en status/doc-actualisatie-log.md` bij en licht de weging toe.

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md`: samenvatting,
aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact,
test/verificatie, openstaande risico's.
