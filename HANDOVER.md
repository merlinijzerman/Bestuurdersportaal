# Bestuurdersportaal MVP — Handover

> **Voor toekomstige Claude-sessies**: dit document is de samenvatting van wat is gebouwd, hoe het in elkaar zit, en wat de logische volgende stappen zijn. Lees dit eerst voordat je aan iets nieuws begint, zodat je niet de hele code hoeft te scannen.

---

## Wat dit project is

Een MVP-portaal voor bestuurders van Nederlandse pensioenfondsen, gebouwd voor Merlin Ijzerman. De kern is een AI-assistent die vragen beantwoordt op basis van fonds-documenten met traceerbare bronvermeldingen, aangevuld met modules voor stuurinformatie (Wtp-georiënteerd), documentbibliotheek, vergaderingen-voorbereiding, governance-logging en notulen.

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

- **Next.js 15.5+** met App Router (Server Components + Client Components)
- **TypeScript strict** (Vercel build doet `tsc --noEmit`)
- **Tailwind CSS 3.4** met custom kleuren `#0F2744` (navy) en `#C9A84C` (goud)
- **Supabase** voor Postgres + Auth + Row Level Security
- **@supabase/ssr** voor cookie-based auth in Server Components
- **Anthropic SDK** met `claude-sonnet-4-5` als model
- **pdf-parse** voor PDF-tekstextractie
- **GitHub Desktop** is hoe Merlin commit/pusht (geen terminal-git voor commits)

Geen aparte library voor charts — alle visuals zijn pure SVG of HTML/CSS met percentage-widths.

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
│   │   ├── dashboard/page.tsx      # /dashboard — Wtp-stuurinformatie (full)
│   │   ├── ai/page.tsx             # /ai — chat met drie modi en multi-turn
│   │   ├── bibliotheek/page.tsx    # /bibliotheek — document upload en lijst
│   │   ├── governance/page.tsx     # /governance — log van AI-vragen
│   │   ├── notulen/page.tsx        # /notulen — placeholder
│   │   └── vergaderingen/
│   │       ├── page.tsx            # lijst van komende/afgelopen
│   │       ├── [id]/page.tsx       # detail met agenda + inbreng + stukken
│   │       └── _components/        # client components: forms, kaarten
│   ├── api/
│   │   ├── chat/route.ts           # AI-chat (drie modi, multi-turn, RAG)
│   │   ├── documents/upload/route.ts # PDF upload + chunking + AI-samenvatting (bij vergaderstuk)
│   │   ├── vergaderingen/route.ts  # POST nieuwe vergadering
│   │   ├── agendapunten/route.ts   # POST nieuw agendapunt
│   │   └── inbreng/[id]/route.ts   # DELETE eigen inbreng
│   ├── auth/callback/route.ts      # Supabase OAuth/magic-link callback
│   ├── login/page.tsx              # login form
│   ├── globals.css                 # Tailwind + custom variabelen
│   └── layout.tsx                  # root layout
├── components/
│   └── Sidebar.tsx                 # navigatie met rolweergave
├── lib/
│   ├── supabase.ts                 # browser client
│   ├── supabase-server.ts          # server-side client (SSR cookies)
│   └── rag.ts                      # zoekRelevanteChunks, maakContext, maakChunks
├── supabase/
│   ├── schema.sql                  # complete schema (documentatie)
│   └── migrations/                 # idempotent migratie-scripts (per release)
├── package.json
├── next.config.ts                  # serverExternalPackages: ["pdf-parse"]
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
| `documenten` | PDF-uploads met bron (DNB/AFM/Pensioenfederatie/Intern/Extern), bibliotheek (generiek/fonds), `agendapunt_id`, `samenvatting_ai` |
| `document_chunks` | Per-document text-fragmenten met `tsvector` voor full-text search |
| `governance_log` | Elke AI-vraag met antwoord, bronnen (jsonb), `modus` (documenten/combineren/algemeen) |
| `vergaderingen` | Bestuursvergaderingen met datum, locatie, status |
| `agendapunten` | Agendapunten per vergadering met `categorie` (beeldvorming/oordeelsvorming/besluitvorming/informatie), volgorde, verantwoordelijke (vrije tekst — zie open punten) |
| `agendapunt_inbreng` | Inbreng vooraf van bestuursleden per agendapunt |

RLS policies filteren overal per fonds. Eigen-inbreng kan alleen door de eigen gebruiker geschreven/gewijzigd/verwijderd worden.

Het volledige schema staat in `mvp/supabase/schema.sql` (idempotent, kan opnieuw gerund worden zonder schade). Per release komt er een migratie-script bij in `mvp/supabase/migrations/` voor bestaande databases.

---

## Modules en wat ze doen

### Persoonlijke homepage (`/`)
Welkomststrook met dagdeel-groet, naam, rol, fondsnaam en eerstvolgende vergadering. Compacte 4-tile KPI-strook (financieringsgraad, solidariteitsreserve, vermogen, rendement YTD). "Voor u open"-widget toont aantal agendapunten waar je nog geen inbreng plaatste. "Uw recente activiteit" toont laatste 3 AI-vragen, inbrengen en uploads.

### Wtp-stuurinformatie (`/dashboard`)
Vier KPI-tegels, 24-maands trendgrafiek financieringsgraad (inline SVG), gedetailleerde Wtp-balans (activa: bescherming/overrendement/liquide; passiva: persoonlijke pensioenvermogens per cohort + solidariteitsreserve + compensatiedepot + operationele reserve), deelnemers-status-blok, signaleringen, openstaande acties. Alle cijfers zijn demo-data hardcoded in de page.

### AI Assistent (`/ai`)
Multi-turn chat met geschiedenisvenster van 12 berichten. Drie modi via segmented toggle: **Documenten** (strikt op interne bronnen, citaten verplicht), **Slim combineren** (default — interne bronnen aangevuld met algemene kennis, gemarkeerd onderscheid), **Algemeen** (open AI-assistent zonder beperking, gele waarschuwing bij elk antwoord). Persoonlijke aanspreking via systeem-prompt met naam/rol/fondsnaam. Gespreksgeschiedenis wordt op de frontend bijgehouden; "Nieuw gesprek"-knop wist alles. Elke vraag wordt gelogd in `governance_log` inclusief gebruikte modus.

### Documentbibliotheek (`/bibliotheek`)
PDF-upload via formulier. Bij upload: `pdf-parse` extraheert tekst, `lib/rag.ts maakChunks()` splitst in fragmenten, fragmenten gaan naar `document_chunks` met automatische `tsvector` indexering voor full-text search. Documenten getagd met bron en bibliotheek (generiek/fonds).

### Vergaderingen (`/vergaderingen`)
Lijst-view scheidt komend en afgelopen. Detail-view toont meeting-header, stats, agendapunten als uitklapbare kaarten met categorie-badge (kleur per categorie). Per agendapunt: documentupload (triggert ook AI-samenvatting), inbreng-formulier voor andere bestuursleden. AI-samenvatting volgt vaste structuur (aanleiding / hoofdpunten / gevraagd besluit / aandachtspunten) als JSON, frontend rendert gestructureerd.

### Governance Log (`/governance`)
Lijst van alle gestelde AI-vragen per fonds met datum, gebruiker, vraag, modus en bronnen. Audit-trail.

---

## Belangrijke ontwerpkeuzes

### AI-tooninstellingen (LET OP — kostbaar werk)
De systeem-prompt in `app/api/chat/route.ts` is bewust in detail uitgewerkt om antwoorden warm en menselijk te laten klinken zonder corporate-wolligheid. Drie blokken: **VORM** (prose-first, geen bullets-by-default, geen titels), **INHOUD** (toon redenering, erken complexiteit), **REGISTER** ("u" maar warm, voornaam sporadisch). Plus VOORBEELDEN VAN HOE TE BEGINNEN en NOOIT ZO BEGINNEN. Wijzig dit blok met beleid — kleine veranderingen sturen de hele toon.

`max_tokens` staat op 2500 voor ruimte voor uitgebreide antwoorden. Model: `claude-sonnet-4-5`.

### RAG zonder vector embeddings
Postgres full-text search via `tsvector` (Dutch config) is bewust gekozen boven vector embeddings. Voor MVP-volume van honderden documenten is FTS prima. Bij schaal naar duizenden grote PDFs is migratie naar pgvector een logische volgende stap.

### Wtp als leidend perspectief
Sinds de gebruiker erop wees dat dekkingsgraad onder Wtp niet meer relevant is, is alle stuurinformatie omgebouwd naar **financieringsgraad** (vermogen ÷ verplichtingen), **persoonlijke pensioenvermogens per cohort**, en **solidariteitsreserve**. Het portaal richt zich expliciet op fondsen die al zijn ingevaren of er dichtbij zijn.

### Drie AI-modi
Gebruikers wilden expliciete keuze tussen strikt-RAG en vrij AI. Drie-staps toggle (Documenten / Combineren / Algemeen) i.p.v. binaire knop omdat formele rapportage-context strikt-RAG verlangt terwijl casual context de algemene kennis nuttig vindt. Default: combineren.

### Multi-turn met sliding window
History limit op 12 berichten (HISTORY_LIMIT in `app/api/chat/route.ts`). Geen samenvatting van oudere berichten — die worden gewoon afgeknipt. Voor langere conversaties zou een summarize-call zinvol zijn (zie volgende stappen).

### Categorieën agendapunten = BOB-model
**Beeldvorming / Oordeelsvorming / Besluitvorming / Informatie**. Sluit aan bij Nederlandse bestuurspraktijk. (Per release april 2026 hernoemd van "Discussie" naar "Oordeelsvorming" — dat dekt de fase nauwkeuriger.)

### Inbreng vooraf — vrij tekstveld
Geen aparte velden voor onderwerp/toelichting; één textarea omdat bestuurders dat in één doorlopende formulering schrijven. Chronologisch geordend, geen threading. Eigen inbreng kan worden verwijderd (RLS).

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

---

## Bekende beperkingen / scherpe randen

- **`agendapunten.verantwoordelijke` is vrije tekst.** Voor "wijs me agendapunten waar ik verantwoordelijke ben" zou een `verantwoordelijke_id uuid references auth.users` veel netter zijn. Voor MVP is string-match acceptabel.
- **Conversaties zijn niet persistent.** Pagina-refresh wist het gesprek. Wel staat elke vraag+antwoord in `governance_log`. Voor herstelbare conversaties is een `gesprekken` tabel nodig met `gesprek_id` op log-rijen.
- **Geen prompt caching.** Anthropic ondersteunt cache_control marker voor system prompts en oudere messages. Voor herhaalde vragen binnen een gesprek scheelt dat 60-80% input-tokens. Niet kritiek voor MVP-volume maar wel een quick-win.
- **AI-samenvatting van vergaderstukken is synchroon.** Upload duurt ~5-10 sec voor de Claude-call. Bij grote PDFs (50+ pagina's) kan oplopen naar 15-20 sec. Voor productie zou async (background job met polling) beter zijn.
- **Geen versioning van vergaderstukken.** Nieuwe upload = nieuwe rij. Oude blijft staan zonder "verouderd"-label.
- **Notulen-pagina is een placeholder.** Wachten op koppeling met afgeronde vergaderingen.
- **Geen e-mail notificaties.** Bestuurders moeten zelf inloggen om te zien dat er iets is.
- **Demo-data overal.** Alle Wtp-cijfers zijn fictief. Voor productie moet er een data-koppeling komen — handmatige invoer per maand, Excel-upload, of API naar uitvoerder.
- **Ouder Next.js model-string.** `claude-sonnet-4-5` werkt nog, maar nieuwere modellen (4-6) zijn beschikbaar. Update kan in `app/api/chat/route.ts` en `app/api/documents/upload/route.ts`.

---

## Logische volgende stappen (in volgorde van impact/waarde)

1. **Prompt caching toevoegen** in `app/api/chat/route.ts`. System prompt als array met `cache_control: { type: "ephemeral" }`. ~30 minuten werk, 60-80% besparing op herhaalde vragen.
2. **Echte data koppelen** aan het Wtp-dashboard. Eerste optie: een handmatig invoerformulier voor de beheerder, kwartaal-cijfers. Tweede optie: Excel-upload van uitvoerderrapport.
3. **Conversatiepersistentie** in de AI-chat — `gesprekken` tabel, mogelijkheid om eerdere gesprekken terug te halen.
4. **Sliding window samenvatting** voor lange gesprekken (>10 turns) — Claude condenseert oudste turns naar een samenvattingsblok.
5. **Notulen-module afmaken** — koppelen aan afgeronde vergaderingen, mogelijkheid om besluiten/actiepunten te markeren.
6. **`verantwoordelijke_id` schemamigratie** zodat agenda-acties echt op gebruikers wijzen.
7. **Rolspecifieke homepage-varianten** — voorzitter ziet andere accenten dan beleggingscommissielid.
8. **Web search tool integratie** voor de AI-assistent — Anthropic `web_search` met whitelist (DNB, AFM, Pensioenfederatie, rijksoverheid).
9. **Versioning van vergaderstukken** met "verouderd"-label.
10. **E-mail notificaties** bij nieuwe vergadering of nieuwe inbreng op eigen agendapunt.
11. **Module Procedures bouwen** — workflow & case management voor jaarcyclus, beleidswijzigingen, uitbestedingsreviews, incidenten en besluitprocessen. Mockup ligt in `mvp/prototypes/procedures-mockup.html`. Iteratie 1: schemamigratie (`processen`, `proces_stappen`, `proces_checklist_items`, `procedures`, `procedure_stappen`, `procedure_checklist_status`, `procedure_bewijs`, `procedure_besluiten`, `procedure_log`), één hardcoded template (Beleidswijziging) als TS-bestand, lijst- en detail-pagina's onder `/procedures`. Co-eigenaars (koppeltabel), fondsbrede zichtbaarheid (RLS op fonds_id), template-editor in latere iteratie.
12. **Risicomatrix iteratie 2** — bewerken van K/I/niveau/titel/toelichting op detail-pagina met motiveringsveld dat naar het logboek schrijft (in iteratie 1 is dat alleen via sluiten + opnieuw aanmaken mogelijk). Plus eigenaar als FK naar `auth.users` i.p.v. de huidige vrije tekst-veld `eigenaar_naam`, volgende-beoordeling-datum invulbaar maken, en koppeling met Procedures-module via `risico_maatregelen.procedure_id` (kolom bestaat al, alleen UI ontbreekt).

---

## Voor de volgende sessie

Voorbeelden van openingen die snel productief maken:

- *"Lees HANDOVER.md voor context. Ik wil prompt caching implementeren in de AI-chat."*
- *"Lees HANDOVER.md. Ik wil de notulen-module verder uitwerken — ze moeten gekoppeld worden aan afgeronde vergaderingen."*
- *"Lees HANDOVER.md. Ik heb een bug: [beschrijving]. Help me debuggen."*

In nieuwe sessies hoef je niet de geschiedenis van keuzes uit te leggen — die staan hier. Beschrijf wat je wilt veranderen en de nieuwe Claude-sessie kan via `Read` direct in de juiste files duiken.

---

## Release-historie

- **29 april 2026 (laatst+)** — **Risicomatrix iteratie 1 — werkende implementatie**. Drie nieuwe Supabase-tabellen (`risicos`, `risico_maatregelen`, `risico_log`) met RLS-policies fonds-breed. Vier pagina's onder `/risicomatrix`: overzicht met 5×5 heatmap + lijst per categorie, detail met K/I/niveau-strook + maatregelen + logboek, nieuw-risico-form met automatische niveau-afleiding én handmatig overschrijven, archief gesloten risico's. Vier API-routes voor create/sluit/maatregel-CRUD, elke mutatie schrijft naar `risico_log`. Centrale config in `lib/risico-config.ts` (categorieën, kans/impact-labels, niveau-afleiding K+I, kleurmappings). Migratie + demo-seed: `supabase/migrations/2026_04_29_risicomatrix.sql`. Sidebar-link toegevoegd onder Bestuur. TypeScript-check exit 0.
- **29 april 2026 (laatst)** — Klikbaar HTML-prototype voor de nieuwe module **Risicomatrix**: vier schermen — heatmap-overzicht (5×5 Kans×Impact), risico-detail met toelichting/maatregelen/logboek, nieuw-risico-form, archief gesloten risico's. Vier categorieën (Financieel & actuarieel, Governance & Organisatie, Operationeel & datakwaliteit, Informatie & communicatie), prioriteiten Hoog/Middel/Laag met kleuren, structureel/tijdelijk-flag. Bestand: `mvp/prototypes/risicomatrix-mockup.html`.
- **29 april 2026 (later)** — Klikbaar HTML-prototype voor de nieuwe module **Procedures** (workflow & case management): zes schermen — lijst, detail met stappen/checklist/bewijs/audit-log, nieuwe-procedure-picker, templates-overzicht, in-app template-editor. Bestand: `mvp/prototypes/procedures-mockup.html`. Naamkeuze: **Procedures** (niet "Casussen"). Nog geen productiecode — iteratie 1 (werkende implementatie van detail + lijst + audit-log voor één template) volgt na review.
- **29 april 2026** — Demofonds hernoemd naar **Stichting Pensioenfonds Horizon** (slug `horizon`). Agendapunt-categorie **Discussie** hernoemd naar **Oordeelsvorming** (BOB-model). Migratie: `supabase/migrations/2026_04_29_horizon_oordeelsvorming.sql`.
- **April 2026** — Eerste release: Wtp-dashboard, AI-assistent met drie modi, vergaderingen + agenda + inbreng, governance log, documentbibliotheek met FTS-RAG.

---

*Laatst bijgewerkt: 29 april 2026 (release Risicomatrix iteratie 1 + eerdere Horizon/oordeelsvorming/Procedures-prototype).*
