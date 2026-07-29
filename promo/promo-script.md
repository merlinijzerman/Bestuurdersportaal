# Promoscript — Bestuurdersportaal (teaser, 69 sec)

**Versie:** 2026-07-29
**Doel:** interesse wekken bij bestuurders/bestuursbureaus van pensioenfondsen én positionering op LinkedIn.
**Vorm:** schermopname met tekstoverlays, geen voice-over, geluidloos begrijpelijk.
**Distributie:** 16:9 master (website, pitchbijlage) + 4:5 variant (LinkedIn-feed).
**Bron voor alle claims:** `mvp-functionaliteiten.md` (status *Geïmplementeerd*) en `mvp-beperkingen.md`.

> **Werkhypothese die validatie vraagt:** ik ga ervan uit dat deze video ook naar buiten gaat richting potentiële klantfondsen, niet alleen naar mede-initiatiefnemers. Daarom is elke claim beperkt tot wat as-built werkt en staat de MVP-disclaimer permanent in beeld. Klopt die aanname niet, dan kan de toon losser.

---

## 1. Storyboard

| # | Scène | Duur | Beeld | Kop (klein, uppercase) | Regel (groot) |
|---|---|---|---|---|---|
| 01 | Opening | 5s | Tekstkaart | — | *Waar beheerste AI en besluitvorming elkaar versterken.* |
| 02 | Overzicht | 10s | Home → Stuurinformatie | Eén omgeving per fonds | Stukken, vergaderingen, processen en risico's bij elkaar — afgeschermd per fonds. |
| 03 | Bibliotheek | 8s | Documentbibliotheek, scroll | Uw eigen documenten als kennisbasis | PDF, Word, Excel en PowerPoint worden geëxtraheerd en doorzoekbaar gemaakt. |
| 04 | AI-assistent | 20s | *Een document doorgronden* → onderdelen kiezen → Start → antwoord → bron openklikken | Sparringpartner, geen zoekmachine | De AI-assistent denkt met u mee over uw eigen stukken: aandachtspunten, kritische vragen — altijd met bron. |
| 05 | Vergadering | 16s | Vergadering → agendapunt uitklappen → *Lees samenvatting* → *Vraag door* → voorbereiding genereren | Voorbereid de vergadering in | Stukken per agendapunt, een AI-samenvatting en een privé voorbereiding. |
| 06 | Proces | 14s | Processen → Decision Object, statusgang, doorscrollen naar het auditspoor | Governance by design | Elk besluit doorloopt een vaste statusgang — met verplichte onderbouwing en een vastgelegd auditspoor. |
| 09 | Slot | 6s | Tekstkaart | — | MVP-disclaimer + call to action |

**Totaal: 69 seconden.**

**Dramaturgie.** De opbouw is bewust *van herkenbaar naar onderscheidend*: iedereen heeft een documentbibliotheek, bijna niemand heeft een besluit-statusmachine met een append-only auditspoor. Scène 06 is de kern én de climax; daar zit de meeste tijd en daar moet de kijker blijven hangen. Scène 02–03 zijn de aanloop en mogen als eerste sneuvelen als het nóg korter moet (dan kom je op ~51s uit).

**Wat er is geschrapt en wat dat kost.** De losse auditscène (export van het dossier) en de governance-logscène zijn eruit; de video is daarmee van 87 naar 69 seconden gegaan. Twee kanttekeningen:

- Het auditspoor is precies het punt waarop dit product zich onderscheidt van een documentportaal met een chatbot. Daarom is de regel bij scène 06 uitgebreid met "en een vastgelegd auditspoor" en scrolt de opname op de detailpagina door naar dat gedeelte. Zo blijft het zichtbaar zonder eigen scène. Vind je dat te veel in één regel: haal het eruit, maar wees je ervan bewust dat de teaser dan vooral "handig AI-portaal" communiceert en niet "controleerbare besluitvorming".
- Het governance-log liet zien dat het AI-gebruik zelf wordt vastgelegd. Dat argument is in een gesprek met een bestuur sterk, maar in 7 seconden zonder toelichting zwak — dat schrappen kost weinig. Bewaar het voor de live demo.

Alle teksten staan in `promo-teksten.json`. Dát bestand is de bron van waarheid — wijzig daar, niet in de code.

---

## 2. Claimverantwoording

Elke regel in de video is teruggevoerd op een as-built status. Wat expliciet **niet** gezegd wordt en waarom:

| Wat we zeggen | Onderbouwing | Wat we bewust níét zeggen |
|---|---|---|
| "afgeschermd per fonds" | RLS + tenant-enforce (fail-closed), `middleware.ts` / dashboard-layout | Niet: "veilig", "compliant", "AVG-proof" — WP3/4/5/8 staan open |
| "geëxtraheerd en doorzoekbaar" | unpdf/mammoth/xlsx/jszip + Mistral-embeddings, *Geïmplementeerd* | Niet: OCR van scans (zit niet op de tenant-uploadroute); niet: malwarescan |
| "sparringpartner… denkt met u mee" | Positioneringsclaim, gedekt door wat in beeld staat: de route *Een document doorgronden* levert expliciet "Bestuurlijke aandachtspunten" en "Kritische vragen" (`core/lib/doorgrond.ts`) | Niet: "adviseert" of "beoordeelt" — het blijft duiding op stukken, de toetsing is aan het bestuur |
| "altijd met bron" | Hybride retrieval + citatievalidatie, *Geïmplementeerd* | Niet: "actuele wet- en regelgeving" of live DNB/AFM — web-retrieval is een open besluit (0019); niet: "foutloos" |
| "privé AI-voorbereiding per agendapunt" | *Geïmplementeerd* (profielgestuurd) | Niet: Teams-/agenda-integratie, e-mailuitnodigingen, versionering van stukken |
| "vaste statusgang met verplichte onderbouwing" | 17-statusmachine + readiness-gate, *Geïmplementeerd* | Niet: aantal statussen noemen in beeld (nodigt uit tot doorvragen dat de teaser niet kan dragen); niet: decision rights/escalatie (Plateau 3) |
| "een vastgelegd auditspoor" | `governance_events` append-only, sha256 per gebeurtenis, triggers blokkeren UPDATE/DELETE | Niet: "voldoet aan toezichteisen" — dat is een oordeel van de toezichthouder, niet van ons. Bewust vaag gehouden ("vastgelegd" i.p.v. "hash-geketend"): de teaser kan de uitleg niet dragen, de live demo wel |

**Twee dingen die je op het scherm moet vermijden, niet alleen in de tekst:**

- **Klantbeeld / Wtp-stuurcijfers** zijn 100% dummydata (`lib/klantbeeld-data.ts`). Scène 02 eindigt op Stuurinformatie; als daar herkenbare cijfers in beeld komen, is de permanente badge "demodata" niet genoeg — overweeg die scène te laten eindigen op de home in plaats van het dashboard.
- **Stemmingen** zitten bewust niet in de teaser. Een stemknop in een promovideo suggereert rechtsgeldige besluitvorming; het systeem registreert en rapporteert alleen.

**Permanente disclaimer.** Rechtsboven staat in elk beeldshot: *"MVP-demo-omgeving · alle gegevens in beeld zijn demodata"*. Dit is geen kleine lettertjes-truc maar de manier waarop je een MVP naar buiten kunt brengen zonder later een verwachtingsdiscussie te krijgen. Weghalen zou ik afraden.

---

## 3. Preflight — vóór je opneemt

Deze checklist gaat over wat er ongemerkt in beeld komt. Loop hem letterlijk af.

- [ ] Ingelogd als een **demo-account** op het demo-fonds (*Stichting Pensioenfonds Horizon*), niet met je eigen account
- [ ] Gebruikersnaam en rol in de sidebar zijn demo-waarden
- [ ] Documentbibliotheek bevat **alleen** demodocumenten — geen echte fondsstukken, geen klantnamen in bestandsnamen
- [ ] Vergaderingen/agendapunten bevatten geen echte namen van bestuurders of adviseurs
- [ ] Notulen en inbreng bevatten geen citaten uit echte vergaderingen
- [ ] Beheer/gebruikersbeheer wordt **niet** getoond (e-mailadressen); staat ook niet in het script
- [ ] Browser: geen bookmarks, geen extensies, geen andere tabbladen in beeld (Playwright start schoon, maar controleer de eerste frames)
- [ ] De AI-vraag in `scenes.ts` (`AI_VRAAG`) levert in deze omgeving aantoonbaar een antwoord **mét** bronvermelding op — test hem één keer handmatig
- [ ] Eén procedure/Decision Object staat in een status die er inhoudelijk goed uitziet (niet leeg, niet halverwege een foutmelding) **en heeft een gevulde auditsectie onderaan de detailpagina** — daar eindigt de video op

---

## 4. Verificatie — na de montage

- [ ] Frame-voor-frame doorlopen op datalekken (namen, e-mailadressen, echte fondsnamen, bedragen)
- [ ] Elke on-screen claim opnieuw naast `mvp-functionaliteiten.md` gelegd
- [ ] Video met geluid **uit** bekeken: is elke scène begrijpelijk zonder context?
- [ ] 4:5-variant op een telefoon bekeken: is de onderregel leesbaar?
- [ ] Iemand die het portaal níét kent laten kijken: kan die na 69 seconden navertellen wat het product doet?
- [ ] Scène 06 eindigt op iets dat er af uitziet — het is nu het laatste beeld vóór de slotkaart
- [ ] Slotkaart: staat de MVP-disclaimer er nog in en klopt de call to action?

---

## 5. Openstaande keuzes voor jou

1. **Muziek of stilte.** Zonder voice-over voelt volledige stilte snel als een bug. Een rustige bedtrack (rechtenvrij) helpt; `montage.sh` ondersteunt `PROMO_MUZIEK=...`. LinkedIn speelt standaard zonder geluid af, dus de video moet ook stil werken — muziek is bonus, geen drager.
2. **Fondsnaam in beeld.** *Stichting Pensioenfonds Horizon* is fictief, maar lijkt op bestaande namen. Overweeg voor externe distributie een onmiskenbaar fictieve naam ("Pensioenfonds Demo").
3. **Waar landt de kijker?** De slotkaart zegt nu "neem contact op". Als de marketingsite een contactformulier heeft, zet daar de URL neer — anders is de call to action loos.
4. **Scène 02 eindpunt.** Home of Stuurinformatie? Zie het dummydata-punt hierboven.
