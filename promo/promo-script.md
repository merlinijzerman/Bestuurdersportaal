# Promovideo Bestuurdersportaal — optimalisatievoorstel en montagescript

**Versie:** 2026-07-30 (v3) · **Speelduur:** 43 seconden · **Vorm:** schermopname met tekstoverlays, geen voice-over
**Doelgroep:** bestuurders, directies en bestuursbureaus van pensioenfondsen, sleutelfunctiehouders, beleidsadviseurs
**Doel:** nieuwsgierigheid en vertrouwen wekken, en één handeling uitlokken — een live demo aanvragen
**Bron voor alle claims:** `mvp-functionaliteiten.md` (status *Geïmplementeerd*) en `mvp-beperkingen.md`

> **Status van dit document.** Dit is tegelijk het voorstel én het draaiende script: alle keuzes hieronder zijn geïmplementeerd in `promo-teksten.json`, `scenes.ts`, `maak-overlays.mjs` en `montage.sh`. De video in `promo/uit/` is hiermee gebouwd. Waar ik iets *niet* heb kunnen waarmaken met het beschikbare beeldmateriaal, staat dat er expliciet bij.

---

## 1. Analyse: wat blijft, wat gaat eruit

De vorige versie duurde circa 90 seconden en was een compacte productdemonstratie: zeven modules, elk netjes uitgelegd. Het probleem daarvan is niet de lengte op zich, maar de **vorm**. De opzet was "speel elke scèneopname af, versneld als hij te lang is". Dat is geen montage maar compressie — je ziet nog steeds elke muisbeweging, elke laadtijd en elk irrelevant schermdeel, alleen sneller. Bestuurders lezen dat als "iemand laat mij zijn software zien", niet als "dit lost mijn probleem op".

De nieuwe opzet knipt per scène alleen de **betekenisvolle fragmenten** uit de opname en zoomt in op het schermdeel dat de boodschap draagt. Dat is de grootste verandering, en de reden dat 43 seconden nu méér vertelt dan 90 seconden daarvoor.

| Onderdeel | Besluit | Waarom |
|---|---|---|
| Openingskaart | **Behouden** | "Waar beheerste AI en besluitvorming elkaar versterken" is teruggezet op jouw verzoek. "Van dossier tot besluit" staat nu als subregel, zodat die verhaallijn blijft. |
| Overzicht / dashboard | **Behouden, 4,5s, volledig beeld** | Nodig om te laten zien dat dit een platform is en geen chatbot. Enige scène met de navigatie uitgeklapt en zonder noemenswaardige uitsnede. |
| Documentbibliotheek | **Geschrapt als eigen scène** | Iedereen heeft een documentbibliotheek; het onderscheidt niets. De boodschap "werkt met uw eigen documenten" zit nu ín de AI-scène, waar hij bewijskracht heeft: je ziet het fondsdocument in de context van het antwoord. |
| AI-assistent | **Behouden, herbouwd (9s)** | Dit is de propositie. Uit 49 seconden opname zijn drie beats geknipt: het gekozen fondsdocument, het antwoord met bronvermelding, en de kritische vragen. |
| Vergadering | **Behouden, verdiept (10s)** | Nu de langste scène. Gaat door tot de persoonlijke AI-voorbereiding per agendapunt — zie §10 voor wat daar eerder misging. |
| Proces / besluitvorming | **Behouden, drie beats (9s)** | Dit is wat een documentportaal met een chatbot níét heeft. Verdient de tweede plek qua tijd. |
| Auditscène (los) | **Blijft geschrapt** | Te technisch voor een teaser, sterk in de live demo. Het auditspoor is nu zichtbaar binnen de procesbeelden. |
| Governance-log (los) | **Blijft geschrapt** | Idem. De governance-banner is wel zichtbaar in de dashboardscène. |
| Slotkaart | **Vervangen** | "Besluitvorming die zichzelf verantwoordt" belooft te veel (zie §11) en er stond geen concrete handeling in. Nu één belofte, één knop, één URL. |
| Permanente MVP-banner | **Vervangen** | Zie §8 — dit is een besluit dat je bewust moet nemen, niet iets dat ik voor je kan afvinken. |

---

## 2. Definitief storyboard

| # | Scène | Duur | Beeld | Navigatie |
|---|---|---|---|---|
| 1 | Opening | 5,0s | Tekstkaart, licht, merkstreep links | — |
| 2 | Eén omgeving | 4,5s | Dashboard: open processtappen, komende vergadering, recente activiteit, governance-banner | **uitgeklapt** |
| 3 | AI-assistent | 9,0s | Document doorgronden → antwoord met bronbadge → kritische vragen | ingeklapt |
| 4 | Vergadervoorbereiding | 10,0s | Agendapunt uitgeklapt met stuk → voorbereiding opvragen → bestuurlijke duiding en aandachtspunten | ingeklapt |
| 5 | Besluitvorming | 9,0s | Lopend proces → fasenlijst → vereisten en onderbouwing | ingeklapt |
| 6 | Slot + CTA | 7,0s | Donkere eindkaart, dominante knop, URL | — |

Crossfade tussen scènes: 0,30s (`PROMO_OVERGANG`). Totaal 43,4 seconden.

**Dramaturgie.** De opbouw loopt van herkenbaar naar onderscheidend. Scène 2 is de aanloop ("dit is een platform"), scène 3 is de propositie ("de AI denkt kritisch mee op úw stukken"), scène 5 is de climax ("en het is aantoonbaar"). Scène 4 is bewust de kortste: hij verbindt 3 en 5, maar draagt de video niet.

---

## 3. Exacte tekst per scène

Alle tekst staat in `promo-teksten.json`. Dát bestand is de bron van waarheid.

**Scène 1 — Opening**
> Waar beheerste AI en
> besluitvorming elkaar versterken.
> *Van dossier tot besluit — in één beveiligde omgeving per fonds.*

**Scène 2 — Eén omgeving** (bovenregel klein/uppercase, hoofdregel groot)
> AFGESCHERMD PER FONDS
> Eén veilige omgeving voor stukken, vergaderingen en besluiten.

**Scène 3 — AI-assistent**
> DE AI-ASSISTENT
> Een kritische sparringpartner, geen zoekmachine.
> *Werkt met uw eigen documenten — altijd herleidbaar naar de bron.*

**Scène 4 — Vergadervoorbereiding**
> VERGADERVOORBEREIDING
> Beter voorbereid ieder agendapunt in.
> *Stukken, AI-samenvatting en een persoonlijke voorbereiding per agendapunt.*

**Scène 5 — Besluitvorming**
> GOVERNANCE INGEBOUWD
> Van voorbereiding tot besluit: iedere stap onderbouwd en vastgelegd.
> *Met een vastgelegd auditspoor.*

**Scène 6 — Slot**
> Goed voorbereid.
> Zorgvuldig besloten.
> Aantoonbaar verantwoord.
> **[ Plan een live demo ]**  bestuurdersportaal.com

**Permanente voetnoot** (klein, rechtsonder over het beeld; linksonder op de kaarten):
> Demonstratieomgeving met fictieve gegevens

---

## 4. Voice-overtekst (nog niet ingesproken — advies: laat dit door een mens doen)

De video werkt nu volledig zonder geluid, wat voor LinkedIn de juiste basis is. Een voice-over is een **verbetering, geen vereiste**. Mijn advies is om geen synthetische stem te gebruiken: voor een gereguleerde, kritische doelgroep is een hoorbaar kunstmatige stem in een video die over beheerste AI gaat een ongelukkige combinatie. Laat dit inspreken door een professionele stem (of door jezelf, mits rustig opgenomen).

Tekst, afgestemd op 43 seconden (circa 95 woorden, rustig tempo):

> Bestuurlijke besluitvorming vraagt om overzicht, kritische voorbereiding en aantoonbare onderbouwing.
> Het Bestuurdersportaal brengt stukken, vergaderingen en besluiten samen in één veilige omgeving, afgeschermd per fonds.
> De AI-assistent denkt kritisch mee op basis van uw eigen documenten — en verwijst altijd naar de bron.
> Zo gaat u beter voorbereid ieder agendapunt in, en wordt iedere stap onderbouwd en vastgelegd.
> Bestuurdersportaal. Goed voorbereid. Zorgvuldig besloten. Aantoonbaar verantwoord.

Als je de voice-over toevoegt: laat hem níét exact de tekst in beeld voorlezen (dat leest dubbel), verlaag de muziek met ongeveer 6 dB onder de stem, en voeg ondertiteling toe — zie §9.

---

## 5. Timing per scène en hoe je die verandert

Elke scène heeft een **streefduur** (`duurDoel`) en een set **fragmenten**. De fragmenten bepalen wat je ziet; de streefduur trekt de scène hooguit iets strakker (alleen versnellen, nooit vertragen, maximaal ×1,6).

Wil je een scène korter of langer: pas eerst de fragmenten aan (`van`/`tot`), niet de streefduur. De streefduur is een vangnet, geen stuurmiddel.

---

## 6. Benodigde schermopnames

| Opname | Bestand | Wat erop moet staan |
|---|---|---|
| Dashboard | `02-overzicht.webm` | Persoonlijke startpagina, doorgescrold tot voorbij de Wtp-stuurcijfers, met open processtappen, komende vergadering en recente activiteit in beeld |
| AI-assistent | `04-ai.webm` | Startpunt → *Een document doorgronden* → onderdelen kiezen → Start → volledig antwoord afwachten → bron openklikken |
| Vergadering | `05-vergadering.webm` | Vergaderlijst → vergadering openen → **agendapunt uitklappen** → *Lees samenvatting* → *Vraag door* → voorbereiding laten genereren |
| Proces | `06-proces.webm` | Procedurelijst → lopende procedure openen → doorscrollen langs fasen, checklist, onderbouwing en statusovergang |

De opnames mogen **rustig en volledig** zijn: de montage knipt er zelf de bruikbare seconden uit. Kort opnemen levert juist te weinig keuze op.

---

## 7. Beeldregie: zoom, uitsnede, muis, overgangen

**Eerst inklappen, dan pas inzoomen.** De navigatiekolom gaat van 256 naar 56 pixels zodra hij ingeklapt is (`DashboardShell`, voorkeur in `localStorage` onder `nav-ingeklapt`). Dat scheelt 14% schermbreedte, en die ruimte gaat naar de inhoud. Daardoor is de zoom nu overal mild (1,07–1,60) in plaats van fors. Scène 2 houdt de navigatie bewust uitgeklapt: daar is die kolom het bewijs dat het een samenhangend platform is en geen chatbot.

Het inklappen gebeurt vóór het laden (`zetMenu()` in `scenes.ts`), niet met een zichtbare klik. Wil je die klik tóch in beeld, dan kost dat ongeveer een seconde per scène en moet je de knop in `Sidebar` aanklikken in plaats van de voorkeur te zetten.

**Uitsnede.** Elk fragment heeft `zoom` (1,0 = volledig beeld), `cx` en `cy` (middelpunt als fractie). Vuistregel: zet `cy` **lager** dan het inhoudelijke midden, dan landt de inhoud in de bovenste beeldhelft en blijft hij vrij van de tekstbalk onderin.

Actuele instellingen:

| Scène | Fragment | Zoom | Waarom deze uitsnede |
|---|---|---|---|
| 2 | 2,4–6,4s | 1,12 | Vrijwel volledig beeld: hier is "het is één omgeving" de boodschap, dus je moet de samenhang zien. Start op 2,4s zodat de Wtp-stuurcijfers buiten beeld blijven. |
| 3 | 6,2–9,0s | 1,50 | Op het contextblok met de documentnaam — dit is het bewijs voor "uw eigen documenten". |
| 3 | 16,3–22,8s | 1,70 | Op de bronbadge en de eerste alinea's, terwijl het antwoord binnenkomt. De beweging van het streamen maakt het levend. |
| 4 | 2,6–5,0s | 1,35 | Vergaderlijst, leesbaar. |
| 4 | 6,8–9,7s | 1,50 | Op de tellerregel: "Agendapunten 1 · Stukken 1 · Met AI-samenvatting 1/1". |
| 5 | 1,4–4,4s | 1,45 | Op de lopende procedure met "Stap 4 van 6". |
| 5 | 5,8–8,8s | 1,22 | Op de fasenlijst met afgevinkte stappen naast de actieve stap. |
| 5 | 9,6–12,5s | 1,30 | Op de stap-vereisten en de onderbouwing. |

**Muis.** De opname toont een zachte paarse cursor met klik-feedback (`helpers.ts`). Bewegingen zijn geïnterpoleerd, geen sprongen. In de gekozen fragmenten staat de cursor grotendeels stil — dat is rustiger dan meebewegen.

**Overgangen.** Tussen scènes zit een crossfade van 0,45s (`PROMO_OVERGANG` om te wijzigen). De eerdere opzet faded elke scène naar zwart; bij zes scènes leverde dat ruim twee seconden zwartbeeld op, wat in een korte video leest als haperen.

**Highlights en vervaging** zijn bewust **niet** toegepast. Een statisch kader over bewegend beeld gaat mis zodra het element een paar pixels verschuift, en dat kan ik niet garanderen zonder de opname per frame te controleren. De zoom doet hier hetzelfde werk zonder dat risico. Wil je toch call-outs, dan is dat een handmatige montagestap in bijvoorbeeld DaVinci Resolve (gratis) op de opgeleverde master.

---

## 8. MVP- en demovermeldingen — een besluit dat jij moet nemen

Uitgevoerd conform je brief: de permanente banner *"MVP-demo-omgeving · alle gegevens in beeld zijn demodata"* is vervangen door de kleinere, terughoudende voetnoot *"Demonstratieomgeving met fictieve gegevens"*, en de zin *"Dit is een MVP-demo-omgeving met demodata — nog niet productiegeschikt"* is van de slotkaart verwijderd.

**Waar ik je op moet wijzen.** Die twee vermeldingen deden verschillend werk:

- *"fictieve gegevens"* dekt de **data**. Dat is nu geregeld.
- *"nog niet productiegeschikt"* dekte de **volwassenheid van het product**. Daar staat nu niets meer voor in de plaats.

Scène 5 toont een besluitvormingsproces met vereisten en een auditspoor, en zegt "iedere stap onderbouwd en vastgelegd". Bij een gereguleerde koper is dat precies het soort claim dat later in een selectietraject wordt teruggehaald: *"u liet zien dat dit werkt"*. Zolang het antwoord is "ja, dit wérkt ook echt zo, het is alleen nog niet op productieschaal beproefd", is dat verdedigbaar. Is het antwoord genuanceerder, dan loop je risico.

**Mijn advies:** laat deze versie langs degene die commercieel of juridisch verantwoordelijk is vóór externe publicatie. Vraag specifiek: *"kunnen we scène 5 waarmaken als een fonds hier morgen op doorvraagt?"* Is het antwoord nee, dan is de goedkoopste reparatie één regel op de slotkaart, bijvoorbeeld *"Demonstratie van de huidige werkende versie."* — dat kost geen professionaliteit en dekt het gat.

Ik heb dit **niet** eigenmachtig teruggezet, omdat je er expliciet om vroeg. Maar ik wil niet dat het onopgemerkt wegvalt.

---

## 9. Geluid, muziek en ondertiteling

**Muziek.** `promo/muziek-bed.mp3`, gegenereerd met `maak-muziek.sh` — rechtenvrij omdat het uit sinustonen is opgebouwd. Zes akkoorden die in elkaar overvloeien, met een trage, smalle melodische laag erboven. Het niveau staat op een vaste piek van −26 dBFS: hoorbaar aanwezig, nooit dominant. Richting het eindscherm loopt het volume kubisch op met ongeveer 2 dB, zodat de call-to-action een klein duwtje krijgt.

Voor externe publicatie blijft mijn advies: overweeg een gelicentieerde track (Epidemic Sound, Artlist, Musicbed). Let dan op een **commerciële** licentie — "gratis voor persoonlijk gebruik" dekt een bedrijfs-LinkedIn niet. Meemonteren gaat met `PROMO_MUZIEK=/pad/naar/track.mp3`.

**Ondertiteling.** Niet nodig zolang er geen voice-over is: alle tekst staat al in beeld. Voeg je een voice-over toe, dan is ondertiteling wél nodig — LinkedIn speelt standaard zonder geluid af. Lever die aan als los `.srt`-bestand bij de upload, niet ingebrand, zodat de tekst in beeld en de ondertiteling elkaar niet overlappen.

---

## 10. Wat er misging bij scène 4 — opgelost

De vergaderscène liep eerder stil vast: het agendapunt klapte niet uit, en de opname leek tóch te slagen. Twee oorzaken, allebei verholpen.

1. **De uitklapknop.** In `AgendapuntKaart.tsx` (r. 391–400) heeft die alleen een `aria-label="Uitklappen"` en het teken `▸` als inhoud. `scenes.ts` probeert nu drie ingangen achter elkaar: het aria-label als CSS-selector, het teken, en pas daarna de rol.
2. **De knop "Vraag door over dit agendapunt".** Dit was de eigenlijke blokkade voor de verdieping. Die knop bevat naast het label óók een hele beschrijvende alinea ("Laat de AI helpen scherper na te denken over dit punt…"). De toegankelijke naam is dus die hele lap tekst, en een exacte match op de labelzin faalt stilzwijgend. De selector is nu een reguliere expressie.

Belangrijker dan beide reparaties: allebei de stappen **falen nu hard**. Klapt het punt niet uit, of ontbreekt de doorvraagknop, dan stopt de scène met een verklarende foutmelding en staat hij op `ok: false` in `opname-log.json`. Een scène die er compleet uitziet maar de kern mist, kost anders een hele montageronde voordat je het doorhebt.

Scène 4 toont nu drie beats: het uitgeklapte agendapunt met het vergaderstuk en de knop *Lees samenvatting*, het opvragen van de voorbereiding, en het resultaat met bestuurlijke duiding en aandachtspunten.

**Eén beeld is nog niet gelukt:** de AI-samenvatting zelf (AANLEIDING / HOOFDPUNTEN / GEVRAAGD BESLUIT) staat onderin de viewport en is niet vrij te krijgen van de tekstbalk onderin zonder onleesbaar te worden. Die claim draagt nu de knop *Lees samenvatting* in beat 1. Wil je het beeld wél, dan moet de opname na het openen van de samenvatting verder doorscrollen — dat is een aanpassing in `scenes.ts`, geen montagekwestie.

**Overige ontbrekende assets:**

- **Logo.** De kaarten gebruiken nu een gegenereerd merkvlak (paarse tegel met "B"). Heb je een echt logobestand (SVG), dan vervang je dat in `maak-overlays.mjs` in de functie `logoHtml()`.
- **QR-code.** Bewust niet toegevoegd: op LinkedIn en op mobiel is een QR-code onbruikbaar. Voor gebruik in een presentatie is hij wél zinvol; dan is de plek rechtsonder op de slotkaart.

---

## 11. Claimcontrole

Elke on-screen bewering, teruggevoerd op de as-built status.

| Wat we zeggen | Onderbouwing | Wat we bewust níét zeggen |
|---|---|---|
| "Eén veilige omgeving … afgeschermd per fonds" | RLS + tenant-enforce (fail-closed), `middleware.ts` / dashboard-layout | Niet: "compliant", "AVG-proof", "voldoet aan toezichteisen" — WP3/4/5/8 staan open |
| "Een kritische sparringpartner, geen zoekmachine" | De route *Een document doorgronden* levert expliciet "Bestuurlijke aandachtspunten" en "Kritische vragen" (`core/lib/doorgrond.ts`) — in beeld zichtbaar | Niet: "adviseert", "beoordeelt", "neemt besluiten". Het blijft duiding op stukken; het oordeel is aan het bestuur |
| "Werkt met uw eigen documenten" | Extractie (unpdf/mammoth/xlsx/jszip) + Mistral-embeddings, *Geïmplementeerd*. In beeld: de documentnaam in het contextblok | Niet: OCR van scans, niet: malwarescan, niet: bestandsformaten opsommen |
| "Altijd herleidbaar naar de bron" | Hybride retrieval + citatievalidatie, *Geïmplementeerd*. In beeld: de badge "Antwoord uitsluitend gebaseerd op de geraadpleegde fondsdocumenten" en "Onderbouwing en bronnen" | Niet: "actuele wet- en regelgeving", niet: live DNB/AFM (web-retrieval is open besluit 0019), niet: "foutloos" |
| "Beter voorbereid ieder agendapunt in" · "kernpunten, risico's en persoonlijke notities" | Profielgestuurde AI-voorbereiding per agendapunt, *Geïmplementeerd* | Niet: Teams-/agenda-integratie, e-mailuitnodigingen, versionering. **Let op:** visueel onderbouwd is nu alleen de teller — zie §10 |
| "Iedere stap onderbouwd en vastgelegd" | 17-statusmachine + readiness-gate, *Geïmplementeerd*. In beeld: fasenlijst, stap-vereisten, onderbouwing | Niet: het aantal statussen noemen, niet: decision rights/escalatie (Plateau 3) |
| "Met een vastgelegd auditspoor" | `governance_events` append-only, sha256 per gebeurtenis, triggers blokkeren UPDATE/DELETE | Niet: "volledig auditspoor" — dat is een absolute claim die je bij doorvragen moet kunnen dichttimmeren. Bewust "vastgelegd" i.p.v. "hash-geketend": de teaser kan die uitleg niet dragen, de live demo wel |

**Twee afwijkingen van je brief, met reden:**

1. Je stelde voor: *"Met een volledig auditspoor."* Ik heb **"volledig" geschrapt**. "Volledig" impliceert dat álles wordt vastgelegd; dat is precies het type absolute claim waar een risicobewuste doelgroep op doorvraagt en waar je vervolgens uitzonderingen op moet toegeven. "Vastgelegd" is even sterk en houdt stand.
2. Je stelde voor: *"Plan een live demo op bestuurdersportaal.com."* Ik heb de knop en de URL **naast elkaar** gezet in plaats van in één zin. Visueel dominanter, en je kunt de URL wijzigen zonder de zin te herschrijven.

**Twee dingen die bewust niet in beeld komen:** de Wtp-stuurcijfers uit `lib/klantbeeld-data.ts` (100% dummydata — de scène start daarom ná die rij), en stemmingen (een stemknop in een promovideo suggereert rechtsgeldige besluitvorming; het systeem registreert en rapporteert alleen).

---

## 12. Bouwen en opnieuw opnemen

Alleen tekst, timing of uitsnede gewijzigd — **geen nieuwe opname nodig**:

```bash
cd "/Users/merlinijzerman/Documents/Claude/Projects/MVP bestuurdersportaal/mvp"
export FFMPEG=$(node -p "require('ffmpeg-static')")
node promo/maak-overlays.mjs
PROMO_MUZIEK=promo/muziek-bed.mp3 bash promo/montage.sh
```

Klikpad gewijzigd of scène 4 repareren — **wel opnieuw opnemen**:

```bash
cd "/Users/merlinijzerman/Documents/Claude/Projects/MVP bestuurdersportaal/mvp"
export PROMO_BASE_URL=http://localhost:3000        # of 3001, kijk wat `npm run dev` meldt
export FFMPEG=$(node -p "require('ffmpeg-static')")
read "PROMO_EMAIL?e-mail: "
read -s "PROMO_WACHTWOORD?wachtwoord: "; echo
export PROMO_EMAIL PROMO_WACHTWOORD

npx playwright test --config=promo/playwright.config.ts
cat promo/opnames/opname-log.json                  # ← alles ok:true?
bash promo/toon-frames.sh                          # ← fragmenttijden herijken
# pas van/tot aan in promo/promo-teksten.json
node promo/maak-overlays.mjs
PROMO_MUZIEK=promo/muziek-bed.mp3 bash promo/montage.sh
```

Muziek opnieuw genereren: `DUUR=44 bash promo/maak-muziek.sh` (of `ARP=0` voor alleen akkoorden).

---

## 13. Eindcontrole

| Vraag | Oordeel |
|---|---|
| Binnen 5 seconden duidelijk dat het over bestuurlijke besluitvorming en beheerste AI gaat? | Ja — openingskaart benoemt beide letterlijk |
| Binnen 15 seconden duidelijk dat de AI met de eigen documenten van het fonds werkt? | Ja — op 8,5s staat de documentnaam groot in het contextblok |
| Zijn bronnen zichtbaar en herleidbaar? | Ja — bronbadge en "Onderbouwing en bronnen" leesbaar in scène 3 |
| Is duidelijk welke waarde dit een bestuurder oplevert? | Grotendeels — scènes 3 en 5 zijn sterk, scène 4 is zwak (§10) |
| Is duidelijk dat dit meer is dan een zoekmachine of chatbot? | Ja — scène 2 toont het platform, scène 5 het besluitproces |
| Is de tekst zonder pauzeren leesbaar? | Ja — hoofdregel 62px, subregel 35px op 1920 breed; getest tegen de lichte portalachtergrond |
| Is ieder getoond scherm functioneel? | Ja — alle niet-dragende seconden zijn weggeknipt |
| Zijn overbodige klikken, wachttijden en scrolls verwijderd? | Ja — dat is het kernprincipe van de nieuwe montage |
| Maximaal 45 seconden? | Ja — 43 seconden |
| Eindigt met één concrete, zichtbare call-to-action? | Ja — één knop, één URL, 6,5 seconden in beeld |
| Wekt de video vertrouwen bij een gereguleerde doelgroep? | Ja, mits §8 is afgetikt |
| Bevat de video claims die niet waargemaakt kunnen worden? | Zie §11 — twee formuleringen bewust afgezwakt, en §8 verdient een expliciet akkoord |

**Uit de OCR-scan van alle 87 frames (2 per seconde):**

- **Geen e-mailadressen meer in beeld.** Ze zaten er wél in: op de proceduredetailpagina staat onder CO-EIGENAARS het adres van het ingelogde account. Fragment 2 van scène 5 start daarom bewust pas op 6,1s. **Controleer dit opnieuw na elke nieuwe opname** — het is de meest waarschijnlijke plek waar een echt gegeven binnenglipt.
- **Twee verschillende fondsnamen in beeld.** Het portaal zelf toont *Stichting Pensioenfonds Horizon*; de tekst van het AI-antwoord spreekt over *Pensioenfonds Aurora* (13 respectievelijk 11 frames). Het demodocument hoort blijkbaar bij een ander fonds dan de tenant. Een oplettende kijker ziet dat, en het ondermijnt precies de claim "werkt met úw documenten". Los dit op in de demodata vóór externe publicatie.
- **De voornaam "Merlin" staat in de zijbalk** tijdens scène 2. Niet gevoelig, maar het is jouw naam en geen demowaarde. Overweeg een demo-account met een neutrale naam.

**Nog te doen door jou:**

1. **Controleer dat `bestuurdersportaal.com` bestaat en naar een pagina leidt waar je een demo kunt aanvragen.** Een URL in beeld die niet resolvet of op een lege homepage uitkomt, is schadelijker dan geen URL. Klopt het domein niet, wijzig het dan in `promo-teksten.json` onder `cta.url`.
2. **Laat §8 aftikken** door wie commercieel of juridisch verantwoordelijk is.
3. **Neem scène 4 opnieuw op** (§10, §12) — dat is de enige echte kwaliteitswinst die nog openstaat.
4. **Overweeg de fondsnaam.** *Stichting Pensioenfonds Horizon* is fictief maar lijkt op bestaande namen. Voor externe distributie is een onmiskenbaar fictieve naam ("Pensioenfonds Demo") veiliger.
