# Bestuurdersportaal MVP — Handover

> **Voor toekomstige Claude-sessies**: dit document is de samenvatting van wat is gebouwd, hoe het in elkaar zit, en wat de logische volgende stappen zijn. Lees dit eerst voordat je aan iets nieuws begint, zodat je niet de hele code hoeft te scannen.

---

## Wat dit project is

Een MVP-portaal voor bestuurders van Nederlandse pensioenfondsen, gebouwd voor Merlin Ijzerman. De kern is een AI-assistent die vragen beantwoordt op basis van fonds-documenten met traceerbare bronvermeldingen, omringd door modules voor Wtp-stuurinformatie, documentbibliotheek, vergaderingen-voorbereiding, een **risicomatrix** met heatmap en logboek per risico, **procedures** voor workflow & case management van beleidswijzigingen en besluittrajecten, een **klantbeeld**-module voor cohort-ontwikkeling van persoonlijke pensioenvermogens en werkgevers-totalen, governance-logging en (placeholder) notulen.

Het is opgezet als demo/MVP — alle stuurinformatiecijfers zijn realistische dummy-data, niet gekoppeld aan een echt fonds. Het demo-fonds heet **Stichting Pensioenfonds Horizon** (slug `horizon`). Het Wtp-perspectief is leidend (financieringsgraad, niet dekkingsgraad; persoonlijke pensioenvermogens per cohort; solidariteitsreserve).

---

## Live versie en repositories

- **GitHub repo (private)**: https://github.com/merlinijzerman/Bestuurdersportaal
- **Hosting**: Vercel (auto-deploy bij push naar `main`)
- **Database + Auth**: Supabase project `aebwiufuegsiwhwpdrfb`, regio EU-Frankfurt
- **Lokale werkmap**: `/Users/merlinijzerman/Documents/Claude/Projects/MVP bestuurdersportaal/mvp`

Vercel-URL: het Vercel project heet `bestuurdersportaal` — exacte productie-URL staat in het Vercel dashboard.

---

## Tech stack

- **Next.js 15.5+** met App Router (Server Components + Client Components, `params: Promise<...>` syntax)
- **TypeScript strict** (Vercel build doet `tsc --noEmit`)
- **Tailwind CSS 3.4** met custom kleuren `#0F2744` (navy) en `#C9A84C` (goud)
- **Supabase** voor Postgres + Auth + Row Level Security
- **@supabase/ssr** voor cookie-based auth in Server Components
- **Anthropic SDK** met `claude-sonnet-4-5` als model
- **unpdf** voor PDF-tekstextractie (modern pdfjs onder de motorkap, met eigen positionele joiner voor juiste woordafstanden)
- **mammoth** voor Word (.docx) tekstextractie
- **xlsx** (SheetJS) voor Excel (.xlsx) parsing naar markdown-tabellen
- **GitHub Desktop** is hoe Merlin commit/pusht (geen terminal-git voor commits)

Geen aparte library voor charts — alle visuals zijn pure SVG of HTML/CSS met percentage-widths. De Risicomatrix-heatmap is een Tailwind-grid van 5×5 cellen, geen library.

---

## Architectuur in het kort

```
Bestuurder (browser)
       │ HTTPS
       ▼
┌────────────────────────────────────┐
│  Vercel · Next.js (App Router)     │
│  ┌──────────────┬───────────────┐  │
│  │  Pages       │  API routes   │  │
│  │  (SSR)       │               │  │
│  │  Auth-check  │  RAG + Claude │  │
│  └──────────────┴───────────────┘  │
└─────┬─────────────┬──────────────┬─┘
      ▼             ▼              ▼
  Anthropic    Supabase       GitHub
  Claude       (Auth + DB     (CI: push
  API           + tsvector     triggert
                FTS + RLS)     auto-deploy)
```

Alle pagina's onder `/(dashboard)` zijn auth-protected via `app/(dashboard)/layout.tsx`, die een redirect naar `/login` doet bij ontbrekende sessie. RLS in Supabase filtert per `fonds_id` zodat een bestuurder alleen documenten en data van het eigen fonds ziet (plus de generieke bibliotheek).

---

## Code-structuur

```
mvp/
├── app/
│   ├── (dashboard)/
│   │   ├── layout.tsx              # auth-check + sidebar wrapper
│   │   ├── page.tsx                # / — persoonlijke homepage (KPIs + voor u open + activiteit)
│   │   ├── dashboard/page.tsx      # /dashboard — Wtp-stuurinformatie
│   │   ├── ai/page.tsx             # /ai — chat met drie modi
│   │   ├── bibliotheek/page.tsx    # /bibliotheek — document upload en lijst
│   │   ├── governance/page.tsx     # /governance — log van AI-vragen
│   │   ├── notulen/page.tsx        # /notulen — placeholder
│   │   ├── vergaderingen/
│   │   │   ├── page.tsx            # lijst van komende/afgelopen
│   │   │   ├── [id]/page.tsx       # detail met agenda + voorbereiding + inbreng + stukken
│   │   │   └── _components/        # AgendapuntKaart, NieuweVergaderingForm, NieuwAgendapuntForm,
│   │   │                           # VoorbereidingsBlok (privé AI-voorbereiding per agendapunt)
│   │   ├── procedures/             # workflow & case management
│   │   │   ├── page.tsx            # lijst met voortgangsbalken
│   │   │   ├── nieuw/page.tsx      # template-picker + form
│   │   │   ├── [id]/page.tsx       # detail met step-rail, checklist, bewijs, log
│   │   │   └── _components/        # NieuweProcedureForm, ActieveStapPaneel
│   │   ├── klantbeeld/             # Wtp-cohort-ontwikkeling + werkgevers-totalen
│   │   │   ├── page.tsx            # redirect → /klantbeeld/deelnemers
│   │   │   ├── _components/        # KlantbeeldHeader, SubTabs (HoofdTabs + DeelnemersSubTabs)
│   │   │   ├── deelnemers/
│   │   │   │   ├── page.tsx        # Maand-ontwikkeling (cohortkiezer + traject + waterval)
│   │   │   │   ├── _components/    # MaandOntwikkelingClient (slider/waterval interactief)
│   │   │   │   └── cohorten/page.tsx # Cohorten naast elkaar (51 cohorten, p10-p90 + verwacht-marker)
│   │   │   └── werkgevers/page.tsx # KPI's, PG/premie/salaris-trend, segmentatie, premie-inning
│   │   └── risicomatrix/           # risk register
│   │       ├── page.tsx            # heatmap + lijst per categorie
│   │       ├── nieuw/page.tsx      # form voor nieuw risico
│   │       ├── archief/page.tsx    # gesloten risico's
│   │       ├── [id]/page.tsx       # detail met maatregelen + logboek
│   │       └── _components/        # NieuwRisicoForm, MaatregelenBlok, RisicoActies
│   ├── api/
│   │   ├── chat/route.ts           # AI-chat (drie modi, multi-turn, RAG)
│   │   ├── documents/upload/route.ts # PDF upload + chunking + AI-samenvatting
│   │   ├── vergaderingen/route.ts
│   │   ├── agendapunten/
│   │   │   ├── route.ts            # POST nieuw agendapunt
│   │   │   └── [id]/voorbereiding/
│   │   │       ├── route.ts        # POST: genereer/regenereer AI-voorbereiding (snel/grondig)
│   │   │       └── notities/route.ts # PATCH: eigen notities opslaan
│   │   ├── inbreng/[id]/route.ts
│   │   ├── procedures/             # 7 routes voor procedure-flows
│   │   │   ├── route.ts            # POST: create from template (snapshot)
│   │   │   └── [id]/
│   │   │       ├── stappen/[stapId]/
│   │   │       │   ├── route.ts                    # PATCH: status + auto-activeer volgende
│   │   │       │   ├── agendapunt/route.ts         # POST: koppel stap aan vergadering (it.2)
│   │   │       │   └── besluit-concept/route.ts    # POST: AI-concept formulering (it.2)
│   │   │       ├── checklist/[itemId]/route.ts     # PATCH: toggle voldaan
│   │   │       ├── bewijs/route.ts                 # POST: bewijsstuk
│   │   │       └── besluiten/route.ts              # POST: formele besluitvastlegging
│   │   └── risicos/                # 4 routes voor risico-CRUD
│   │       ├── route.ts            # POST: create
│   │       └── [id]/
│   │           ├── sluiten/route.ts             # POST: sluiten met motivering
│   │           └── maatregelen/
│   │               ├── route.ts                 # POST: maatregel toevoegen
│   │               └── [mid]/route.ts           # PATCH: status wijzigen
│   ├── auth/callback/route.ts      # Supabase OAuth/magic-link callback
│   ├── login/page.tsx
│   ├── globals.css                 # Tailwind + custom variabelen
│   └── layout.tsx                  # root layout
├── components/
│   └── Sidebar.tsx                 # navigatie met rolweergave en module-iconen
├── lib/
│   ├── supabase.ts                 # browser client
│   ├── supabase-server.ts          # server-side client (SSR cookies)
│   ├── rag.ts                      # zoekRelevanteChunks, maakContext, maakChunks (3-trapt: paragraaf→zin→woord)
│   ├── document-extractie.ts       # tekstextractie per bestandstype (PDF/DOCX/XLSX) + diagnostiek
│   ├── proces-templates.ts         # hardcoded procestemplates (Beleidswijziging)
│   ├── risico-config.ts            # categorieën + niveau-afleiding K+I
│   └── klantbeeld-data.ts          # demo-data Klantbeeld: 51 cohorten met Wtp-mechaniek
│                                   # (premie + cashflow-restposten + 4 rendementscomponenten)
│                                   # + werkgevers-totalen, segmentatie en inning-reeks
├── prototypes/                     # klikbare HTML-mockups (single file, Tailwind via CDN)
│   ├── procedures-mockup.html
│   └── risicomatrix-mockup.html
├── supabase/
│   ├── schema.sql                  # complete schema (idempotent documentatie)
│   └── migrations/                 # losse migratie-scripts per release
├── package.json
├── next.config.ts                  # serverExternalPackages: ["unpdf", "mammoth", "xlsx"]
├── tailwind.config.ts
├── tsconfig.json
└── .env.local                      # NIET in git — Supabase + Anthropic keys
```

---

## Database schema (Supabase Postgres)

| Tabel | Doel |
|------|------|
| `fondsen` | Pensioenfondsen (slug, naam) — demo-rij: `Stichting Pensioenfonds Horizon` / `horizon` |
| `profielen` | Aanvulling op `auth.users`: naam, rol (`bestuurder`/`voorzitter`/`beheerder`), fonds_id |
| `documenten` | Document-uploads (PDF/DOCX/XLSX, kolom `bestandstype`) met bron (DNB/AFM/Pensioenfederatie/Intern/Extern), bibliotheek (generiek/fonds), `agendapunt_id`, `samenvatting_ai` |
| `document_chunks` | Per-document text-fragmenten met `tsvector` voor full-text search |
| `governance_log` | Elke AI-vraag met antwoord, bronnen (jsonb), `modus` (documenten/combineren/algemeen) |
| `vergaderingen` | Bestuursvergaderingen met datum, locatie, status |
| `agendapunten` | Agendapunten per vergadering met `categorie` (beeldvorming/oordeelsvorming/besluitvorming/informatie) |
| `agendapunt_inbreng` | Inbreng vooraf van bestuursleden per agendapunt |
| `voorbereidingen` | Persoonlijke AI-ondersteunde voorbereidingen per (agendapunt, gebruiker), met `ai_output` (jsonb), `eigen_notities` (jsonb keyed op lens-slug), `bronnen_meta` (jsonb), en `diepte` (snel/grondig). RLS: alleen eigen rijen zichtbaar |
| `risicos` | Risico's met categorie, kans (1-5), impact (1-5), niveau (laag/middel/hoog), type (structureel/tijdelijk), status (actief/gesloten), eigenaar |
| `risico_maatregelen` | Beheersmaatregelen per risico met status (open/in_voorbereiding/genomen) en placeholder `procedure_id` voor latere koppeling |
| `risico_log` | Append-only audit-trail per risico (event_type, actor, payload jsonb) |
| `procedures` | Lopende procedure-instanties met template_code, status (in_uitvoering/wacht_op_besluit/afgerond), deadline |
| `procedure_eigenaars` | Co-eigenaren per procedure (composite PK procedure_id + naam) |
| `procedure_stappen` | Snapshot van template-stappen per procedure met status (open/actief/afgerond) |
| `procedure_checklist` | Snapshot van checklist-items per stap met `voldaan` boolean en `bewijs_vereist` flag |
| `procedure_bewijs` | Bewijsstukken per stap (titel, beschrijving, optionele FK naar `documenten`) |
| `procedure_besluiten` | Formele besluiten met formulering, motivering, datum, optionele FK naar vergadering/agendapunt |
| `procedure_log` | Append-only audit-trail per procedure |

RLS policies filteren overal per fonds. Eigen-inbreng kan alleen door de eigen gebruiker geschreven/gewijzigd/verwijderd worden. Voor de Procedures- en Risicomatrix-tabellen werkt RLS via subquery (link naar `risicos.fonds_id` of `procedures.fonds_id`).

Het volledige schema staat in `mvp/supabase/schema.sql` (idempotent, kan opnieuw gerund worden zonder schade). Per release komt er een migratie-script bij in `mvp/supabase/migrations/` voor bestaande databases.

---

## Modules en wat ze doen

### Persoonlijke homepage (`/`)
Welkomststrook met dagdeel-groet, naam, rol, fondsnaam en eerstvolgende vergadering. Compacte 4-tile KPI-strook (financieringsgraad, solidariteitsreserve, vermogen, rendement YTD). **"Uw open procedure-stappen"**-widget toont actieve procedure-stappen waar je co-eigenaar bent, met deadline-indicatie (amber-stip bij ≤7 dagen, anders gold). **"Voor u open"**-widget toont aantal agendapunten waar je nog geen inbreng plaatste. **"Uw recente activiteit"** toont laatste 3 AI-vragen, inbrengen en uploads.

### Wtp-stuurinformatie (`/dashboard`)
Vijf KPI-tegels (financieringsgraad, **jaarlijkse aanpassing uitkeringen** — afgeleid uit FG via 1/5 × (FG − 100%), solidariteitsreserve, vermogen, rendement YTD), 24-maands trendgrafiek financieringsgraad (inline SVG), gedetailleerde Wtp-balans (activa: bescherming/overrendement/liquide; passiva: persoonlijke pensioenvermogens per cohort + solidariteitsreserve + compensatiedepot + operationele reserve), deelnemers-status-blok, signaleringen, openstaande acties. Alle cijfers zijn demo-data hardcoded in de page.

### Documentbibliotheek (`/bibliotheek`)
Twee tabbladen (Generiek / Fonds), zoekbalk, toggle "Toon gedeactiveerde documenten". Per document een rij met klikbare titel die het origineel opent (PDF inline in een nieuw tabblad, Word/Excel als download — via `GET /api/documents/[id]/bestand`, dynamisch content-type per `bestandstype`). Kleine type-badge per rij (PDF rood, Word blauw, Excel groen). Kebab-menu per rij: **Bekijken** (open origineel), **Deactiveren** (confirmation-dialog met optionele reden — uitgesloten van zoeken/AI maar bestand + chunks blijven), **Reactiveren** (alleen voor gedeactiveerde, alleen voorzitter/beheerder). Gedeactiveerde rijen zijn grijs met een rood "Gedeactiveerd"-badge en deactivatie-reden zichtbaar. Documenten die vóór mei 2026 zijn geüpload hebben geen `opslag_pad` en tonen "Origineel niet beschikbaar"; AI-zoeken werkt daar wel op. Uploaden gebeurt via een modal die PDF, Word (.docx) en Excel (.xlsx) accepteert; gescande PDF's zonder tekstlaag worden geweigerd met instructie om eerst doorzoekbaar te maken via Acrobat/Preview (zie ontwerpkeuzes — server-side OCR is bewust niet ingebouwd vanwege Vercel-limieten). Schrijft tegelijk naar Supabase Storage en de RAG-chunks-tabel. Audit-trail in `document_inzage`.

### AI Assistent (`/ai`)
Multi-turn chat met geschiedenisvenster van 12 berichten. Drie modi via segmented toggle: **Documenten** (strikt op interne bronnen, citaten verplicht), **Slim combineren** (default — interne bronnen aangevuld met algemene kennis, gemarkeerd onderscheid), **Algemeen** (open AI-assistent zonder beperking, gele waarschuwing bij elk antwoord). Persoonlijke aanspreking via systeem-prompt met naam/rol/fondsnaam. Gespreksgeschiedenis wordt op de frontend bijgehouden; "Nieuw gesprek"-knop wist alles. Elke vraag wordt gelogd in `governance_log` inclusief gebruikte modus.

### Documentbibliotheek — uploadpipeline
Upload-route (`POST /api/documents/upload`) ondersteunt PDF, DOCX en XLSX. Per type een dedicated extractor in `lib/document-extractie.ts`: PDF via `unpdf` met eigen positionele joiner (zie ontwerpkeuzes), DOCX via `mammoth.extractRawText`, XLSX via `xlsx` (SheetJS) waarbij elk tabblad een markdown-tabel met H2-kop wordt. Daarna gaat de tekst door `lib/rag.ts maakChunks()` (paragraaf → zin → woord cascade) naar `document_chunks` met automatische `tsvector` indexering voor full-text search. Documenten getagd met bron, bibliotheek (generiek/fonds) en `bestandstype`. Per upload schrijft de route diagnostiek naar de Vercel-logs als de PDF-extractie er verdacht uitziet (>5% woorden langer dan 30 chars).

### Vergaderingen (`/vergaderingen`)
Lijst-view scheidt komend en afgelopen. Detail-view toont meeting-header, stats, agendapunten als uitklapbare kaarten met categorie-badge (BOB-model: kleur per categorie). Per agendapunt: documentupload (triggert ook AI-samenvatting per stuk, neutraal en beschrijvend), persoonlijke voorbereidingsblok met AI-ondersteunde kritische analyse (privé, alleen voor jou — niet hetzelfde als de samenvatting per stuk), en inbreng-formulier voor andere bestuursleden. De voorbereiding pakt context uit het agendapunt zelf, gekoppelde stukken, RAG over de bibliotheek, actieve risicomatrix-risico's en lopende procedures. Output: 2-4 relevante lenzen, "wat ontbreekt", drie kritische vergadervragen.

### Procedures (`/procedures`)
Workflow & case management: lopende processen voor beleidswijzigingen, uitbestedingsreviews, incidenten en besluittrajecten. Lijstpagina toont per procedure een voortgangsbalk, eigenaars-avatars en deadline. Detailpagina heeft een vertical step-rail die afgeronde / actieve / open stappen visueel onderscheidt, plus een interactief **"actieve stap"-paneel** met:

- **Checklist-items** (afvinkbaar, met `bewijs_vereist`-flag)
- **Vergaderingen** — knop *Voeg toe aan vergadering* die in één klik een agendapunt aanmaakt in een gekozen komende vergadering (categorie automatisch *Oordeelsvorming* of *Besluitvorming*); gekoppelde agendapunten zijn klikbaar zichtbaar
- **Bewijsstukken** (toevoegen via form: titel + beschrijving)
- **Besluit** — voor stappen die het vereisen, een formulering + motivering + datum-form, met optionele *↗ Concept met AI*-knop die automatisch een conceptformulering opstelt op basis van bewijs en eerdere stappen

Validatie bij stap-voltooien: alle checklist voldaan, bewijs aanwezig waar vereist, en besluit vastgelegd waar vereist. Bij voltooien wordt de volgende stap automatisch geactiveerd; bij de laatste stap wordt de procedure op `afgerond` gezet. Onderaan de pagina staat een append-only audit-trail van alle events. Drie templates beschikbaar: **Beleidswijziging** (6 stappen), **Uitbestedingsreview** (5 stappen), **Incident-meldplicht DNB** (6 stappen, tijdkritisch). Templates zijn hardcoded in `lib/proces-templates.ts` met snapshot-pattern bij start.

### Klantbeeld (`/klantbeeld`)
Twee perspectieven op de klant van het fonds. **Deelnemers** (default tab) heeft twee sub-views: *Maand-ontwikkeling* met cohortkiezer (slider 18–68 + presets), 24-maands trajectory-grafiek van het persoonlijk pensioenvermogen, een gestapelde maand-delta-bar met alle bouwstenen (premie, toevoegingen, kasrendement, beschermingsrendement RTS, overrendement, micro-langleven, onttrekkingen) en een klikbare waterval per maand met automatische "wat valt op"-observaties. *Cohorten naast elkaar* toont alle 51 leeftijdscohorten als bars waarvan de hoogte het *totaal* pensioenvermogen per cohort is (aantal deelnemers × gemiddeld vermogen), met daarboven een KPI-strook (totaal fondsvermogen, top-cohort, gem. per deelnemer) — bedoeld om de concentratie van fondsvermogen over leeftijden te laten zien. **Werkgevers** toont vier KPI-tegels (aangesloten werkgevers, actieve werknemers, gem. salaris, totale maandpremie), drie 24-maands trends (totale pensioengrondslag, premie wg/wn-gestapeld, salarisindexcijfer met CAO-stappen), werkgever-grootte-segmentatie (klein/midden/groot met aandeel werkgevers/werknemers/premie — toont concentratierisico van grote werkgevers), en premie-inning-discipline als 24-maands stacked 100% bar-chart met norm-lijn 90% plus 12-maands aggregaat-strook met detail per kleur. Alle data is deterministisch dummy uit `lib/klantbeeld-data.ts`.

### Risicomatrix (`/risicomatrix`)
Risicoraamwerk met 5×5 Kans×Impact-heatmap. Vier categorieën: Financieel & actuarieel, Governance & Organisatie, Operationeel & datakwaliteit, Informatie & communicatie. Per risico: titel, toelichting, kans (1-5), impact (1-5), risiconiveau (laag/middel/hoog — afgeleid uit K+I, handmatig overschrijfbaar), type (structureel/tijdelijk), status (actief/gesloten), eigenaar (vrije tekst), beheersmaatregelen met status (open/in_voorbereiding/genomen), en append-only logboek. Heatmap toont risico-pills in cellen, kleur volgt zone (groen/amber/rood). Lijst per categorie onder de heatmap. Detailpagina heeft K/I/niveau-strook, toelichting, maatregelen-blok (toevoegen + status-wijzigen) en logboek. Sluiten gaat met verplichte motivering — gesloten risico's verhuizen naar `/risicomatrix/archief` en blijven volledig reproduceerbaar.

### Governance Log (`/governance`)
Lijst van alle gestelde AI-vragen per fonds met datum, gebruiker, vraag, modus en bronnen. Audit-trail.

---

## Belangrijke ontwerpkeuzes

### AI-tooninstellingen (LET OP — kostbaar werk)
De systeem-prompt in `app/api/chat/route.ts` is bewust in detail uitgewerkt om antwoorden warm en menselijk te laten klinken zonder corporate-wolligheid. Drie blokken: **VORM** (prose-first, geen bullets-by-default, geen titels), **INHOUD** (toon redenering, erken complexiteit), **REGISTER** ("u" maar warm, voornaam sporadisch). Plus VOORBEELDEN VAN HOE TE BEGINNEN en NOOIT ZO BEGINNEN. Wijzig dit blok met beleid — kleine veranderingen sturen de hele toon. `max_tokens` staat op 2500. Model: `claude-sonnet-4-5`.

### RAG zonder vector embeddings
Postgres full-text search via `tsvector` (Dutch config) is bewust gekozen boven vector embeddings. Voor MVP-volume van honderden documenten is FTS prima. Bij schaal naar duizenden grote PDFs is migratie naar pgvector een logische volgende stap.

### PDF-extractie met positionele joiner i.p.v. naïeve concatenatie
PDF's zijn geen tekstdocumenten maar verzamelingen positionele "text items". Veel generators (Word, LaTeX, rapport-tools) emiteren elk woord als los item met *positionele* afstand tot het volgende — geen echt spatie-karakter ertussen. De oude `pdf-parse` library plakte items dan klakkeloos achter elkaar, met als resultaat `"Decommissieheefteenadviesuitgebracht"` — funest voor full-text search omdat de Postgres-tokenizer er één onbestaand woord van maakt. Daarom is `pdf-parse` vervangen door `unpdf` (modern pdfjs onder de motorkap) met een eigen `voegTekstItemsSamen`-functie in `lib/document-extractie.ts` die per text-item naar X/Y-coördinaten en font-grootte kijkt: meetbare X-gap → spatie ertussen, kleine Y-verandering → newline (regel-break), grote Y-sprong → dubbele newline (paragraaf). Die paragraaf-breaks zijn essentieel voor de chunker: zonder zou alles als één blob op 800-tekens-grens worden afgekapt. **Twee InDesign/typografie-conventies** worden expliciet afgehandeld: (1) woordafbreking aan einde regel (`vertegen-\nwoordigt` → `vertegenwoordigt`), gedetecteerd als `letter-` aan eind van regel + kleine letter op volgende regel; (2) soft hyphens (U+00AD) worden uit de tekst gestript voordat de tokenizer ze ziet. Zonder deze twee fixes zou een typisch InDesign-pensioendocument tientallen onvindbare woordfragmenten opleveren. De diagnostiek-helper `diagnoseerExtractie` waarschuwt in de Vercel-logs zodra er bij een specifiek document toch verdachte lange woorden of resterende hyphen-fragmenten ontstaan — vroege signalering zonder de upload te blokkeren.

### Chunker als drie-traps cascade
`maakChunks` in `lib/rag.ts` splitst in drie niveaus van afnemende kwaliteit: paragrafen (`\n{2,}`) → zinnen (`. `, `? `, `! ` gevolgd door hoofdletter) → woordgrenzen. Voorkomt dat chunks midden in een woord of zin worden afgekapt wanneer een document weinig paragraaf-grenzen heeft. Overlap van ~16 woorden tussen chunks geeft zoek-hits aan de rand context mee.

### Multi-format upload zonder server-side OCR
Drie formaten: PDF (unpdf), DOCX (mammoth), XLSX (SheetJS). Excel-tabbladen worden omgezet naar markdown-tabellen met `## Tabblad: <naam>` als kop — pipes en interne newlines in cellen worden ge-escaped. Voor RAG-zoeken is dat indexeerbaar als gewone tekst; de AI kan vragen beantwoorden over een specifiek tabblad. Inzage-route serveert origineel met juiste content-type per type (PDF inline, Word/Excel als download). Migratie 2026-05-03 voegt kolom `bestandstype` toe met check-constraint (pdf/docx/xlsx) en default `'pdf'` voor bestaande records. **OCR voor gescande PDF's is bewust niet ingebouwd**: tesseract.js wil traineddata naar disk schrijven (Vercel-filesystem is read-only buiten `/tmp`), pdf-naar-image-conversie vereist canvas-binaries die de Vercel function-grootte fors opdrijven, en OCR-tijd van 30-90 sec per document past niet binnen Vercel's function-timeouts. Gescande PDF's worden geweigerd met instructie om eerst doorzoekbaar te maken via Acrobat/Preview. Latere OCR-iteratie zou via Anthropic vision API (PDF → images door Claude) of een externe OCR-service (Mathpix / Google Cloud Vision) moeten — zie volgende stappen.

### Wtp als leidend perspectief
Sinds de gebruiker erop wees dat dekkingsgraad onder Wtp niet meer relevant is, is alle stuurinformatie omgebouwd naar **financieringsgraad** (vermogen ÷ verplichtingen), **persoonlijke pensioenvermogens per cohort**, en **solidariteitsreserve**. Het portaal richt zich expliciet op fondsen die al zijn ingevaren of er dichtbij zijn.

### Drie AI-modi
Gebruikers wilden expliciete keuze tussen strikt-RAG en vrij AI. Drie-staps toggle (Documenten / Combineren / Algemeen) i.p.v. binaire knop omdat formele rapportage-context strikt-RAG verlangt terwijl casual context de algemene kennis nuttig vindt. Default: combineren.

### Multi-turn met sliding window
History limit op 12 berichten (HISTORY_LIMIT in `app/api/chat/route.ts`). Geen samenvatting van oudere berichten — die worden gewoon afgeknipt.

### Categorieën agendapunten = BOB-model
**Beeldvorming / Oordeelsvorming / Besluitvorming / Informatie**. Sluit aan bij Nederlandse bestuurspraktijk. (Per release april 2026 hernoemd van "Discussie" naar "Oordeelsvorming" — dat dekt de fase nauwkeuriger.)

### Inbreng vooraf — vrij tekstveld
Geen aparte velden voor onderwerp/toelichting; één textarea omdat bestuurders dat in één doorlopende formulering schrijven. Chronologisch geordend, geen threading. Eigen inbreng kan worden verwijderd (RLS).

### Procedures: snapshot-pattern bij start
Bij het starten van een procedure worden de stappen en checklist-items uit de template (in `lib/proces-templates.ts`) gekopieerd naar de database. Dat betekent: latere wijzigingen aan de template raken lopende procedures niet — ze blijven point-in-time correct, wat essentieel is voor reproduceerbaarheid en auditability. Pas bij het starten van een nieuwe procedure wordt de huidige template-versie gebruikt.

### Procedures: validatie bij stap-voltooien
Een stap kan pas op `afgerond` als (1) alle checklist-items voldaan zijn, (2) er minimaal één bewijsstuk is als de stap één of meer items met `bewijs_vereist=true` heeft, en (3) er een besluit is vastgelegd als de stap `vereist_besluit=true` heeft. Validatie zit in zowel de UI (knop is dan disabled) als in de API-route (hard check). Bij voltooien wordt de volgende stap automatisch op `actief` gezet, of bij laatste stap wordt de procedure afgerond.

### Risicomatrix: niveau-afleiding K+I
Niveau wordt afgeleid uit `kans + impact`: som 2-4 = laag (groen), 5-7 = middel (oranje), 8-10 = hoog (rood). De afgeleide waarde kan handmatig overschreven worden via een `niveau_handmatig` boolean flag — bestuurlijk gevoel kan soms zwaarder wegen dan de formule. De UI toont in dat geval "handmatig overschreven" als hint.

### Klantbeeld: Wtp-mechaniek volledig in TypeScript, geen Supabase-tabellen
De cohort-mechaniek (begin + premie + toevoegingen − onttrekkingen + 4 rendementscomponenten = eind) staat volledig in `lib/klantbeeld-data.ts` en wordt deterministisch gegenereerd op elke server-render. Geen Supabase-tabel — dezelfde keuze als bij het Wtp-dashboard, vanuit het patroon "alle stuurinformatiecijfers zijn realistische dummy-data". Voor productie komt er een data-koppeling (handmatig invoer / Excel-upload / API uitvoerder), maar die hoort bij iteratie 2. Reconstructie sluit op €0,00 voor alle 51 cohorten — zie `MaandRij` interface en `maandReeks()`-functie. De cashflow-restposten *toevoegingen* (waardeoverdracht in / FVP-aanvulling) en *onttrekkingen* (waardeoverdracht uit) zijn cohort-gemiddelden van individuele events, deterministisch gegenereerd via `genereerCashflows(age)`.

### Klantbeeld: cohort-vergelijkingen klaar in data, nog niet in UI
In `lib/klantbeeld-data.ts` worden per cohort meerdere referentiewaarden berekend: `doelKapitaal` (verwachte stand bij neutraal markt-scenario `VERWACHT_MARKT`), `doelOp67` (lange-termijn pensioenbelofte op 67-jarige leeftijd), `projectie` (gediscontineerde projectie naar 67), `spreiding` (p10–p90 binnen cohort) en `afwijking` (huidig vs. verwacht). Op de cohorten-pagina wordt nu alleen `aantal × eindSaldo` getoond — de overige vergelijkingen zijn beschikbaar voor latere iteratie zodra het bestuurlijk verhaal er om vraagt. Per cohort zit een `uitvoeringMult` op overrendement die operationele uitvoeringskwaliteit modelleert (timing, kostenmarge, hedge-precisie) — alleen op het werkelijke scenario, niet op verwachting, waardoor cohorten natuurlijk uit elkaar bewegen.

### Klantbeeld: server component met client-eiland voor interactiviteit
De Maand-ontwikkeling-view heeft cohort-slider + maand-klik-waterval die client-side state nodig hebben. Patroon: server component (`page.tsx`) leest de hele dataset uit `lib/klantbeeld-data.ts` en geeft `cohorten` als prop door aan `MaandOntwikkelingClient`-component met `"use client"`. SVG-grafieken (trajectory, monthly delta) zijn allemaal in de client component gedefinieerd zodat ze responsief op state-changes reageren. De Cohorten- en Werkgevers-pagina's zijn pure server components — geen interactiviteit, alleen statische SVG-renders.

### Append-only audit-logs
Beide nieuwe modules (Procedures en Risicomatrix) hebben een eigen `*_log`-tabel met event-types als enum-string en payload als jsonb. Geen triggers — elke API-route schrijft expliciet naar het log na de mutatie. Deze opzet is eenvoudig te lezen en te debuggen, en houdt het log scheidbaar van de `governance_log` (die specifiek voor AI-vragen is).

### Voorbereiding versus samenvatting — twee verschillende AI-functies
Op een agendapunt zitten twee AI-functionaliteiten die nadrukkelijk *niet* hetzelfde zijn. Per gekoppeld stuk maakt `app/api/documents/upload/route.ts` automatisch een **samenvatting** in vaste structuur (aanleiding/hoofdpunten/gevraagd besluit/aandachtspunten) — neutraal en beschrijvend, voor iedereen zichtbaar in `documenten.samenvatting_ai`. Op het agendapunt-niveau kan een bestuurder een **voorbereiding** genereren via `VoorbereidingsBlok` — kritisch en provocatief, persoonlijk en privé. Het is belangrijk dat de UI dat onderscheid duidelijk maakt; anders denkt de bestuurder "samenvatting heb ik al" en blijft de provocatieve hulp ongebruikt.

### Voorbereiding: AI kiest 2-4 lenzen, geen kunstmatige completeness
De systeem-prompt voor `/api/agendapunten/[id]/voorbereiding` instrueert Claude om uit het lenzenraamwerk (5 stakeholdergroepen, 3 principes uitvoerbaarheid/financierbaarheid/uitlegbaarheid, 4 bestuurlijke uitgangspunten) alleen de 2-4 te kiezen die *echt van toepassing zijn op dit stuk*. De AI mag expliciet zeggen *"werkgevers spelen hier geen rol"* — pretentie van compleetheid is wat we vermijden. De output is bewust kort (~400 woorden voor snel, ~700 voor grondig) zodat het in een paar minuten te scannen is.

### Voorbereiding: privé per gebruiker, RLS op gebruiker_id
Voorbereidingen zijn persoonlijk: alleen jij ziet je eigen output en notities. RLS-policy `eigen voorbereiding` filtert strikt op `gebruiker_id = auth.uid()`. De inbreng-functie blijft het gedeelde kanaal: de "↓ Gebruik dit als startpunt voor mijn inbreng"-knop kopieert naar de inbreng-textarea zodat de bestuurder zelf kiest welk deel van zijn voorbereiding hij met collega's deelt.

### Voorbereiding: twee snelheden voor context-omvang
*Snel* leest het agendapunt + gekoppelde stukken + lichte RAG over de bibliotheek (top 4 chunks). *Grondig* breidt dat uit naar diepere RAG (top 10 chunks) plus alle actieve risicomatrix-risico's plus alle lopende procedures als context. Bestuurder begint default met snel; een knop *↗ Verdiep* regenereert met grondig. Eigen notities blijven bewaard tussen genereer-acties.

---

## Configuratie en environment variables

Lokale `.env.local` (NIET in git) bevat:

```
NEXT_PUBLIC_SUPABASE_URL=https://aebwiufuegsiwhwpdrfb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon key — public, gefilterd via RLS]
ANTHROPIC_API_KEY=[secret — bij gelegenheid roteren in console.anthropic.com]
NEXT_PUBLIC_FONDS_NAAM=Stichting Pensioenfonds Horizon
```

Op Vercel: dezelfde vier variabelen onder Project Settings → Environment Variables, beschikbaar voor Production / Preview / Development.

---

## Werkwijze

### Lokaal draaien
```bash
cd "/Users/merlinijzerman/Documents/Claude/Projects/MVP bestuurdersportaal/mvp"
npm run dev
```
Open http://localhost:3000.

### TypeScript-check vóór push (verplicht!)
Vercel doet strict type-checking. Lokaal vooraf draaien voorkomt rode builds:
```bash
cd "/Users/merlinijzerman/Documents/Claude/Projects/MVP bestuurdersportaal/mvp"
./node_modules/.bin/tsc --noEmit --skipLibCheck
```
Exit code 0 = klaar voor push.

### Deploy-flow
1. Wijzigingen opslaan
2. Open GitHub Desktop
3. Summary invullen, Commit to main
4. Push origin
5. Vercel detecteert push binnen ~10 sec en deployt automatisch
6. Volg build-logs in Vercel dashboard

### Schema-wijziging in Supabase
Voor het idempotent toevoegen van nieuwe tabellen of kolommen:
1. Werk eerst `mvp/supabase/schema.sql` bij (voor documentatie)
2. Schrijf een idempotent migratie-script in `mvp/supabase/migrations/<datum>_<naam>.sql`
3. Plak de inhoud van het migratie-script in Supabase Dashboard → SQL Editor → New query → Run
4. Voer pas dáárna code-deploy uit (anders crashen inserts of breken CHECK-constraints)

### Browser-cache na release
Browsers cachen CSS/JS-bundles agressief. Na een Vercel-redeploy kan een hard refresh nodig zijn (Cmd+Shift+R / Ctrl+Shift+R) om de nieuwe styling te zien. Symptoom als dit fout gaat: "witte pagina met losse tekst" — dat is bijna altijd cache-mismatch tussen oude HTML en nieuwe bundles.

---

## Bekende beperkingen / scherpe randen

- **`agendapunten.verantwoordelijke` is vrije tekst.** Voor "wijs me agendapunten waar ik verantwoordelijke ben" zou een `verantwoordelijke_id uuid references auth.users` veel netter zijn. Geldt ook voor `procedure_eigenaars.gebruiker_naam` en `risicos.eigenaar_naam` — alle drie zijn nu strings, geen FKs.
- **Conversaties zijn niet persistent.** Pagina-refresh wist het AI-gesprek. Wel staat elke vraag+antwoord in `governance_log`. Voor herstelbare conversaties is een `gesprekken` tabel nodig met `gesprek_id` op log-rijen.
- **Geen prompt caching.** Anthropic ondersteunt cache_control marker voor system prompts en oudere messages. Voor herhaalde vragen binnen een gesprek scheelt dat 60-80% input-tokens.
- **AI-samenvatting van vergaderstukken is synchroon.** Upload duurt ~5-10 sec voor de Claude-call. Bij grote PDFs (50+ pagina's) kan oplopen naar 15-20 sec.
- **Procedures: drie templates, geen in-app editor.** Beleidswijziging, Uitbestedingsreview, Incident-meldplicht DNB zijn beschikbaar (hardcoded in `lib/proces-templates.ts`). Een nieuwe template toevoegen vereist een code-deploy. In-app editor is een latere iteratie.
- **Procedures: bewijs is alleen titel + beschrijving, geen file-upload.** Voor v1/v2 leg je vast dát er bewijs is; later koppelen aan documentbibliotheek of directe upload.
- **Voorbereiding: geen "Sparringpartner" doorpraat-modus.** Eenmalige gestructureerde voorbereiding plus eigen notities is wat er nu is. Een interactieve socratische dialoog waar Claude doorvraagt op basis van wat je antwoordt, is bewust uitgesteld naar iteratie 2.
- **Voorbereiding: geen "Bereid alles voor"-bulkknop.** Per agendapunt afzonderlijk genereren. Voor een vergadering met 8 punten is dat 8 klikken — werkbaar, maar bulk-actie zou prettig zijn.
- **Voorbereiding: geen AI-bronvermelding-validatie.** De AI verwijst naar bronnen met `[Bron N]`-notatie zoals de chat dat doet, maar er is geen post-hoc check of de bewering klopt. Hallucinatie-risico bestaat — bestuurder moet kritisch kijken naar wat de AI als feit presenteert (zoals altijd).
- **Voorbereiding: één voorbereiding per (agendapunt, gebruiker).** Hergenereren overschrijft de vorige AI-output (eigen notities blijven bewaard). Geen versiehistorie van AI-output.
- **Risicomatrix: K/I/niveau/titel niet bewerkbaar na aanmaken.** Wijzigen kan alleen via sluiten + opnieuw aanmaken. In iteratie 2 een edit-form met motiveringsveld dat naar log schrijft.
- **Risicomatrix: maatregel-procedure-koppeling niet in UI.** Kolom `risico_maatregelen.procedure_id` bestaat maar wordt niet gevuld door de UI.
- **Geen OCR voor gescande PDF's.** Gescande documenten zonder tekstlaag worden geweigerd met instructie om ze eerst doorzoekbaar te maken (Acrobat 'Tekstherkenning' of Preview 'Exporteer als PDF met OCR'). Server-side OCR is bewust niet ingebouwd vanwege Vercel-limieten — zie ontwerpkeuzes en volgende stappen.
- **Bestaande documenten zijn niet opnieuw geïndexeerd na PDF-extractie verbetering.** Documenten geüpload vóór 4 mei 2026 zitten met de oude (slechtere) chunks in de database. Voor de allerbelangrijkste documenten kan opnieuw uploaden helpen. Een "her-extract"-endpoint dat een bestaand opslag-pad opnieuw door de pipeline trekt is een logische volgende kleine stap.
- **Geen versioning van vergaderstukken.** Nieuwe upload = nieuwe rij. Oude blijft staan zonder "verouderd"-label.
- **Notulen-pagina is een placeholder.** Wachten op koppeling met afgeronde vergaderingen.
- **Geen e-mail notificaties.** Bestuurders moeten zelf inloggen om te zien dat er iets is.
- **Demo-data overal.** Alle Wtp-cijfers zijn fictief. Voor productie moet er een data-koppeling komen — handmatige invoer per maand, Excel-upload, of API naar uitvoerder. Geldt ook voor `lib/klantbeeld-data.ts` (cohorten + werkgevers + inning).
- **Klantbeeld: geen werkgevers-individu-zicht.** Bewust geweerd uit v1 — alleen totalen, segmentatie en aggregate inning-discipline. Concentratierisico is zichtbaar via de grootte-segmentatie maar niet doorklikbaar naar een specifieke werkgever. In iteratie 2: aansluit-historie per werkgever, top-10 grootste afdragers, individuele inning-status.
- **Klantbeeld: cohorten-pagina is bewust minimaal.** Geen spreidingsbanden p10–p90, geen verwachte-stand-marker, geen kleurcodering op afwijking, geen projectie-naar-67, geen aandacht-tabel — alleen een schone bar-chart van totaal pensioenvermogen per leeftijdscohort. Die rijkere views komen pas terug als het bestuurlijk verhaal er om vraagt. De onderliggende data (`spreiding`, `doelKapitaal`, `doelOp67`, `projectie`, `afwijking`) staat wel in `Cohort` interface en wordt nog steeds berekend — alleen niet meer getoond.
- **Klantbeeld: Voorbeelddeelnemer-view ontbreekt.** Een ge-anonimiseerde "wat ziet de deelnemer in Mijn Pensioen vs. wat ziet het bestuur"-vergelijking was gepland voor v1 maar bewust uitgesteld — communicatie-toets-feature komt in iteratie 2 als de basis-views zijn gevalideerd.
- **Klantbeeld: cohort-noise is uniform-deterministisch.** Geen seizoenspatronen in cashflow-events (waardeoverdrachten clusteren in werkelijkheid rond eind kalenderjaar of CAO-momenten), geen sectorale onderverdeling.
- **Model-string `claude-sonnet-4-5`.** Werkt nog, maar nieuwere modellen (4-6) zijn beschikbaar. Update kan in `app/api/chat/route.ts` en `app/api/documents/upload/route.ts`.

---

## Logische volgende stappen (in volgorde van impact/waarde)

1. **Prompt caching toevoegen** in `app/api/chat/route.ts` (en de andere AI-routes: `documents/upload`, `procedures/[id]/stappen/[stapId]/besluit-concept`, `agendapunten/[id]/voorbereiding`). System prompt als array met `cache_control: { type: "ephemeral" }`. ~30 minuten werk per route, 60-80% besparing op herhaalde calls.
2. **Echte data koppelen** aan het Wtp-dashboard. Eerste optie: handmatig invoerformulier voor de beheerder, kwartaal-cijfers. Tweede optie: Excel-upload van uitvoerderrapport.
3. **Voorbereiding iteratie 2** — Sparringpartner-modus die ónder een gegenereerde voorbereiding een interactieve chat opent met de hele context al gevuld (procedure-context, bewijs, eigen notities). "Bereid alles voor"-bulkknop op de vergadering-detail-pagina die voor alle agendapunten in één keer een voorbereiding genereert (paar minuten in achtergrond, dan staat het klaar). Optionele "deel met bestuur"-toggle per voorbereiding voor wie collectief wil voorbereiden.
4. **Procedures iteratie 3** — file-upload bij bewijsstukken (direct of via documentbibliotheek-picker), in-app template-editor zodat beheerders zonder code-deploy nieuwe templates kunnen toevoegen, eigenaars-FK naar `auth.users` zodat tagging/notifications mogelijk worden, edit-functie voor titel/beschrijving/deadline na aanmaken (met motivering naar log).
5. **Risicomatrix iteratie 2** — bewerken van K/I/niveau/titel/toelichting met motiveringsveld dat naar log schrijft, eigenaar-FK naar `auth.users`, volgende-beoordeling-datum invulbaar, koppeling maatregel ↔ procedure.
6. **Conversatiepersistentie** in de AI-chat — `gesprekken` tabel, mogelijkheid om eerdere gesprekken terug te halen.
7. **Sliding window samenvatting** voor lange gesprekken (>10 turns).
8. **Notulen-module afmaken** — koppelen aan afgeronde vergaderingen, mogelijkheid om besluiten/actiepunten te markeren.
9. **Generieke `verantwoordelijke_id` schemamigratie** voor agendapunten/procedures/risicos.
10. **Rolspecifieke homepage-varianten** — voorzitter ziet andere accenten dan beleggingscommissielid.
11. **Web search tool integratie** voor de AI-assistent — Anthropic `web_search` met whitelist (DNB, AFM, Pensioenfederatie, rijksoverheid).
12. **Versioning van vergaderstukken** met "verouderd"-label.
13. **E-mail notificaties** bij nieuwe vergadering, nieuwe inbreng op eigen agendapunt, of stap-deadline die nadert.
14. **OCR voor gescande PDF's** als aparte iteratie. Twee mogelijke routes: (a) Anthropic vision API — PDF naar images converteren in een Supabase Edge Function (Deno-runtime, geen Vercel-limieten) en pagina's door Claude laten lezen, kost een paar cent per document maar hoge kwaliteit; (b) externe OCR-service zoals Mathpix of Google Cloud Vision die binnen 2-5 sec per pagina werkt. In beide gevallen het OCR-deel uit de inline upload-flow halen — als achtergrond-job met status-polling op de bibliotheek-pagina.
15. **Her-extract endpoint** voor bestaande documenten: `POST /api/documents/[id]/her-extract` dat het origineel uit Storage haalt, opnieuw door `extractTekst` haalt en chunks vervangt. Nuttig na verbeteringen aan de extractie-pipeline (zoals deze release).

---

## Strategische verkenning multi-sector platform

Tijdens een commerciële verkenning in mei 2026 is in kaart gebracht hoe het portaal zou kunnen schalen voorbij pensioenfondsen — naar verzekeraars, woningcorporaties en op termijn andere sectoren met vergelijkbare governance-structuur. Niets hiervan is gebouwd; deze sectie bewaart het denkkader voor latere besluitvorming.

### Conceptueel kader

Het portaal wordt opgesplitst in drie verticale lagen, met een aparte AI-laag ertussen:

1. **Sector pack** (verschilt per sector) — dashboard-module, procedure-templates, GI-context, bron-categorieën, risicocategorieën
2. **Governance Intelligence** (gedeelde infrastructuur, sector-context) — twee AI-toepassingen: **Institutional Memory** (archief van besluitvorming, doorzoekbaar met bron-citaten) en **Regulatory Guardrail** (continue spiegel op vigerende regelgeving)
3. **Core platform** (één codebase voor iedere sector) — documentbibliotheek, vergaderingen, AI-assistent, AI-voorbereiding, procedure-engine, risicomatrix, notulen, audit-export
4. **Fundament** (multi-tenant infrastructuur) — identity/SSO, RLS, versleutelde opslag, multi-tenant DB, compliance (ISO 27001 / SOC 2)

De positionering is "**Besturingssysteem voor verantwoordelijkheid**" — niet een board-tool die documenten toont, maar een platform dat besturen sneller de juiste vragen laat stellen, eerder blind spots laat herkennen, en besluiten met betere onderbouwing laat motiveren.

### Drie sectoren — markt en GI-toepassing

| Sector | Markt NL | Gem. contract | ARR-potentieel | Sector-specifieke GI-toepassing |
|--------|----------|---------------|----------------|--------------------------------|
| Pensioenfondsen | ~150 | €25k | €2-4M | **Evenwichtigheidsmonitor** — markeert in stukken waar aannames afwijken van het Wtp-transitieplan |
| Verzekeraars | ~150 | €35k | €3-5M | **Solvency & Risk Co-pilot** — kruist incidentenlogs met SCR-projectie, markeert nieuwe DNB Good Practices |
| Woningcorporaties | ~270 | €15k | €2-4M | **Drempelwaarde-Bewaker** — controleert mandaten, signaleert afwijking van prestatieafspraken met gemeente |

Totaal Nederlandse markt voor deze drie sectoren: ~570 organisaties, ARR-potentieel €7-13M.

### Schaalbaar voorbij deze drie sectoren

Het patroon werkt voor iedere sector met bestuurlijke governance + regulator + procedure-load. Logische uitbreidingen: zorginstellingen (IGJ/NZa), onderwijsinstellingen (Inspectie), vermogensbeheerders (AFM), goede doelen (CBF), sportbonden (NOC*NSF), UMC's, ZBO's, brancheverenigingen. Discipline is hier essentieel: niet 4 sectoren tegelijk aanvallen, maar één sector goed winnen voordat de volgende start.

### Kwaliteitswaarborging — drie principes

Voor elke AI-functie in het portaal, niet optioneel:

1. **Verifieerbaarheid** — geen bewering zonder citatie; deeplinks naar bron-notulen of beleidsstukken; hallucinaties uitgesloten doordat AI alleen vanuit beschikbaar bronmateriaal mag spreken
2. **Human-in-the-loop** — AI signaleert, vat samen, spiegelt en adviseert, maar besluit nooit; geen automatische acties op kritische besluitmomenten
3. **Data-soevereiniteit** — EU-hosting, klantdata wordt nooit gebruikt voor training publieke modellen, archief blijft eigendom van organisatie

**Belangrijkste reframings** (na kritische review): het portaal verlaagt **niet** de hoofdelijke aansprakelijkheid van bestuurders — die blijft persoonlijk en wettelijk verankerd. Het verhoogt de **kwaliteit van de onderbouwing**. AI is geen "onafhankelijke toetssteen" maar een **spiegelfunctie**. "Dual-Engine AI" framing vermijden — dit zijn twee AI-toepassingen op één infrastructuur, niet twee fysieke engines.

### Strategische pijlers (commerciële winst)

1. **Snel uitrolbaar in nieuwe sectoren** — circa twee maanden per sector in plaats van zes
2. **Differentiatie van generieke board-tools** (iBabs, Diligent) — sector-specifieke configuratie i.p.v. one-size-fits-all
3. **Marginale ontwikkelkosten dalen per sector** — verbetering aan core profiteert iedere sector tegelijkertijd
4. **Template-bibliotheek als content-moat** — sector-specifieke procedures gecureerd door domeinexperts
5. **Sector-brede benchmarks (roadmap)** — geanonimiseerde patronen over de sector heen, waardevol vanaf circa 30-50 klanten per sector, vraagt juridisch kader voor anonimisering

### Compliance-by-Design Workflow

Vijf-staps cyclus die de propositie concreet maakt voor sales:

| Fase | Traditioneel | Met Governance Intelligence |
|------|--------------|---------------------------|
| Creatie | Stukken op basis van vorig jaar | Drafting op vigerende sector-templates |
| Validatie | Handmatige check op kaders | Automatische signalering drempelwaarden |
| Review | Honderden pagina's PDF | Executive summaries per rol |
| Vergadering | Notulen leggen <em>wat</em> vast | Smart transcripts leggen ook <em>waarom</em> vast |
| Verantwoording | Wekenlang dossier zoeken | Eén klik: volledig dossier gereproduceerd |

### Deliverables in de workspace

Drie bestanden in de projectmap als referentiemateriaal:

- **`Procedures-per-sector.docx`** — 30 pagina's A4 met 8 procedures per sector (24 totaal) uitgewerkt met trigger, frequentie, eigenaar, doorlooptijd, regelgeving, stappen met checklist en bewijs/besluit-vereisten, plus aandachtspunten. Direct bruikbaar als seed-data voor de procedure-templates-tabel als de engine wordt uitgebouwd.
- **`Sector-pack-architectuur.html`** — technische uitwerking met SQL-migrations, code-voorbeelden en file-by-file changes. Voor developer-context als de implementatie ooit start.
- **`Sector-pack-concept.html`** — strategisch concept-document (niet-technisch) met overlap-analyse, GI-toelichting, sector-scenario's, kwaliteitswaarborging en strategische opbrengst. Voor gesprekken met bestuurders, partners, investeerders.
- **`Architectuur-multi-sector.html`** — interactieve architectuurplaat (vier lagen, drie sector-tabs), laat in één oogopslag zien wat per sector verandert en wat gedeeld blijft.

### Status van de verkenning

Niets hiervan is gebouwd. De huidige codebase blijft pensioen-only met hardgecodeerde Wtp-dashboards en pensioen-specifieke prompts. De technische migratie naar sector packs zou starten met de hernoeming van `fondsen` naar `organisaties`, een nieuwe `sectoren`-config-tabel en het verplaatsen van `lib/proces-templates.ts` naar de database. Voor de volledige fasering zie het architectuur-document.

Belangrijkste open vragen voor latere sessies: (1) eerste betaalde pilot binnenhalen in pensioen voordat sector-uitbreiding start, (2) keuze tussen bootstrap-route en seed-funding, (3) ISO 27001-traject starten als enterprise-sales serieus wordt.

---

## Decision Object — proceduremodule MVP-1 (in uitvoering)

In mei 2026 is een grote doorontwikkeling van de proceduremodule gestart: het verschuiven van *workflow & case management* (Plateau 1) naar *procedure-led governance* met een centraal **Decision Object** als ruggengraat (Plateau 2). De inhoudelijke spec staat in twee bijlagen die Merlin heeft aangeleverd: `Inrichting module procedure - aangescherpt.docx` (functionele specificatie, 06-05-2026) en `GOS_Compleet_Operating_Model_Architectuur_Roadmap.pdf` (operating model + plateau-roadmap). Beide zijn input voor het ontwerpdocument hieronder.

### Status (per 8 mei 2026)

- **Fase 0 — ontwerpdocument**: klaar in twee revisierondes. Zie [`PROCEDURE-MVP1-ONTWERP.md`](./PROCEDURE-MVP1-ONTWERP.md) — versie 2.1 met revisielog. Bevat datamodel, statusmodel, readiness-niveaus, fasering 1A/1B/1C/1D/1E, RLS-strategie en demo-vragen voor 1B.
- **Fase 1A — schema-migratie**: klaar en gedraaid op live Supabase (project `aebwiufuegsiwhwpdrfb`) op 7 mei 2026. Migratie: [`supabase/migrations/2026_05_07_decision_object.sql`](./supabase/migrations/2026_05_07_decision_object.sql). Rollback (alleen als nodig): [`2026_05_07_decision_object_ROLLBACK.sql`](./supabase/migrations/2026_05_07_decision_object_ROLLBACK.sql). Pre-flight + post-flight + rookproef in transactie zijn allemaal groen.
- **Fase 1B — template-seed + auto-upgrade + types + dossier-API**: code klaar op 8 mei 2026, seed-migratie [`supabase/migrations/2026_05_08_phase_1b_template_requirements.sql`](./supabase/migrations/2026_05_08_phase_1b_template_requirements.sql) gedraaid op live Supabase. Nieuwe template `beleidswijziging_beleggingsbeleid` (6 stappen) in [`lib/proces-templates.ts`](./lib/proces-templates.ts). Auto-upgrade-helper en evidence-synthese in [`lib/decision.ts`](./lib/decision.ts) (`ensureDecisionForProcedure`, `buildDecisionDossierView`, `buildEvidenceLijst`, `filterDissentOpRol`). TypeScript-types als frontend-contract in [`lib/decision-view.ts`](./lib/decision-view.ts) (`DecisionDossierView` met alle subtypes, plus `mapLegacyStatus`). Dossier-API: [`GET /api/procedures/[id]/dossier`](./app/api/procedures/[id]/dossier/route.ts) (lazy auto-upgrade) en [`GET /api/decisions/[id]/dossier`](./app/api/decisions/[id]/dossier/route.ts) (direct).
- **Fase 1C — UI + mutatie-routes + review-fixes**: code klaar op 8 mei 2026, `tsc --noEmit` groen. Aanvullende migratie [`supabase/migrations/2026_05_08_phase_1c_requirements_columns.sql`](./supabase/migrations/2026_05_08_phase_1c_requirements_columns.sql) — **nog draaien in Supabase Dashboard → SQL Editor** — voegt `vereist_validatie_domein` en `min_aantal` toe aan `procedure_requirements` en update de bestaande seed-rijen. Vier nieuwe componenten onder `app/(dashboard)/procedures/_components/`: [`DecisionObjectHeader`](./app/(dashboard)/procedures/_components/DecisionObjectHeader.tsx) (banner met besluitcode, status, classificatie-pills), [`ClassificatiePanel`](./app/(dashboard)/procedures/_components/ClassificatiePanel.tsx) (zes dimensies + besluitvraag/scope edit-mode, segment-radios), [`ReadinessLadder`](./app/(dashboard)/procedures/_components/ReadinessLadder.tsx) (zes niveaus, uitklapbare ontbrekende-items per niveau), [`StapRequirementsPaneel`](./app/(dashboard)/procedures/_components/StapRequirementsPaneel.tsx) + [`AIValidatieBlok`](./app/(dashboard)/procedures/_components/AIValidatieBlok.tsx) (per actieve stap zichtbare requirements + AI-output validatie). Twee mutatie-routes: [`PATCH /api/decisions/[id]`](./app/api/decisions/[id]/route.ts) (classificatie + besluitvraag/scope met diff-logging in `governance_events` en eenmalig `classificatie_bevestigd` event) en [`PATCH /api/decisions/[id]/ai-interactions/[aiid]`](./app/api/decisions/[id]/ai-interactions/[aiid]/route.ts) (validatiestatus + aangepaste output + gebruikt_in_dossier met domein-rolcheck en `ai_output_<status>` events). Review-fixes uit 1B meegenomen: domein-detectie via kolom i.p.v. label-regex (issue 4), drempel-aantal via kolom i.p.v. label-regex (issue 5), governance-event-error tijdens auto-upgrade gooit nu expliciet (issue 3), dupe import opgeruimd (issue 1). Procedure-detailpagina geïntegreerd: Decision Object header bovenaan, classificatie-panel + readiness-ladder als 2-koloms blok onder de meta-strook, stap-requirements-paneel naast het bestaande `ActieveStapPaneel`. Volgende: migratie draaien + Fase 1D (besluitregistratie, dissent, aannames, risico's).
- **Fase 1D — besluitregistratie + dissent + aannames + risico's**: nog te doen.
- **Fase 1E — auditdossier-export (HTML/JSON)**: nog te doen.

### Wat er nu structureel in de database staat (post-1A)

Elf nieuwe tabellen, elk met RLS via `fonds_id`-koppeling: `decision_objects` (centraal besluitdossier met multi-dimensionele classificatie: `complexiteit`, `risiconiveau`, `mandaatgevoelig`, `toezichtgevoelig`, `beleidsafwijking`, `ai_risicoklasse`), `decision_assumptions`, `decision_risks`, `decision_dissent` (met `zichtbaarheid`-gradaties privé/gedeelde_zorg/formele_dissent/minderheidsnotitie), `decision_conditions`, `decision_actions`, `decision_evaluations`, `decision_ai_interactions` (met `validatie_domein` voor RLS, plus `gebruikt_in_dossier`/`gebruik_context`/`verworpen_reden` voor de auditvraag *welke AI-output heeft besluit beïnvloed?*), `procedure_requirements` (generiek met `requirement_type`-enum: document/field/assumption/risk/ai_validation/approval/mandate_check/kpi/evaluation/dissent_review), `governance_events` (append-only via triggers, sha256 hash per event), `decision_audit_snapshots` (auto-gevuld bij overgang naar `besloten`/`voorwaardelijk_besloten`/`in_evaluatie`/`afgesloten`).

Tien nieuwe Postgres-functies: `fn_decision_code` (auto `BSL-2026-NNNN`), `fn_decision_touch`, `fn_decision_status_check` (whitelist van toegestane overgangen, 14 statussen conform spec §23.1), `fn_decision_snapshot` (snapshot bij besluitvorming), `fn_govevent_immutable` + `fn_govevent_hash`, `fn_snapshot_immutable`, `fn_build_decision_dossier(decision_id)` (view-builder, single source of truth voor live API én snapshot), `fn_decision_readiness_check(decision_id, target)` (zes targets: onderbouwing_compleet/reviewrijp/bespreekrijp/besluitrijp/verantwoordingsrijp/evaluatierijp), `fn_decision_readiness_overview(decision_id)`. Negen actieve triggers. Eén partial unique index `idx_dobj_one_primary` op `decision_objects(procedure_id) where is_primary_decision = true` — geeft 1:1-gedrag voor MVP zonder dat 1:n later een datamigratie vergt.

Bestaande tabellen onaangetast; alleen kolom `procedures.decision_id` toegevoegd als handige FK. Geen bestaande proceduredata getroffen (waren toch 0 rijen op het moment van migreren).

### Belangrijke ontwerpkeuzes (voor context bij 1B en verder)

- **Procedure leidend, documenten zijn bewijsstukken** — verschuiving van document-portaal naar governance-platform.
- **AI gecontroleerd binnen procedurestappen** — geen losse chatbot maar contextueel; elke output krijgt validatiestatus en bronverwijzing; `decision_ai_interactions.validatie_domein` bepaalt welke rol mag valideren.
- **Readiness als ladder, niet binair** — een dossier kan reviewrijp zijn maar nog niet besluitrijp; doorzetten naar volgende status alleen mogelijk bij bijbehorende readiness, of via expliciete override door voorzitter/beheerder (gelogd als `governance_event`).
- **Audit snapshot bij besluitvorming** — bevriest de dossierstand op het moment van besluit zodat reproduceerbaarheid niet afhangt van later wijzigende metadata. Snapshots zelf zijn append-only.
- **Bestaande proceduretabellen blijven werken** — backwards compatible. Auto-upgrade van legacy-procedures naar Decision Object gebeurt in lib-code (Fase 1B), niet in migratie.

---

## Voor de volgende sessie

Voorbeelden van openingen die snel productief maken:

- *"Lees HANDOVER.md en PROCEDURE-MVP1-ONTWERP.md. Ga verder met Fase 1D: aannames-, risico's- en dissent-panelen op de procedure-detailpagina + besluitregistratie-uitbreiding + status-overgangen via readiness-gate (met override-flow voor voorzitter/beheerder)."*
- *"Lees HANDOVER.md. Voer de demo-toetsing uit op de huidige UI (zeven vragen in §7.3 van het ontwerpdoc) en leg per vraag vast wat de bestuurssecretaris zei — dat sturen we als input bij naar Fase 1D."*
- *"Lees HANDOVER.md. Ik wil prompt caching implementeren in alle AI-routes."*
- *"Lees HANDOVER.md. Ik wil de Sparringpartner-modus voor voorbereidingen bouwen — interactief doorpraten op basis van een gegenereerde voorbereiding."*
- *"Lees HANDOVER.md. Ik wil een 'Bereid alles voor'-knop op een vergadering — voor alle agendapunten tegelijk."*
- *"Lees HANDOVER.md. Ik wil bewerken van risico's na aanmaken (Risicomatrix iteratie 2)."*
- *"Lees HANDOVER.md. Ik heb een bug op [pad]: [beschrijving]."*
- *"Lees HANDOVER.md. Ik wil de eerste fase van de multi-sector migratie starten — sector-tabel + organisaties-rename. Zie de strategische verkenning."*

In nieuwe sessies hoef je niet de geschiedenis van keuzes uit te leggen — die staan hier. Beschrijf wat je wilt veranderen en de nieuwe Claude-sessie kan via `Read` direct in de juiste files duiken.

**Patroon dat goed werkt voor nieuwe modules:** eerst klikbaar HTML-prototype maken (zie `prototypes/`), reviewen, dan iteratie 1 als werkende code (schemamigratie + paar pagina's + API-routes). Iteratie 2 op basis van gebruik. De prototypes zijn statische HTML met Tailwind via CDN en hash-routing — geen backend nodig om door te klikken.

**Patroon voor AI-features:** systeem-prompt schrijven als één duidelijke string in de top van de route-file, output in JSON-formaat met fall-back parsing voor ```` ```json ```` wrappers, RLS-context expliciet meegeven (`fonds_id`, `gebruiker_id`), bronnen apart bijhouden in `bronnen_meta` zodat de UI ze kan tonen. Voorbeelden: `app/api/agendapunten/[id]/voorbereiding/route.ts` en `app/api/procedures/[id]/stappen/[stapId]/besluit-concept/route.ts` — die twee delen hetzelfde patroon en zijn een goede referentie.

**Bij elke release de checklist:**
1. TypeScript-check `./node_modules/.bin/tsc --noEmit --skipLibCheck` moet exit 0
2. Schema-migratie `supabase/migrations/<datum>_<naam>.sql` schrijven én ook in `supabase/schema.sql` documenteren
3. Migratie eerst draaien in Supabase (vóór code-deploy, anders crashen inserts)
4. HANDOVER.md release-historie bijwerken
5. Commit + push via GitHub Desktop, Vercel deployt automatisch
6. Browser hard refresh als styling weg lijkt (Cmd+Shift+R)

---

## Release-historie

- **8 mei 2026** — **Decision Object MVP-1C — Decision-Object-UI + classificatie-mutatie + AI-validatie + review-fixes**. Derde van vijf subfases. Vier deliverables uit sectie 7.2 van het ontwerpdoc, plus de vier review-issues (1, 3, 4, 5) uit de tussentijdse code-review op 1B die in deze fase zijn meegenomen. **Schema-uitbreiding** (`supabase/migrations/2026_05_08_phase_1c_requirements_columns.sql`): twee nieuwe kolommen op `procedure_requirements`. `vereist_validatie_domein` (text, check-enum algemeen/risk/compliance/beleggingen/governance) vervangt de fragiele label-regex bij ai_validation-evidence-checks. `min_aantal` (int default 1, ≥ 1) vervangt de regex-match op "≥ 3" voor assumption-drempels. Bestaande 1B-seed-rijen worden in dezelfde migratie bijgewerkt: risk/compliance-AI-validations krijgen het juiste domein, kernaannamen-rijen krijgen `min_aantal=3`. Idempotent via `add column if not exists` + targeted updates. **UI-componenten** (vijf bestanden onder `app/(dashboard)/procedures/_components/`): `DecisionObjectHeader.tsx` als donker-blauwe banner bovenaan de procedure-detailpagina met besluitcode, status-badge, classificatie-pills (complexiteit, risiconiveau, mandaatgevoelig, toezichtgevoelig, beleidsafwijking, AI-risicoklasse) en een auto-upgrade-melding bij vers aangemaakte dossiers. `ClassificatiePanel.tsx` als client-component met inline edit-mode; segment-radios voor complexiteit/risiconiveau/AI-risicoklasse, checkboxes voor de drie booleans, plus textareas voor besluitvraag en scope; bewaren stuurt `classificatie_bevestigd: true` mee zodat de readiness-field-check vervuld wordt. `ReadinessLadder.tsx` toont alle zes niveaus met groen vinkje bij voldoet of een gold-ringed cijfer bij de eerste niet-vervulde target; per niveau uitklapbaar de lijst van ontbrekende requirements gegroepeerd op stap met requirement-type-label, optionele documenttype-hint en blokkerend-vlag. `StapRequirementsPaneel.tsx` toont per actieve stap de evidence-rijen die op die stap-volgorde slaan, met emerald-vinkje of rose/amber-driehoek per item, plus een teller "X van Y voldaan". `AIValidatieBlok.tsx` is een client-component per AI-output met type-/domein-/status-pills, uitklapbare volledige output, bron-lijst, textareas voor `aangepaste_output`/`gebruik_context`/`verworpen_reden`, en vier knoppen (Valideren / Aangepast bewaren / Afkeuren / Gebruiken in dossier). Bij domeinen anders dan `algemeen` wordt expliciet getoond dat alleen voorzitter/beheerder mag valideren. **Mutatie-routes**: `PATCH /api/decisions/[id]` accepteert subset van `{titel, besluitvraag, aanleiding, scope, governance_orgaan, vertrouwelijkheid, eigenaar_naam, gewenste_besluitdatum, complexiteit, risiconiveau, mandaatgevoelig, toezichtgevoelig, beleidsafwijking, ai_risicoklasse, classificatie_bevestigd}`, blokkeert expliciet status-updates (komen in 1D), valideert enum-waarden, splitst de diff-loggen in twee events: `decision_metadata_gewijzigd` voor algemene velden en `classificatie_gewijzigd` voor de zes dimensies, en logt eenmalig `classificatie_bevestigd` (only-once-check via count-query) zodra de gebruiker bewust op Bewaren klikt. `PATCH /api/decisions/[id]/ai-interactions/[aiid]` valideert validatiestatus, doet een server-side rolcheck voor specialistische domeinen (geeft 403 met begrijpbare boodschap als de gebruiker niet voorzitter/beheerder is) bovenop de RLS-policy, zet `gevalideerd_door`/`gevalideerd_op` automatisch bij niet-concept statussen, en logt een dynamisch `ai_output_<status>`-event. **Review-fixes uit 1B meegenomen** (issues 1, 3, 4, 5): `lib/decision.ts` heeft niet langer een dubbele import voor `ActionItem`, governance-event-fout tijdens `ensureDecisionForProcedure` gooit nu expliciet zodat een Decision Object zonder log-rij niet ongezien blijft, `buildEvidenceLijst` matcht ai_validation op de nieuwe kolom `vereist_validatie_domein` en assumption-drempels op `min_aantal` zonder nog naar het label te kijken. **Procedure-detailpagina** (`app/(dashboard)/procedures/[id]/page.tsx`): Decision Object wordt lazy opgehaald via `ensureDecisionForProcedure` + `buildDecisionDossierView`, in een try/catch zodat de bestaande pagina blijft werken als het dossier-blok faalt. Boven de oude header staat nu de Decision Object-banner; onder de meta-strook een 2-koloms-grid met classificatie-panel en readiness-ladder; naast het bestaande `ActieveStapPaneel` het stap-requirements-paneel met daarin AI-validatieblokken. `tsc --noEmit --skipLibCheck` groen. Nog níet gedraaid: de nieuwe migratie. Volgende stap: SQL-seed draaien in Supabase + Fase 1D (besluitregistratie, dissent, aannames, risico's, voorwaarden, status-overgangen met readiness-gate).
- **8 mei 2026** — **Decision Object MVP-1B — template-seed + auto-upgrade + dossier-API + types**. Tweede van vijf subfases. Vier deliverables uit sectie 7.2 van `PROCEDURE-MVP1-ONTWERP.md` (rev. 2.1) zijn nu klaar als code; SQL-seed wacht op handmatig draaien in Supabase. **(1) Template-seed**: nieuwe template `beleidswijziging_beleggingsbeleid` (6 stappen — Concept & aanleiding / Onderbouwing / Validatie & risk review / Bestuursoverleg & agendering / Besluitvorming / Implementatie & evaluatie) toegevoegd aan `lib/proces-templates.ts`, plus 16 bijbehorende `procedure_requirements`-rijen in `supabase/migrations/2026_05_08_phase_1b_template_requirements.sql`. Conditionele activatie via classificatie-dimensies werkt zoals beschreven in sectie 4.9: liquiditeitsanalyse alleen bij `risiconiveau=hoog`, mandaatcheck alleen bij `mandaatgevoelig=true`, ≥3 kernaannames bij complex/hoog (gesplitst in twee rijen conform OR-pattern). Idempotent via `delete + insert` in een transactie. Migratie nog níet gedraaid op live Supabase; dat wacht op de tussentijdse demo. **(2) Auto-upgrade**: `lib/decision.ts` met `ensureDecisionForProcedure(supabase, procedureId)` dat lazy een Decision Object aanmaakt voor procedures zonder gekoppelde `decision_id`. Statusmapping legacy → nieuw via `mapLegacyStatus`: `in_uitvoering` → `in_onderbouwing`, `wacht_op_besluit` → `in_review`, `afgerond` → `afgesloten` (de status-trigger werkt alleen op UPDATE, dus directe INSERT in deze eindstand mag). Placeholder-besluitvraag "Aanvullen na auto-upgrade — formuleer hier de centrale besluitvraag" maakt zichtbaar dat de bestuurder dit veld moet invullen. Auto-upgrade logt een `decision_object_auto_created` event in `governance_events` met legacy- en nieuwe status in de payload. **(3) Frontend-types**: `lib/decision-view.ts` definieert `DecisionDossierView` met alle subtypes (DecisionObject, ProcedureSummary, ProcedureStep, ReadinessOverview, EvidenceItem, Assumption, RiskItem, AIInteraction, DissentItem, DecisionCondition, ActionItem, Evaluation, GovernanceEvent, AuditSnapshotMeta, Scenario), single source of truth voor zowel de API-response als de UI in 1C. Status-/risiconiveau-/complexiteit-labels staan klaar voor weergave. **(4) Dossier-API**: twee routes — `GET /api/procedures/[id]/dossier` (met lazy auto-upgrade) en `GET /api/decisions/[id]/dossier` (direct). Beide bouwen het complete `DecisionDossierView` op door (a) `fn_decision_readiness_overview` aan te roepen voor alle zes readiness-niveaus, (b) per `procedure_requirements`-rij te beoordelen of de requirement vervuld is via `buildEvidenceLijst` (document-match via stap+titel, AI-validatie met domein-detectie via label, drempel-3 voor "≥ 3 kernaannames", etc.), (c) dissent te filteren op zichtbaarheid × rol als defense-in-depth bovenop RLS, en (d) snapshots-meta op te halen zonder payload (die alleen via auditdossier-export in 1E vrijkomt). De API geeft `auto_upgraded: true` mee zodat de UI in 1C een banner kan tonen. Geen schema-wijzigingen behalve de seed-migratie. `tsc --noEmit --skipLibCheck` groen. Volgende stap: SQL-seed draaien in Supabase Dashboard, daarna tussentijdse demo (zeven toetsvragen in sectie 7.3 van het ontwerpdoc) met de bestuurssecretaris vóórdat de UI van 1C wordt gebouwd.
- **7 mei 2026** — **Decision Object MVP-1A — schema-fundament voor proceduremodule v2**. Eerste van vijf subfases (1A t/m 1E) in de doorontwikkeling van de proceduremodule van Plateau 1 (workflow & case management) naar Plateau 2 (procedure-led governance) conform de aangeleverde GOS-spec (`Inrichting module procedure - aangescherpt.docx`, 06-05-2026). Migratie voegt elf nieuwe tabellen toe: `decision_objects` als centraal besluitdossier (met multi-dimensionele classificatie: complexiteit/risiconiveau/mandaatgevoelig/toezichtgevoelig/beleidsafwijking/ai_risicoklasse, plus uitgebreid statusmodel met 14 statussen en getriggerde whitelisting van overgangen), `decision_assumptions`, `decision_risks`, `decision_dissent` (met zichtbaarheidsgradaties privé/gedeelde_zorg/formele_dissent/minderheidsnotitie en strenge RLS), `decision_conditions`, `decision_actions`, `decision_evaluations`, `decision_ai_interactions` (met `validatie_domein` voor RLS-policy + audit-velden gebruikt_in_dossier/gebruik_context/verworpen_reden), generieke `procedure_requirements` (vervangt het te documentgerichte evidence-model met requirement_type-enum over 10 types), append-only `governance_events` met sha256 hash per event, en `decision_audit_snapshots` (auto-gevuld bij overgang naar besloten/voorwaardelijk_besloten/in_evaluatie/afgesloten via trigger). Tien nieuwe Postgres-functies waaronder `fn_build_decision_dossier(decision_id)` als single source of truth voor live API én snapshot, `fn_decision_readiness_check(decision_id, target)` met zes readiness-niveaus (onderbouwing_compleet/reviewrijp/bespreekrijp/besluitrijp/verantwoordingsrijp/evaluatierijp), en `fn_decision_status_check` die ongeldige statusovergangen blokkeert. Decision Object is voorbereid op 1:n (partial unique index op `is_primary_decision`) zonder dat MVP-1 last heeft van die toleratie. Backwards compatible: bestaande `procedures`-tabellen onveranderd, alleen kolom `procedures.decision_id` toegevoegd als FK. Auto-upgrade van bestaande procedures naar Decision Object volgt in 1B (lib-code, geen schema-wijziging). Ontwerpdocument: `PROCEDURE-MVP1-ONTWERP.md` (v2.1, na twee externe reviewrondes). Migratie: `supabase/migrations/2026_05_07_decision_object.sql`. Rollback: `2026_05_07_decision_object_ROLLBACK.sql`. Live gedraaid op project `aebwiufuegsiwhwpdrfb`; rookproef in transactie groen.
- **4 mei 2026** — **PDF-extractie hotfix: woordafbreking + soft hyphens**. Tijdens testen bleek een InDesign-document (`Code Pensioenfondsen 2024.pdf`) nog steeds slecht doorzoekbaar omdat 65 woorden aan einde regel waren afgebroken met een streepje (`vertegen-\nwoordigt`, `pensioen-\nfonds`, `belangen-\nafwegingen`) — typische typografische opmaak die de tokenizer als losse fragmenten zag. `voegTekstItemsSamen` in `lib/document-extractie.ts` plakt deze nu correct samen: bij een regel-break wordt gecontroleerd of de regel eindigt op `letter-` en de volgende regel begint met een kleine letter; zo ja, dan koppelteken weg en woorden samenvoegen zonder newline. Daarnaast worden soft hyphens (U+00AD) defensief gestript in `schoonTekst`. Diagnostiek uitgebreid met `hyphenFragmenten`-teller en aparte log-warning. Geen schemamigratie. Verificatie: extractie van het probleem-PDF gaat van 65 hyphen-fragmenten naar 0, alle samengestelde woorden worden weer gevonden (bijv. `pensioenfonds` 116x).
- **4 mei 2026** — **Multi-format documentupload + grondig verbeterde PDF-extractie**. De bibliotheek en agendapunt-uploaders accepteren nu naast PDF ook **Word (.docx)** en **Excel (.xlsx)**. Per type een dedicated extractor in nieuw bestand `lib/document-extractie.ts`: PDF via `unpdf` (vervangt `pdf-parse`), DOCX via `mammoth.extractRawText`, XLSX via `xlsx` (SheetJS) — Excel-tabbladen worden omgezet naar markdown-tabellen met `## Tabblad: <naam>` als kop, pipes en interne newlines ge-escaped. Inzage-route (`GET /api/documents/[id]/bestand`) serveert origineel met juiste content-type per type (PDF inline, Word/Excel als download). UI toont kleine type-badge per rij in de bibliotheek (PDF rood, Word blauw, Excel groen) en gebruikt "tabbladen" i.p.v. "pagina's" voor Excel. Migratie: nieuwe kolom `documenten.bestandstype` (check-constraint op pdf/docx/xlsx, default `'pdf'` voor bestaande records). **PDF-extractie fundamenteel verbeterd**: de oude `pdf-parse` plakte text-items klakkeloos achter elkaar zonder spaties (PDF's emiteren woorden vaak als losse positionele items zonder echte spatie-karakters ertussen) — resultaat was `"Decommissieheefteenadviesuitgebracht"`, funest voor full-text search. Vervangen door `unpdf` (modern pdfjs onder de motorkap) met eigen `voegTekstItemsSamen`-functie die per text-item naar X/Y-coördinaten kijkt en op basis van X-gap een spatie invoegt, op basis van Y-verandering een line- of paragraaf-break. **Chunker als drie-traps cascade** in `lib/rag.ts`: paragraaf → zin (`. `, `? `, `! ` gevolgd door hoofdletter) → woordgrenzen — voorkomt afkappen midden in een woord of zin. **Diagnostiek-helper** `diagnoseerExtractie` waarschuwt in de Vercel-logs zodra >5% van de woorden in een PDF langer is dan 30 chars — vroege signalering van probleem-PDF's zonder de upload te blokkeren. **OCR voor gescande PDF's bewust niet ingebouwd** vanwege Vercel function-timeouts, read-only filesystem, en grote function-size door tesseract.js + canvas-binaries. Gescande PDF's worden geweigerd met instructie naar Acrobat/Preview. Migratie: `supabase/migrations/2026_05_03_documenten_bestandstype.sql`.
- **3 mei 2026** — **Bronvermelding explicieter in AI-chat**. De `[Bron N]`-markers in een AI-antwoord zijn niet langer platte tekst maar klikbare gouden pills die hetzelfde nummer dragen als de bronkaart eronder. Klik → de bijbehorende kaart krijgt een korte goud-randpuls en scrollt in beeld; hover → tooltip met titel, paragraaf/pagina en het fragment. Bronkaart heeft links nu een gekleurde nummer-pill die matcht met de bronlabel-kleur (DNB rood, AFM blauw, etc.) en is zelf een klikbare link die het origineel via `/api/documents/[id]/bestand` in een nieuw tabblad opent. Voor documenten zonder `opslag_pad` wordt de kaart niet-klikbaar (geen cursor-pointer, geen ↗) en toont een subtiele "Origineel niet beschikbaar"-hint. Voor visuele consistentie zijn ook `[Algemene kennis]` en `[Volgens wetgeving]` als grijze (niet-klikbare) pill-markers gerenderd. Systeem-prompt in `app/api/chat/route.ts` aangescherpt: Claude moet markers altijd als afzonderlijke `[Bron N]` schrijven (niet `[Bron 1, 2]`), bij élke feitelijke claim, en direct ná de claim. `BronVerwijzing` in `lib/rag.ts` heeft nieuw veld `heeft_origineel: boolean` zodat de UI vooraf weet of de PDF-link kan. Geen schemamigratie nodig — het is een afgeleid veld op basis van `documenten.opslag_pad`.
- **3 mei 2026** — **Documentinzage + deactivatie + audit-log**. Bestuurders kunnen geüploade PDFs nu inzien — de upload-route slaat het origineel op in een nieuwe Supabase Storage bucket `documenten` (private, RLS volgt het patroon van `public.documenten`). Pad-conventie: `<fonds_uuid>/<document_uuid>.pdf` voor fonds-bibliotheek, `generiek/<document_uuid>.pdf` voor de generieke bibliotheek. Inzage via `GET /api/documents/[id]/bestand` (streamt PDF inline met `Content-Disposition: inline`). **Deactivatie** vervangt verwijderen: `documenten` heeft nu kolom `actief boolean default true` plus audit-velden (`gedeactiveerd_op`, `gedeactiveerd_door`, `deactivatie_reden`). Inactieve documenten worden uitgesloten van RAG-zoeken (`lib/rag.ts` filter op `documenten.actief = true` over alle drie de zoekstrategieën) en van agendapunt-AI-voorbereiding. Originele PDF + chunks blijven intact zodat reactiveren met één klik kan. Rechten via `PATCH /api/documents/[id]`: voorzitter/beheerder mag altijd, uploader mag binnen 24 uur na upload zelf nog deactiveren; reactiveren alleen voorzitter/beheerder. Audit-trail in nieuwe tabel `document_inzage` met `document_titel_snapshot` zodat logregels leesbaar blijven (acties: `inzage`, `download`, `gedeactiveerd`, `gereactiveerd`). UI: `/bibliotheek`-rijen zijn klikbaar (PDF in nieuw tabblad), kebab-menu met Bekijken/Deactiveren/Reactiveren, confirmation-dialog met optionele reden, "gedeactiveerd"-badge met grijze styling, toggle "Toon gedeactiveerde documenten" (default uit), en een "Origineel niet beschikbaar"-label voor documenten die vóór deze release zijn geüpload (RAG blijft daar wél voor werken). Iedereen op het fonds ziet de gedeactiveerde lijst (transparant). Procedures-bewijsstukken: koppeling blijft bestaan, geen extra waarschuwing (optie a). Migratie: `supabase/migrations/2026_05_03_documenten_inzage_deactivatie.sql`.
- **3 mei 2026** — **Klantbeeld legenda-correctie**. In `MaandOntwikkelingClient.tsx` is de legenda *"Toevoegingen (overdracht in / FVP)"* vervangen door *"Toevoegingen (overdracht in)"*.
- **3 mei 2026** — **KPI "Jaarlijkse aanpassing uitkeringen" toegevoegd aan stuurinformatie**. Nieuw KPI-blokje op `/dashboard`, geplaatst tussen Financieringsgraad en Solidariteitsreserve. Waarde wordt dynamisch berekend uit de financieringsgraad volgens de regel **1/5 × (FG − 100%)** — bij FG = 105% dus +1,0%, bij FG = 95% −1,0%, bij de huidige demo-FG van 102,4% +0,5%. Tekenkleur is groen bij positief, rood bij negatief. Sub-label op de tegel: *"indicatie volgend jaar · 1/5 × (FG − 100%)"*. KPI-grid op `/dashboard` opgeschaald van 4 naar 5 kolommen (lg-breakpoint); responsief gedrag onveranderd. Persoonlijke homepage (`/`) is **niet** meegenomen — die houdt zijn 4-tile KPI-strook (financieringsgraad, solidariteitsreserve, vermogen, rendement YTD).
- **2 mei 2026** — **Klantbeeld cohorten-pagina vereenvoudigd**. Spreidingsbanden p10–p90, verwachte-stand-marker, kleurcodering op afwijking en aandacht-tabel verwijderd. Bar-hoogte toont nu *totaal* vermogen per cohort (aantal × gemiddeld eind-saldo). KPI-strook bovenaan met totaal fondsvermogen, top-cohort en gem. per deelnemer. De onderliggende data-laag (`spreiding`, `doelKapitaal`, `afwijking`, `projectie`, `doelOp67`) blijft beschikbaar in `Cohort` interface voor latere views.
- **2 mei 2026** — **Klantbeeld iteratie 1**. Nieuwe module met twee perspectieven: deelnemers (Maand-ontwikkeling per cohort + Cohorten naast elkaar) en werkgevers (KPI's, drie 24-maands trends voor PG/premie/salaris, werkgever-grootte-segmentatie en premie-inning-discipline per maand met norm-lijn). Onderliggende data komt uit `lib/klantbeeld-data.ts` met deterministische dummy-data: 51 leeftijdscohorten (18–68) met volledige Wtp-mechaniek (begin + premie + toevoegingen − onttrekkingen + kasrendement + beschermingsrendement RTS + overrendement + micro-langleven = eind), reconstructie sluit op €0,00. Cashflow-restposten *toevoegingen* (waardeoverdracht in / FVP) en *onttrekkingen* (waardeoverdracht uit) zijn meegenomen. Werkgevers-totalen afgeleid uit cohort-data: 387 aangesloten werkgevers, 36.500 actieve werknemers, ~€33M maandpremie, met realistische CAO-stappen in de 24-maands historie. Pagina's: `/klantbeeld` (redirect), `/klantbeeld/deelnemers` (default sub-tab Maand-ontwikkeling), `/klantbeeld/deelnemers/cohorten`, `/klantbeeld/werkgevers`. Nieuwe sidebar-entry "Klantbeeld" onder sectie Overzicht. Geen Supabase-migratie — dezelfde keuze als bij Wtp-dashboard, alle data komt uit lib. Prototype: `prototypes/klantbeeld-mockup.html`.
- **29 april 2026** — **AI-voorbereiding op agendapunten**. Nieuwe persoonlijke (privé) voorbereidingsfunctie geïntegreerd in het vergaderingen-onderdeel: per agendapunt kan een bestuurder een AI-ondersteunde voorbereiding genereren die niet samenvat, maar scherper denkt — kritische vragen, blinde vlekken en perspectieven. Twee snelheden: *snel* (alleen gekoppelde stukken + lichte RAG over bibliotheek) en *grondig* (volledige RAG + actieve risicomatrix-risico's + lopende procedures als context). Output volgt vaste JSON-structuur: 2-4 lenzen (uit BOB-model + stakeholders + uitvoerbaarheid/financierbaarheid/uitlegbaarheid), "wat staat er níet"-blok, drie kritische vergadervragen, en een ééns-zin-samenvatting. Per lens een eigen-notitie-veldje (alleen voor jou zichtbaar). "↓ Gebruik dit als startpunt voor mijn inbreng"-knop kopieert eigen notities + vragen naar de inbreng-textarea. Bronvermelding zichtbaar (documenten / risico's / procedures). Nieuwe tabel `voorbereidingen` met RLS op `gebruiker_id`. API-routes: `POST /api/agendapunten/[id]/voorbereiding` (genereer/regenereer) en `PATCH /api/agendapunten/[id]/voorbereiding/notities` (notities opslaan). Migratie: `supabase/migrations/2026_04_29_voorbereidingen.sql`.
- **29 april 2026** — **Procedures iteratie 2**. Twee extra hardcoded templates: **Uitbestedingsreview** (5 stappen) en **Incident-meldplicht DNB** (6 stappen, met tijdkritische triage). Koppeling **procedure-stap ↔ agendapunt**: nieuwe kolom `agendapunten.procedure_stap_id` (migratie `2026_04_29_procedures_iteratie2.sql`), op de detail-pagina van een procedure kun je een actieve stap met één klik in een komende vergadering plaatsen — er wordt automatisch een agendapunt aangemaakt met categorie *Oordeelsvorming* (of *Besluitvorming* bij stappen die een besluit vereisen) en een back-reference. **AI-besluit-concept**: nieuwe API-route `/api/procedures/[id]/stappen/[stapId]/besluit-concept` die op basis van procedure-context, eerdere stappen, checklist en bewijsstukken een conceptformulering + motivering opstelt via Claude. Knop "Concept met AI" naast het besluit-form vult automatisch de invoervelden in voor review. **"Uw open procedure-stappen"-widget** op de homepage toont actieve stappen waar je co-eigenaar bent, met deadline-indicatie (dringend bij ≤7 dagen).
- **29 april 2026** — **Procedures iteratie 1 — werkende implementatie**. Zeven Supabase-tabellen, drie pagina's onder `/procedures` (lijst, detail met step-rail + actief-stap-paneel + log, nieuw-form), vijf API-routes, hardcoded Beleidswijziging-template (6 stappen, 18 checklist-items), snapshot-pattern bij start, validatie bij voltooien (checklist + bewijs + besluit). Migratie: `supabase/migrations/2026_04_29_procedures.sql`. Demo-seed: één lopende procedure in stap 3.
- **29 april 2026** — **Risicomatrix iteratie 1 — werkende implementatie**. Drie Supabase-tabellen, vier pagina's onder `/risicomatrix` (overzicht met 5×5 heatmap + lijst per categorie, detail met maatregelen + log, nieuw-form, archief), vier API-routes, niveau-afleiding K+I met handmatige overschrijving, sluiten met verplichte motivering. Centrale config in `lib/risico-config.ts`. Migratie: `supabase/migrations/2026_04_29_risicomatrix.sql`. Demo-seed: 5 actieve + 1 gesloten risico.
- **29 april 2026** — Klikbare HTML-prototypes voor Procedures (`prototypes/procedures-mockup.html`) en Risicomatrix (`prototypes/risicomatrix-mockup.html`). Naamkeuze "Procedures" boven "Casussen". Vier categorieën risico's, prioriteits-kleuren, structureel/tijdelijk-flag.
- **29 april 2026** — Demofonds hernoemd naar **Stichting Pensioenfonds Horizon** (slug `horizon`). Agendapunt-categorie **Discussie** hernoemd naar **Oordeelsvorming** (BOB-model). Migratie: `supabase/migrations/2026_04_29_horizon_oordeelsvorming.sql`.
- **April 2026** — Eerste release: Wtp-dashboard, AI-assistent met drie modi, vergaderingen + agenda + inbreng, governance log, documentbibliotheek met FTS-RAG.

---

## Migratie-bestanden in volgorde

Voor een schone Supabase-setup vanaf nul, draai `mvp/supabase/schema.sql` in zijn geheel. Voor een bestaande database die al de eerste-release-tabellen heeft, draai per release het bijbehorende migratie-bestand (idempotent — alle gebruiken `if not exists` en `add column if not exists`):

1. `2026_04_29_horizon_oordeelsvorming.sql` — fondsnaam-rename + categorie-rename
2. `2026_04_29_risicomatrix.sql` — risico-tabellen + RLS + demo-seed
3. `2026_04_29_procedures.sql` — procedure-tabellen + RLS + demo-seed (één lopende Beleidswijziging-procedure)
4. `2026_04_29_procedures_iteratie2.sql` — `agendapunten.procedure_stap_id` koppeling
5. `2026_04_29_voorbereidingen.sql` — `voorbereidingen`-tabel + RLS
6. `2026_05_03_documenten_inzage_deactivatie.sql` — `documenten.opslag_pad`, deactivatie-velden, `document_inzage`-tabel + Storage-bucket
7. `2026_05_03_documenten_bestandstype.sql` — `documenten.bestandstype` kolom met check-constraint (pdf/docx/xlsx)
8. `2026_05_07_decision_object.sql` — Decision Object MVP-1A: 11 nieuwe tabellen, 10 functies, 9 triggers, 13 RLS-policies. Vereist `pgcrypto` (Supabase heeft die default aan). Rollback beschikbaar in `2026_05_07_decision_object_ROLLBACK.sql` — alléén gebruiken als je echt terug moet (drop alle Decision Object-tabellen en data).
9. `2026_05_08_phase_1b_template_requirements.sql` — Decision Object MVP-1B template-seed: 16 `procedure_requirements`-rijen voor template `beleidswijziging_beleggingsbeleid` (6 stappen). Idempotent via `delete + insert` in een transactie. Geen tabel-wijzigingen.
10. `2026_05_08_phase_1c_requirements_columns.sql` — Decision Object MVP-1C schema-uitbreiding: nieuwe kolommen `vereist_validatie_domein` en `min_aantal` op `procedure_requirements`, plus update van bestaande seed-rijen voor `beleidswijziging_beleggingsbeleid`. Idempotent.

Migraties zijn klein en geïsoleerd — geen schema-rollbacks nodig zolang je de volgorde aanhoudt.

---

*Laatst bijgewerkt: 8 mei 2026 — Decision Object MVP-1C UI + classificatie-mutatie + AI-validatie + review-fixes. Vijf nieuwe componenten onder `app/(dashboard)/procedures/_components/`, twee nieuwe API-routes (`PATCH /api/decisions/[id]` en `PATCH /api/decisions/[id]/ai-interactions/[aiid]`), één nieuwe migratie `supabase/migrations/2026_05_08_phase_1c_requirements_columns.sql` (nog te draaien). Procedure-detailpagina geïntegreerd. `tsc --noEmit` groen. Volgende stap: migratie draaien + Fase 1D.*
