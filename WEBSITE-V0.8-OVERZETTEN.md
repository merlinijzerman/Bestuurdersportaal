# Website v0.8 — wat er op deze branch staat

Branch: `feat/website-v0.8` (worktree `mvp-website-v08`, afgetakt van `origin/main`).
Ontwerp en copy komen uit `website-mockup-v0.8/` in de projectmap; die mockup is
akkoord bevonden. Deze branch zet dat om naar de echte site.

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
| `/contact` | Nieuwe copy rond de demo; bestaand formulier ongewijzigd. `noindex` |
| `/privacy` | Alleen `noindex` toegevoegd; juridische tekst ongewijzigd |

**Beelden (`public/website/`)**
Zes productfragmenten (1200 × 675) plus `og-image.png` (1200 × 630).

**Vindbaarheid (`app/sitemap.ts`)**
`/sectoren`, `/sectoren/pensioenfondsen`, `/contact` en `/privacy` zijn eruit —
de eerste twee zijn redirects, de laatste twee dragen `noindex`.

## Nog te doen vóór of na livegang

1. **Portretfoto's** op `/over-ons`: nu staan er initialen in een cirkel.
   Vierkant, minimaal 400 × 400, in `public/website/`.
2. **DemoVideo en ThemeToggle** worden nergens meer gebruikt. De componenten en
   `public/video/*` kunnen weg in een opschoonstap.
3. **`_components/CtaBand.tsx`, `Flow.tsx`, `Steps.tsx`, `DossierKaart.tsx`,
   `Crumb.tsx`** worden alleen nog door `/governance-ai/eu-ai-act` gebruikt.
   Die pagina is in deze ronde niet herzien.
4. **Deelkaarten in cache.** Na livegang halen LinkedIn en WhatsApp de oude kaart
   uit hun cache. Eén keer verversen via de debugger van het betreffende platform.
5. **Controleren na deploy:** `/sectoren` → `/voor-wie` (308), `robots.txt` en
   `sitemap.xml` op de marketing-host, en of `og:image` absoluut wordt uitgeserveerd.

## Wat bewust niet is aangepast

- De juridische tekst op `/privacy`.
- De EU AI Act-subpagina (alleen de CTA-tekst is meegetrokken).
- Alles buiten `app/(public)/`, `app/sitemap.ts` en `public/website/`.
