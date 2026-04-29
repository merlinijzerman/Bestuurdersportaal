# Bestuurdersportaal MVP — Handover

> **Voor toekomstige Claude-sessies**: dit document is de samenvatting van wat is gebouwd, hoe het in elkaar zit, en wat de logische volgende stappen zijn. Lees dit eerst voordat je aan iets nieuws begint, zodat je niet de hele code hoeft te scannen.

---

## Wat dit project is

Een MVP-portaal voor bestuurders van Nederlandse pensioenfondsen, gebouwd voor Merlin Ijzerman. De kern is een AI-assistent die vragen beantwoordt op basis van fonds-documenten met traceerbare bronvermeldingen, omringd door modules voor Wtp-stuurinformatie, documentbibliotheek, vergaderingen-voorbereiding, een **risicomatrix** met heatmap en logboek per risico, **procedures** voor workflow & case management van beleidswijzigingen en besluittrajecten, governance-logging en (placeholder) notulen.

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
- **pdf-parse** voor PDF-tekstextractie
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
│   │   │   ├── [id]/page.tsx       # detail met agenda + inbreng + stukken
│   │   │   └── _components/        # client components: forms, kaarten
│   │   ├── procedures/             # workflow & case management
│   │   │   ├── page.tsx            # lijst met voortgangsbalken
│   │   │   ├── nieuw/page.tsx      # template-picker + form
│   │   │   ├── [id]/page.tsx       # detail met step-rail, checklist, bewijs, log
│   │   │   └── _components/        # NieuweProcedureForm, ActieveStapPaneel
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
│   │   ├── agendapunten/route.ts
│   │   ├── inbreng/[id]/route.ts
│   │   ├── procedures/             # 5 routes voor procedure-flows
│   │   │   ├── route.ts            # POST: create from template (snapshot)
│   │   │   └── [id]/
│   │   │       ├── stappen/[stapId]/route.ts    # PATCH: status + auto-activeer volgende
│   │   │       ├── checklist/[itemId]/route.ts  # PATCH: toggle voldaan
│   │   │       ├── bewijs/route.ts              # POST: bewijsstuk
│   │   │       └── besluiten/route.ts           # POST: formele besluitvastlegging
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
│   ├── rag.ts                      # zoekRelevanteChunks, maakContext, maakChunks
│   ├── proces-templates.ts         # hardcoded procestemplates (Beleidswijziging)
│   └── risico-config.ts            # categorieën + niveau-afleiding K+I
├── prototypes/                     # klikbare HTML-mockups (single file, Tailwind via CDN)
│   ├── procedures-mockup.html
│   └── risicomatrix-mockup.html
├── supabase/
│   ├── schema.sql                  # complete schema (idempotent documentatie)
│   └── migrations/                 # losse migratie-scripts per release
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
| `agendapunten` | Agendapunten per vergadering met `categorie` (beeldvorming/oordeelsvorming/besluitvorming/informatie) |
| `agendapunt_inbreng` | Inbreng vooraf van bestuursleden per agendapunt |
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
Welkomststrook met dagdeel-groet, naam, rol, fondsnaam en eerstvolgende vergadering. Compacte 4-tile KPI-strook (financieringsgraad, solidariteitsreserve, vermogen, rendement YTD). "Uw open procedure-stappen"-widget toont actieve stappen waar je co-eigenaar bent, met deadline-indicatie. "Voor u open"-widget toont aantal agendapunten waar je nog geen inbreng plaatste. "Uw recente activiteit" toont laatste 3 AI-vragen, inbrengen en uploads.

### Wtp-stuurinformatie (`/dashboard`)
Vier KPI-tegels, 24-maands trendgrafiek financieringsgraad (inline SVG), gedetailleerde Wtp-balans (activa: bescherming/overrendement/liquide; passiva: persoonlijke pensioenvermogens per cohort + solidariteitsreserve + compensatiedepot + operationele reserve), deelnemers-status-blok, signaleringen, openstaande acties. Alle cijfers zijn demo-data hardcoded in de page.

### AI Assistent (`/ai`)
Multi-turn chat met geschiedenisvenster van 12 berichten. Drie modi via segmented toggle: **Documenten** (strikt op interne bronnen, citaten verplicht), **Slim combineren** (default — interne bronnen aangevuld met algemene kennis, gemarkeerd onderscheid), **Algemeen** (open AI-assistent zonder beperking, gele waarschuwing bij elk antwoord). Persoonlijke aanspreking via systeem-prompt met naam/rol/fondsnaam. Gespreksgeschiedenis wordt op de frontend bijgehouden; "Nieuw gesprek"-knop wist alles. Elke vraag wordt gelogd in `governance_log` inclusief gebruikte modus.

### Documentbibliotheek (`/bibliotheek`)
PDF-upload via formulier. Bij upload: `pdf-parse` extraheert tekst, `lib/rag.ts maakChunks()` splitst in fragmenten, fragmenten gaan naar `document_chunks` met automatische `tsvector` indexering voor full-text search. Documenten getagd met bron en bibliotheek (generiek/fonds).

### Vergaderingen (`/vergaderingen`)
Lijst-view scheidt komend en afgelopen. Detail-view toont meeting-header, stats, agendapunten als uitklapbare kaarten met categorie-badge (BOB-model: kleur per categorie). Per agendapunt: documentupload (triggert ook AI-samenvatting), inbreng-formulier voor andere bestuursleden. AI-samenvatting volgt vaste structuur (aanleiding / hoofdpunten / gevraagd besluit / aandachtspunten) als JSON, frontend rendert gestructureerd.

### Procedures (`/procedures`)
Workflow & case management: lopende processen voor beleidswijzigingen, uitbestedingsreviews, incidenten en besluittrajecten. Lijstpagina toont per procedure een voortgangsbalk, eigenaars-avatars en deadline. Detailpagina heeft een vertical step-rail die afgeronde / actieve / open stappen visueel onderscheidt, plus een interactief "actieve stap"-paneel met checklist-items (afvinkbaar, met `bewijs_vereist`-flag), gekoppelde vergader-agendapunten, bewijsstukken (toevoegen via form), en — voor stappen die het vereisen — een formeel besluit-formulier (formulering + motivering + datum) met optionele AI-concept-knop die automatisch een conceptformulering opstelt op basis van bewijs en eerdere stappen. Validatie bij stap-voltooien: alle checklist voldaan, bewijs aanwezig waar vereist, en besluit vastgelegd waar vereist. Bij voltooien wordt de volgende stap automatisch geactiveerd; bij de laatste stap wordt de procedure op `afgerond` gezet. Onderaan de pagina staat een append-only audit-trail van alle events. Drie templates beschikbaar: **Beleidswijziging** (6 stappen), **Uitbestedingsreview** (5 stappen), **Incident-meldplicht DNB** (6 stappen, tijdkritisch). Templates zijn hardcoded in `lib/proces-templates.ts` met snapshot-pattern bij start.

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

### Append-only audit-logs
Beide nieuwe modules (Procedures en Risicomatrix) hebben een eigen `*_log`-tabel met event-types als enum-string en payload als jsonb. Geen triggers — elke API-route schrijft expliciet naar het log na de mutatie. Deze opzet is eenvoudig te lezen en te debuggen, en houdt het log scheidbaar van de `governance_log` (die specifiek voor AI-vragen is).

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
- **Risicomatrix: K/I/niveau/titel niet bewerkbaar na aanmaken.** Wijzigen kan alleen via sluiten + opnieuw aanmaken. In iteratie 2 een edit-form met motiveringsveld dat naar log schrijft.
- **Risicomatrix: maatregel-procedure-koppeling niet in UI.** Kolom `risico_maatregelen.procedure_id` bestaat maar wordt niet gevuld door de UI.
- **Geen versioning van vergaderstukken.** Nieuwe upload = nieuwe rij. Oude blijft staan zonder "verouderd"-label.
- **Notulen-pagina is een placeholder.** Wachten op koppeling met afgeronde vergaderingen.
- **Geen e-mail notificaties.** Bestuurders moeten zelf inloggen om te zien dat er iets is.
- **Demo-data overal.** Alle Wtp-cijfers zijn fictief. Voor productie moet er een data-koppeling komen — handmatige invoer per maand, Excel-upload, of API naar uitvoerder.
- **Model-string `claude-sonnet-4-5`.** Werkt nog, maar nieuwere modellen (4-6) zijn beschikbaar. Update kan in `app/api/chat/route.ts` en `app/api/documents/upload/route.ts`.

---

## Logische volgende stappen (in volgorde van impact/waarde)

1. **Prompt caching toevoegen** in `app/api/chat/route.ts`. System prompt als array met `cache_control: { type: "ephemeral" }`. ~30 minuten werk, 60-80% besparing op herhaalde vragen.
2. **Echte data koppelen** aan het Wtp-dashboard. Eerste optie: handmatig invoerformulier voor de beheerder, kwartaal-cijfers. Tweede optie: Excel-upload van uitvoerderrapport.
3. **Procedures iteratie 3** — file-upload bij bewijsstukken (direct of via documentbibliotheek-picker), in-app template-editor zodat beheerders zonder code-deploy nieuwe templates kunnen toevoegen, eigenaars-FK naar `auth.users` zodat tagging/notifications mogelijk worden, edit-functie voor titel/beschrijving/deadline na aanmaken (met motivering naar log).
4. **Risicomatrix iteratie 2** — bewerken van K/I/niveau/titel/toelichting met motiveringsveld dat naar log schrijft, eigenaar-FK naar `auth.users`, volgende-beoordeling-datum invulbaar, koppeling maatregel ↔ procedure.
5. **Conversatiepersistentie** in de AI-chat — `gesprekken` tabel, mogelijkheid om eerdere gesprekken terug te halen.
6. **Sliding window samenvatting** voor lange gesprekken (>10 turns).
7. **Notulen-module afmaken** — koppelen aan afgeronde vergaderingen, mogelijkheid om besluiten/actiepunten te markeren.
8. **Generieke `verantwoordelijke_id` schemamigratie** voor agendapunten/procedures/risicos.
9. **Rolspecifieke homepage-varianten** — voorzitter ziet andere accenten dan beleggingscommissielid.
10. **Web search tool integratie** voor de AI-assistent — Anthropic `web_search` met whitelist (DNB, AFM, Pensioenfederatie, rijksoverheid).
11. **Versioning van vergaderstukken** met "verouderd"-label.
12. **E-mail notificaties** bij nieuwe vergadering, nieuwe inbreng op eigen agendapunt, of stap-deadline die nadert.

---

## Voor de volgende sessie

Voorbeelden van openingen die snel productief maken:

- *"Lees HANDOVER.md voor context. Ik wil prompt caching implementeren in de AI-chat."*
- *"Lees HANDOVER.md. Ik wil een tweede procestemplate toevoegen — Uitbestedingsreview."*
- *"Lees HANDOVER.md. Ik wil dat een risico aan een lopende procedure gekoppeld kan worden."*
- *"Lees HANDOVER.md. Ik heb een bug op /procedures/[id]: [beschrijving]."*

In nieuwe sessies hoef je niet de geschiedenis van keuzes uit te leggen — die staan hier. Beschrijf wat je wilt veranderen en de nieuwe Claude-sessie kan via `Read` direct in de juiste files duiken.

Patroon dat goed werkt voor nieuwe modules: eerst klikbaar HTML-prototype maken (zie `prototypes/`), reviewen, dan iteratie 1 als werkende code (schemamigratie + paar pagina's + API-routes). Iteratie 2 op basis van gebruik. De prototypes zijn statische HTML met Tailwind via CDN en hash-routing — geen backend nodig om door te klikken.

---

## Release-historie

- **29 april 2026** — **Procedures iteratie 2**. Twee extra hardcoded templates: **Uitbestedingsreview** (5 stappen) en **Incident-meldplicht DNB** (6 stappen, met tijdkritische triage). Koppeling **procedure-stap ↔ agendapunt**: nieuwe kolom `agendapunten.procedure_stap_id` (migratie `2026_04_29_procedures_iteratie2.sql`), op de detail-pagina van een procedure kun je een actieve stap met één klik in een komende vergadering plaatsen — er wordt automatisch een agendapunt aangemaakt met categorie *Oordeelsvorming* (of *Besluitvorming* bij stappen die een besluit vereisen) en een back-reference. **AI-besluit-concept**: nieuwe API-route `/api/procedures/[id]/stappen/[stapId]/besluit-concept` die op basis van procedure-context, eerdere stappen, checklist en bewijsstukken een conceptformulering + motivering opstelt via Claude. Knop "Concept met AI" naast het besluit-form vult automatisch de invoervelden in voor review. **"Uw open procedure-stappen"-widget** op de homepage toont actieve stappen waar je co-eigenaar bent, met deadline-indicatie (dringend bij ≤7 dagen).
- **29 april 2026** — **Procedures iteratie 1 — werkende implementatie**. Zeven Supabase-tabellen, drie pagina's onder `/procedures` (lijst, detail met step-rail + actief-stap-paneel + log, nieuw-form), vijf API-routes, hardcoded Beleidswijziging-template (6 stappen, 18 checklist-items), snapshot-pattern bij start, validatie bij voltooien (checklist + bewijs + besluit). Migratie: `supabase/migrations/2026_04_29_procedures.sql`. Demo-seed: één lopende procedure in stap 3.
- **29 april 2026** — **Risicomatrix iteratie 1 — werkende implementatie**. Drie Supabase-tabellen, vier pagina's onder `/risicomatrix` (overzicht met 5×5 heatmap + lijst per categorie, detail met maatregelen + log, nieuw-form, archief), vier API-routes, niveau-afleiding K+I met handmatige overschrijving, sluiten met verplichte motivering. Centrale config in `lib/risico-config.ts`. Migratie: `supabase/migrations/2026_04_29_risicomatrix.sql`. Demo-seed: 5 actieve + 1 gesloten risico.
- **29 april 2026** — Klikbare HTML-prototypes voor Procedures (`prototypes/procedures-mockup.html`) en Risicomatrix (`prototypes/risicomatrix-mockup.html`). Naamkeuze "Procedures" boven "Casussen". Vier categorieën risico's, prioriteits-kleuren, structureel/tijdelijk-flag.
- **29 april 2026** — Demofonds hernoemd naar **Stichting Pensioenfonds Horizon** (slug `horizon`). Agendapunt-categorie **Discussie** hernoemd naar **Oordeelsvorming** (BOB-model). Migratie: `supabase/migrations/2026_04_29_horizon_oordeelsvorming.sql`.
- **April 2026** — Eerste release: Wtp-dashboard, AI-assistent met drie modi, vergaderingen + agenda + inbreng, governance log, documentbibliotheek met FTS-RAG.

---

*Laatst bijgewerkt: 29 april 2026 — na release Procedures iteratie 2.*
