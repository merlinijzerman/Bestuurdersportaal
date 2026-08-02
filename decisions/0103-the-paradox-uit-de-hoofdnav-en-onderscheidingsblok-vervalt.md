# 0103 — The Paradox uit de hoofdnavigatie, onderscheidingsblok vervalt, promovideo op de homepage

- **Status:** Geaccepteerd
- **Datum:** 2026-08-02
- **Betrokkenen:** opdrachtgever (plansessie Cowork 2 augustus 2026), Claude Code
- **Raakt:** [0035](./0035-publieke-voorkant-richtingsbesluit-meerpagina.md), [0037](./0037-publieke-voorkant-fase1-bouwkeuzes.md), [0101](./0101-accentkleur-terug-naar-navy-d1-bestuursblauw.md)

## Context

De marketingsite presenteerde Bestuurdersportaal op twee manieren die niet meer
passen bij het product zoals het er nu staat.

Ten eerste als afgeleide van The Paradox: een eigen positie in de hoofdnavigatie
(externe link) plus een tweekolomsblok op de homepage. Voor een bezoeker die het
moederbedrijf niet kent, kost dat navigatieruimte zonder iets over het product te
zeggen, terwijl `/over-ons` — de pagina die het eigen verhaal zou moeten dragen —
bewust *niet* in de nav stond en inhoudelijk nagenoeg leeg was.

Ten tweede door zich af te zetten tegen andere categorieën. Het
onderscheidingsblok ("Geen documentportaal. Geen vergadertool. Geen losse
AI-chat.") met een vergelijkingstabel over vier oplossingscategorieën komt uit
copy v0.2 §10 en is in het contentplan v1.2 verankerd als commercieel kernblok:
§11 maakt het de rode draad over meerdere pagina's, regel 118 zet
"onderscheidingsblok aanwezig" in de acceptatiecriteria van de homepage, en
risico 5 wijst het aan als de mitigatie tegen "positionering vervlakt tot betere
tool".

Tegelijk lag er een promovideo (variant C) die de omgeving laat werken in plaats
van erover te lezen, maar die in huisstijl en call-to-action afwijkt van de site.

## Besluit

**1. The Paradox verlaat de hoofdnavigatie; "Over" komt ervoor in de plaats.**
`/over-ons` behoudt zijn URL en krijgt het label "Over". De herkomst blijft op
drie plaatsen zichtbaar: de hero-regel op de homepage ("Gebouwd op het
besluitvormingsdenken van The Paradox — …", bewust ongewijzigd), een ingekorte
sectie op de homepage, en de footer met de externe link. Het tweekolomsblok
verhuist naar `/over-ons`, waar het inhoudelijk thuishoort.

**2. Het onderscheidingsblok uit copy v0.2 §10 vervalt op de homepage.** De
sectie inclusief vergelijkingstabel is verwijderd; het `Cmp`-component is uit de
codebase weg. Dit is een positioneringsbesluit, geen opschoning.

**3. De promovideo krijgt een eigen sectie op de homepage**, direct onder "Uw
eigen omgeving" — daar staat de claim ("AI werkt met uw eigen documentatie en
besluitdossiers, met verwijzing naar de bron") waarvan de video het bewijs is.
Self-hosted vanuit `public/video/`, geen externe speler, geen autoplay.

**4. Drie conflicten in de video worden bewust geaccepteerd**, niet stilzwijgend
overgeslagen. Ze staan hieronder onder Gevolgen.

## Gevolgen

- **De site verliest zijn enige categorievergelijking.** Bezoekers die de
  categorie niet kennen, missen het referentiekader "waarin verschilt dit van wat
  wij al hebben?" — precies de vraag die in een bestuurlijk aankooptraject als
  eerste wordt gesteld. Wat overblijft aan differentiatie is `{/* RODE DRAAD */}`
  op `/product` ("Een besluitomgeving, geen portaal") en het
  AI-chat-onderscheid op `/governance-ai/eu-ai-act`. De vier categorieën uit
  contentplan §10 (klassiek bestuurdersportaal, DMS, GRC-tool, losse AI-chat)
  komen nergens meer samen in beeld.
- **Contentplan v1.2 wijkt hiermee af van de site.** §10, §11 en het
  acceptatiecriterium op regel 118 gelden niet meer voor de homepage, en risico 5
  staat zonder mitigatie. Dat is aangetekend in het contentplan zelf; wie het
  blok terug wil, herstelt niet alleen copy maar herstelt een verworpen besluit.
- **Een afgezwakte variant is expliciet niet gebouwd.** De optie om de
  differentiatie als één positieve alinea zonder tabel en zonder "geen X"-framing
  terug te laten komen op `/product` of `/over-ons` is voorgelegd en niet
  gekozen. Vervangende differentiatie-copy elders vraagt een apart akkoord.
- **De video wijkt af van de huisstijl.** Het merkteken en de eindknop zijn goud
  `#C8A24B` op navy `#0B1F3A`, terwijl de site navy `#234E70` gebruikt en de app
  per besluit [0101](./0101-accentkleur-terug-naar-navy-d1-bestuursblauw.md)
  naar diezelfde navy terug is. De video is daarmee een campagne-uiting met een
  eigen palet, niet een uiting in de huisstijl.
- **De video eindigt op een call-to-action die de site niet kent.** Het eindkader
  toont "Plan een live demo", terwijl de site overal "Neem contact op" hanteert —
  een afspraak die letterlijk in de code staat (`_components/Header.tsx`,
  Bouwoverdracht §1 punt 3: *nooit "Plan een demo"*). Op de homepage staan die
  twee daarmee in dezelfde viewport. Herstellen vraagt een nieuwe montage: de
  tekst zit in `promo/promo-teksten-c.json`, maar `promo/opnames-9x16-c/`
  ontbreekt lokaal, dus `montage.sh` kan hier niet draaien.
- **De preflight op fondsdata is steekproefsgewijs gedaan, niet uitputtend.**
  Negen frames verspreid over de film zijn bekeken; alles wat in beeld kwam was
  *Stichting Pensioenfonds Horizon* met fictieve gegevens, en de voettekst
  "Demonstratieomgeving met fictieve gegevens" staat in het eindkader. De volledige
  frame-voor-frame-controle uit `promo/promo-script.md` §13 blijft openstaan vóór
  externe publicatie.
- **Geen impact op tenantdata.** Geen RLS-, `fonds_id`-, datamodel-, migratie- of
  audit-wijziging; geen AI-functionaliteit; CSP ongewijzigd (`default-src 'self'`
  dekt self-hosted media, er is geen `media-src` nodig).
- **`/over-ons` stijgt in de sitemap** van `0.5 / yearly` naar `0.7 / monthly`,
  passend bij een hoofdnavigatie-item met eigen inhoud.

## Overwogen alternatieven

- **The Paradox in de nav laten en "Over" ernaast** — verworpen: zes items maken
  de nav te vol, en het probleem is juist dat het moederbedrijf navigatieruimte
  kost die het product zelf nodig heeft.
- **Ook de hero-regel over The Paradox schrappen** — verworpen. Dat is de gekozen
  middenweg: de herkomst blijft, maar krijgt geen navigatiepositie meer.
- **Alleen de vergelijkingstabel schrappen, de sectie laten staan** — voorgelegd
  en niet gekozen; de kop met de "geen X"-framing was juist het bezwaar.
- **De videosectie uitstellen tot variant C is afgetekend** — eerst gekozen, daarna
  herzien toen bleek dat er een bruikbare montage lag (`promo-9x16-c_10`, waarin
  scène 5 echte interactie toont in plaats van stand-in-materiaal).
- **Externe videoplayer (YouTube/Vimeo)** — verworpen: dat vraagt uitbreiding van
  `frame-src` én `script-src` in de CSP plus een cookiebanner-afweging, terwijl
  self-hosting binnen `default-src 'self'` past zonder één regel configuratie.

## Referenties

- `app/(public)/home/page.tsx`, `app/(public)/over-ons/page.tsx`
- `app/(public)/_components/Header.tsx`, `MobileMenu.tsx`, `Footer.tsx`, `DemoVideo.tsx`
- `app/(public)/public.css` (`.demo`, `.video-licht`, `.oprichters`, `.visie`)
- `public/video/promo-9x16.mp4`, `-poster.jpg`, `.nl.vtt`
- `promo/HANDOVER.md` §1 en §4, `promo/promo-teksten-c.json`, `promo/promo-script.md` §13
- `03 Functioneel ontwerp/Bestuurdersportaal - Publieke voorkant contentplan v1.2.md` §10, §11
