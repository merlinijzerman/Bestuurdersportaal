# Website v0.8 — productie-overdracht

**Status 11 september 2026:** live op `main`. De hoofdrelease is gemerged via
PR #365; de vereenvoudigde privacyverklaring en generieke contactintro via
PR #374 (`b171ee5`). Ontwerp en copy komen uit `website-mockup-v0.8/` in de
projectmap; die mockup is akkoord bevonden.

## Wijzigingen

**Opmaak (`app/(public)/public.css`)**
- Palet vervangen door het app-palet achter de login: `#EEF1F6` als vlak, witte
  panelen, ink `#12233B`, navy `#234E70`, lijnen `#DFE5EE`. Het warme crème is weg.
- De volledige donkere themavariant is verwijderd.
- Achteraan staat een v0.8-componentlaag (secties, productkaarten, bio's,
  CTA-paneel). Die staat bewust als laatste: waar een oude regel botst, wint deze.

**Layout (`app/(public)/layout.tsx`)**
- Themabootstrap eruit (geen `data-theme` meer).
- Sitebrede metadata bijgewerkt, inclusief `og:image` (1200 × 630) en
  `twitter:card = summary_large_image`.

**Navigatie (`_components/Header.tsx`, `MobileMenu.tsx`, `Footer.tsx`)**
- Vier items: Werkwijze · Product · Voor wie · AI & governance.
- Primaire CTA overal "Plan een live demo" in plaats van "Neem contact op".
- ThemeToggle wordt niet meer gebruikt (het bestand staat er nog; opruimen kan in
  een aparte opschoonstap).

**Pagina's**
| Route | Wat |
|---|---|
| `/` | Nieuwe homepage: productomschrijving, drie momenten, bestuurlijk geheugen, zes productfragmenten, brongebonden AI, pilot-CTA |
| `/product` | Per module één sectie met het bijbehorende productfragment |
| `/voor-wie` | Samenvoeging van de oude /voor-wie, /sectoren en /sectoren/pensioenfondsen |
| `/sectoren`, `/sectoren/pensioenfondsen` | Permanente redirect naar `/voor-wie` |
| `/governance-ai` | Herzien; kop losgetrokken van de homepagekop |
| `/over-ons` | Opent met de visie, daarna oprichters met bio's en LinkedIn, werkprincipes, volg-ons-strook |
| `/contact` | Generieke introductie zonder vaste duur of voorgeschreven demo-opzet; bestaand formulier ongewijzigd. `noindex` |
| `/privacy` | Beknopte verklaring in vijf onderdelen; `Bestuurdersportaal.com` als verantwoordelijke zonder postadres; Vercel Analytics en Cloudflare Turnstile benoemd. Versie `2026-09-11`. `noindex` |

**Beelden (`public/website/`)**
Zes productfragmenten (1200 × 675) plus `og-image.png` (1200 × 630).

**Vindbaarheid (`app/sitemap.ts`)**
`/sectoren`, `/sectoren/pensioenfondsen`, `/contact` en `/privacy` zijn eruit —
de eerste twee zijn redirects, de laatste twee dragen `noindex`.

## Productiecontrole 11 september 2026

- Beide Vercel-productiedeployments waren groen.
- `/privacy` en `/contact` zijn visueel gecontroleerd op desktop en 390 × 844;
  geen horizontale overflow of afgebroken formulieronderdelen.
- Een echte herkenbare testinzending gaf de succesmelding en verscheen in de
  beveiligde contact-inbox. De test is daarna als afgehandeld gemarkeerd.
- De interne notificatiemail is **niet** verzonden: de Mailgun-configuratie in
  Vercel is onvolledig. Opslag is soft-fail-onafhankelijk en werkt wel. Zie
  `SETUP.md` stap 8.

## Nog te doen na livegang

1. **Mailgun-notificaties activeren:** zet `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`,
   `CONTACT_NOTIFY_FROM` en `CONTACT_NOTIFY_TO` in het publieke Vercel-project
   voor Production en preview-stable, redeploy en herhaal de mail-smoke.
2. **Portretfoto's** op `/over-ons`: nu staan er initialen in een cirkel.
   Vierkant, minimaal 400 × 400, in `public/website/`.
3. **DemoVideo en ThemeToggle** worden nergens meer gebruikt. De componenten en
   `public/video/*` kunnen weg in een opschoonstap.
4. **`_components/CtaBand.tsx`, `Flow.tsx`, `Steps.tsx`, `DossierKaart.tsx`,
   `Crumb.tsx`** worden alleen nog door `/governance-ai/eu-ai-act` gebruikt.
   Die pagina is in deze ronde niet herzien.
5. **Deelkaarten in cache.** Na livegang halen LinkedIn en WhatsApp de oude kaart
   uit hun cache. Eén keer verversen via de debugger van het betreffende platform.
6. **Resterende nazorgcontrole:** `/sectoren` → `/voor-wie` (308), `robots.txt` en
   `sitemap.xml` op de marketing-host, en of `og:image` absoluut wordt uitgeserveerd.

## Wat bewust niet is aangepast

- De EU AI Act-subpagina (alleen de CTA-tekst is meegetrokken).
- Het contactformulier zelf; alleen de omliggende tekst en gekoppelde
  privacyversie zijn in PR #374 gewijzigd.
