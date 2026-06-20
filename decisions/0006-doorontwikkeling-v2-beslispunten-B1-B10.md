# 0006 — Doorontwikkeling v2: beslispunten B1–B14 (blokkerend voor de bouw)

> *(Bestandsnaam houdt om historische redenen "B1-B10" aan; inhoudelijk omvat dit dossier B1–B14 + O1/O2.)*

- **Status:** Geaccepteerd — B1–B10 geaccepteerd; O1 en O2 besloten; capability-opslag (B11) besloten; bronsoort documenten (B12) besloten; tenant-isolatie generieke documenten (B13) besloten; **platform-identiteit & back-office-toegang (B14) besloten — Optie A** (gate uitsluitend voor de platform-track Increment P; blokkeert de v2-increments A–H/C+ níét). Geen openstaande beslissingen meer.
- **Datum:** 2026-06-18 (laatst bijgewerkt 19-06-2026, ronde v1.2 — B12, B13 en B14 besloten)
- **Betrokkenen:** Merlin IJzerman

## Context

Het ontwerp "Document-, proces- en AI-modules bestuurdersportaal" is vertaald naar een review/gap-analyse, een functioneel ontwerp, een technisch ontwerp en een roadmap (alle "Doorontwikkeling v2", v1.1). Uit de gap-analyse tegen de live code (27 migraties) volgden tien beslispunten (B1–B10) die de structurele richting bepalen. Deze moeten **expliciet en vóór de bouw** worden vastgelegd, zodat increments niet op aannames rusten die later wijzigen. Randvoorwaarden: behoud van RLS per `fonds_id`, append-only audit, snapshot-integriteit van het bestaande Decision Object, en beheer-/gebruiksvriendelijkheid.

## Besluit

De tien beslispunten worden vastgelegd met onderstaande status. Increment A start pas nadat de als **blokkerend voor A** gemarkeerde punten zijn bekrachtigd.

| # | Beslispunt | Besluit | Status | Gate |
|---|---|---|---|---|
| B1 | Scope-naam | Scope heet **"Doorontwikkeling v2"**; MVP-1 is reeds live en wordt expliciet zo benoemd | Geaccepteerd | — |
| B2 | Dossier ↔ Decision Object | `procedures` = procesinstantie (UI: "dossier"); dossier is **container** voor ≥1 Decision Objects; `decision_objects.procedure_id` blijft de koppeling; **geen nieuwe FK** tenzij code-review anders uitwijst; dossierstatus via `vw_dossier_status` | Geaccepteerd (mapping = open technisch punt) | **Blokkeert A/B** |
| B3 | Procescatalogus naar DB | Procesmodellen verhuizen van code (`lib/proces-templates.ts`) naar DB-tabellen per fonds | **Geaccepteerd** (18-06-2026) | A (vervuld) |
| B4 | Terminologie | Documentattribuut heet **"bronstatus"** (niet "RAG-scope"); gespreksgebonden selectie blijft "documentselectie/-scope" | Geaccepteerd | **Blokkeert A** |
| B5 | Auto-koppeling bij hoge confidence | Auto-koppeling is **terugdraaibaar + zichtbaar gemeld + auditbaar**; nooit stil/onomkeerbaar | **Geaccepteerd** (18-06-2026) | E (vervuld) |
| B6 | Notulensegmentatie | **Half-automatisch**: systeem stelt segmenten voor, secretaris bevestigt vóór indexering | Geaccepteerd | Blokkeert D |
| B7 | Documentstatus-model | Nieuwe enum `status` op `documenten`; documentstatus `actief` **hernoemd naar `van_kracht`** om botsing met `documenten.actief` en `bronstatus=actief` te vermijden; transitietabel verplicht | Geaccepteerd | **Blokkeert C** |
| B8 | Duiding + sparring | Bestuurlijke duiding en sparring vormen **één modusfamilie** (antwoordmodi), naast de bestaande bron-modi (Documenten/Combineren/Algemeen) | Geaccepteerd | Blokkeert G |
| B9 | Eigenaars vrije tekst → FK | **Apart, getest migratietraject** met handmatige mappingstap; vrije tekst blijft tijdens overgang naast FK | **Geaccepteerd** (18-06-2026) | F (vervuld) |
| B10 | Compliance-checkpoint | DPIA + AI-governanceclassificatie **actualiseren vóór livegang** van profiel (F) en duiding/sparring (G) | Geaccepteerd | **Blokkeert F-livegang en G-livegang** |

### Aanvullend besluit — capability-opslag (B11)

**B11 — Capability-opslag**: **Geaccepteerd (18-06-2026).** Voor v2 start het rechtenmodel met een **centrale config-mapping in code** (`rol → capabilities[]`), afgedwongen via één server-side helper `requireCapability(userId, cap)`, met tests. Reden: snelheid en eenvoud bij drie autorisatierollen; een `rol_capabilities`-DB-tabel wordt pas ingevoerd als rollen fijnmaziger/beheerbaar moeten worden (latere optimalisatie). Increment A gebruikt dit voor `catalog.manage`. **Gate voor A vervuld.**

### Aanvullend besluit — bronsoort documenten (B12)

**B12 — Bronsoort documenten**: **Geaccepteerd (19-06-2026).**

> NB: de naam "B11" was in dit besluit al bezet door capability-opslag; deze beslissing krijgt daarom nummer **B12**.

**Besluit (samengevat):** *Het onderscheid tussen fondsdocumenten en generieke documenten wordt als persistente "bronsoort" vastgelegd en correct gebruikt in metadata, zoeken, bronkaarten, RAG-filtering en AI-antwoorden. Dit gebeurt door het **bestaande** veld te hergebruiken, niet door nieuwe structuur toe te voegen.*

Concreet:
1. **Hergebruik bestaand veld, geen nieuw `bronsoort`-veld.** Het onderscheid is al persistent als `documenten.bibliotheek` (CHECK `generiek|fonds`, NOT NULL), gevuld door de bestaande uploadflow/UI. Conform het uitgangspunt "als het al persistent is, hergebruik het bestaande veld" geldt **`documenten.bibliotheek` als de canonieke bronsoort** (`fonds` = fondsdocument, `generiek` = generiek/extern kaderdocument). Er komt **geen** nieuwe kolom `bronsoort` en **geen** datamigratie/rename. "Bronsoort" is de functionele/UX-term die 1-op-1 op `bibliotheek` mapt.
2. **Generieke documenten blijven fonds-overstijgend gedeeld (afwijking t.o.v. de oorspronkelijke wijzigingsaanvraag).** De live code houdt generieke documenten in een **gedeelde** bibliotheek: `documenten.fonds_id = NULL` en RLS `… or bibliotheek = 'generiek'`, met opslagpad `generiek/<id>` (bewuste keuze 10-06-2026; `decisions/0007` leunt hierop via nullable `fonds_id`). **Besloten: dit gedeelde model blijft in v2 ongewijzigd.** Hiermee wijkt v2 bewust af van de oorspronkelijke aanvraag (die generieke documenten juist fondsgebonden wilde maken met `fonds_id = huidig fonds`). Reden: het gedeelde model bestaat al, werkt, en omschakelen naar fonds-binding is géén low-impact toevoeging maar een reversal met datamigratie, RLS-wijziging en per-fonds duplicatie. Er komt dus **geen** nieuwe centrale bibliotheek (die bestaat al) en **geen** per-fonds gekopieerde generieke documenten.
3. **Beperkte extra metadata (additief, low-impact).** Drie nullable kolommen op `documenten`, vooral voor `bibliotheek = 'generiek'`: `bronorganisatie text`, `extern_url text`, `normgewicht text` (CHECK `bindend|toezichtverwachting|sector_guidance|informatief|onbekend`). Het bestaande grove `bron`-veld (DNB/AFM/Pensioenfederatie/Intern/Extern) blijft; `bronorganisatie` is de fijnere vrije-tekst-uitgever. Geen thema-/regime-/doelgroep-/jurisdictie-taxonomie in v2.
4. **Geldigheid/vervaldatum hergebruikt bestaande velden.** `documentdatum`, `geldig_vanaf`, `geldig_tot` bestaan al (migratie `2026_06_18_documentstatus_metadata.sql`). Voor generieke documenten geldt `geldig_tot` als vervaldatum; na `peildatum > geldig_tot` is het document geen actuele bron meer en toont de bronkaart "Vervallen per [datum]".
5. **RAG-weging zonder aparte engine.** `bibliotheek` (bronsoort) gaat mee in filtering/ranking/bronweergave/antwoordstructuur van de bestaande retrieval. Fonds-specifieke vragen prioriteren fondsdocumenten + Decision Object; sector-/toezichtvragen prioriteren generieke documenten; gecombineerde antwoorden scheiden expliciet "volgens fondsdocumenten" / "volgens generieke/externe bronnen" / "bestuurlijke duiding".

**Gevolg voor de regressietests (afwijking expliciet):** doordat het gedeelde model behouden blijft, worden de in de aanvraag genoemde tests #3/#4 omgekeerd vastgelegd: een generiek document heeft `fonds_id = NULL` en is bewust fonds-overstijgend leesbaar; de isolatietest wordt "Fonds A kan **fondsdocumenten** van Fonds B niet lezen, maar **wel** de gedeelde generieke documenten". Zie TO v1.2 §6.2 en FO v1.2 §6.

### Aanvullend besluit — tenant-isolatie generieke documenten (B13)

**B13 — Tenant-isolatie generieke documenten**: **Geaccepteerd (19-06-2026).**

**Aanleiding:** generieke documenten zijn bewust fonds-overstijgend gedeeld (B12: `fonds_id NULL` + RLS `… or bibliotheek='generiek'`). De huidige policy is echter `for all` zónder aparte `with check`, waardoor het gedeelde kanaal op DB-niveau ook *schrijven* door tenant-gebruikers toelaat. Twee multi-client risico's: (a) **misclassificatie-lek** — een vertrouwelijk fondsdocument dat als `generiek` wordt gemarkeerd verliest zijn `fonds_id` en wordt voor álle fondsen leesbaar; (b) **cross-tenant poisoning** — een tenant kan generieke documenten (die iedereen leest en die RAG voor iedereen voeden) wijzigen/verwijderen/injecteren.

**Besluit:** generieke documenten worden **platform-gecureerd**; tenants zijn **strikt read-only** op generiek.
1. **RLS splitsen per command** op `documenten` (en analoog op `document_chunks`): `SELECT` ongewijzigd (eigen fonds **of** `bibliotheek='generiek'`); `INSERT`/`UPDATE` alleen op rijen met `fonds_id = eigen fonds` **én** `bibliotheek='fonds'` (via `with check`); `DELETE` alleen op eigen-fonds-rijen. Generieke rijen (`fonds_id NULL`) vallen daarmee buiten elke tenant-schrijfpolicy.
2. **Generieke set wordt beheerd via een service-role back-office/seed-pad** (migratie/seed/interne tooling). Service-role omzeilt RLS en is daarvoor het curatiekanaal; service-role wordt **nooit** op tenant-facing routes gebruikt (bestaande guardrail).
3. **Tenants kunnen `bibliotheek='generiek'` niet zetten** (niet bij upload, niet via metadata) — lost het misclassificatie-lek op. De tenant-uploadflow biedt "generiek" niet meer aan; de generieke tab blijft **read-only**.
4. **Capability** `generic.library.manage` wordt gereserveerd voor een toekomstige platform-/leveranciersrol; in v2 houdt geen enkele tenant-rol deze. Geen nieuwe tenant-rol nodig.

**Gevolg (bewuste gedragsverandering):** tenants kunnen niet langer zelf generieke documenten uploaden/wijzigen via de UI. Dat is precies de bedoeling voor sterke multi-client isolatie; de generieke set (DNB/AFM/PF) is leveranciersmateriaal, geen tenant-content.

**Samenhang met B12/C+:** B13 beperkt het in C+ ontworpen **generieke invoer-/bewerkformulier** tot het platform/back-office (niet tenant-facing). Daarom zijn **C+ en B13 samengevoegd tot één gecombineerd bouwticket** (`Increment Cplus-B13 … v1.0`); het generieke curatieformulier is daarin doorgeschoven naar **Increment P1**, terwijl de tenant-kant alleen het fondsformulier + read-only generiek krijgt.

**Gate-impact: geen** — B13 blokkeert geen increment; het is een additieve RLS-/UI-aanscherping (eigen mini-ticket).

**Impact op increments:** louter additief. Increment C is al gebouwd + gedeployed en wordt **niet heropend**. De bronsoort-uitbreiding is volledig nieuw werk en is belegd als één zelfstandige, low-impact vervolg-iteratie **Increment C+** ná C: eigen additieve mini-migratie (3 nullable kolommen) + **gescheiden invoer-/metadataformulieren voor fonds- vs. generieke documenten** (presentatie/validatie; datamodel blijft één `documenten`-tabel met `bibliotheek` als discriminator — geen aparte tabel). Verder G (bronsoort-weging + `geldig_tot`-filter op generieke docs) en H (bronsoort-zoekfilter). Geen nieuwe uploadstap, geen aparte documentmodule. **Gate-impact: geen** — B12 blokkeert geen increment.

### Aanvullend besluit — platform-identiteit & back-office-toegang (B14)

**B14 — Platform-identiteit & back-office-toegang**: **Besloten (19-06-2026) — Optie A (aparte back-office-surface met eigen platform-identiteit).** *Gate uitsluitend voor de platform-track (Increment P); blokkeert de v2-increments A–H/C+ níét.*

**Aanleiding:** B13 maakt generieke documenten platform-gecureerd, maar er is **geen platform-/leveranciersidentiteit** — alleen tenant-scoped autorisatierollen (`bestuurder | voorzitter | beheerder`). Een back-office die generiek cureert én cross-tenant logs/observability ontsluit (zie ticket *Increment P*) kan niet op het tenant-rolmodel leunen. B14 legt vast hóé die platform-toegang werkt.

**Besluit (Optie A): aparte back-office-surface met eigen platform-identiteit.**
1. Platform-identiteit losgekoppeld van `profielen.rol`, niet aan enig fonds gebonden; **aparte surface** (eigen route/subdomein/app), nooit bereikbaar vanuit de tenant-UI.
2. **MFA verplicht** + (bij voorkeur) IP-allowlist; **least privilege**.
3. Cross-tenant data-toegang via een **gecontroleerd server-pad** (service-role in de back-office-laag), nooit via de tenant-app; tenant-RLS blijft ongemoeid.
4. **`platform.*`-capabilityfamilie** (bv. `platform.tenants.manage`, `platform.generic.library.manage`, `platform.logs.read`, `platform.support.operate`), volledig gescheiden van tenant-capabilities.
5. **Audit-on-audit**: elke back-office-handeling wordt zelf geaudit (in `platform_event_log`, zie Increment P).

**Verworpen/uitgesteld alternatieven:**
- **Optie B — superadmin-vlag op `profielen` + brede platform-RLS** (verworpen): lichter te bouwen, maar de back-office deelt app/identiteit met tenants → groter aanvalsoppervlak en complexere RLS. Zwakkere isolatie.
- **Optie C — voorlopig alleen service-role back-office-tooling (scripts/CLI), nog geen UI** (niet gekozen als eindmodel; mag wel als tijdelijke interim dienen tot de aparte surface er staat): dekt curatie (B13) + ad-hoc log-queries, maar is geen volwaardige back-office.

**Open sub-punten (bij uitwerking van Increment P te bevestigen):** (1) auth-provider/-mechanisme voor de platform-identiteit (aparte Supabase-project/auth vs. gescheiden rol); (2) MFA/IP-allowlist hard verplicht; (3) bewaartermijn + toegangsregels voor cross-tenant logs (AVG-relevant).

**Gevolg / gate:** gate voor **Increment P** (platform back-office). Raakt A–H/C+ niet. Te bekrachtigen voordat P1 in Plan-modus start.

### Eerder open, nu besloten (geen B-nummer)

- **O1 — Multi-fonds in v2**: **BESLOTEN (18-06-2026) — multi-fonds.** v2 wordt vanaf de start fonds-specifiek opgezet voor meerdere fondsen. Gevolg: catalogi (`procesmodellen`, `gremia`, `expertises`, `kritische_focusgebieden`) krijgen een globale standaardset (`fonds_id` NULL) die per fonds kan worden gekopieerd/aangepast; alle nieuwe tabellen dragen `fonds_id` en vallen onder de bestaande RLS-tenantisolatie. Increment A bouwt hierop. Gate voor A daarmee vervuld voor het multi-fonds-deel.
- **O2 — Decision Object → dossierstatus-mapping**: **BESLOTEN (18-06-2026).** Mapping 17→8 vastgelegd (zie TO v1.1 §3.2). Prioriteitsregel: de dossierstatus volgt het **primaire** Decision Object (`is_primary_decision`); zonder Decision Object geldt een handmatige dossierstatus. Subkeuzes: (a) `in_evaluatie` → dossierstatus `in_implementatie` (evaluatie vraagt nog open governance-aandacht); (b) `vw_dossier_status` wordt **bestendig gebouwd voor 1-op-n** via `is_primary_decision`, maar functioneel houdt v2 **1 Decision Object per dossier** (huidige praktijk, conform migratie-notitie "1-op-1 voor MVP"); (c) zij-toestanden `teruggezet`/`geescaleerd`/`aangehouden` worden getoond als **zichtbaar sublabel voor alle bestuurders** (consistent met het principe dat informatie niet wordt weggefilterd). Gate voor increment B daarmee vervuld.

## Overwogen alternatieven

- **B1-alternatief: scope ook "MVP" noemen** — verworpen: botst met de live MVP-1 en verwart bestuur/uitvoering.
- **B2-alternatief: parallel besluitspoor naast Decision Object** — verworpen: leidt tot een derde besluitconcept en versnippert de governance-keten (besluit → onderbouwing → evaluatie → audit).
- **B3-alternatief: templates in code houden** — verworpen voor v2: fonds-specifieke configuratie zonder deploy is een kerneis; wel gefaseerd uitfaseren met seed + verificatie.
- **B5-alternatief: volledig autonome auto-koppeling** — verworpen: AI-koppeling met bestuurlijke impact zonder terugdraai is in strijd met "AI adviseert, mens besluit".
- **B7-alternatief: boolean `actief` uitbreiden** — verworpen: één veld met meerdere betekenissen; gescheiden lagen (technische beschikbaarheid / documentstatus / bronstatus) zijn auditbaarder.
- **B12-alternatief: nieuw `bronsoort`-veld toevoegen + migreren** — verworpen voor v2: het onderscheid is al persistent als `bibliotheek`; een tweede veld + datamigratie + code-rename levert geen functioneel verschil en is geen low-impact.
- **B12-alternatief: generieke documenten fondsgebonden maken (`fonds_id = fonds`) met per-fonds duplicatie** — verworpen voor v2: reverseert het bestaande gedeelde model (10-06-2026), vraagt datamigratie + RLS-wijziging + opslagherschikking en dubbele opslag per fonds; valt buiten de low-impact-scope. Kan later als optimalisatie heroverwogen worden.
- **B13-alternatief: tenant-beheerder mag generiek beheren (met waarschuwing)** — verworpen: behoudt selfservice maar lost cross-tenant poisoning niet op (een beheerder van één fonds wijzigt dan nog steeds wat alle fondsen zien).
- **B13-alternatief: staging + goedkeuring (tenant stelt voor, platform publiceert)** — uitgesteld: nette governance maar meer bouw (extra status/flow); kan later bovenop het platform-curated model worden toegevoegd.

## Gevolgen

- **Datamodel/migraties**: catalogus- en organentabellen, join-tabellen (i.p.v. `uuid[]`), documentstatus/bronstatus-velden, `vw_dossier_status`, capability-model. Alle additief met ROLLBACK + backfill + verificatiequery.
- **RLS/audit**: nieuwe tabellen onder bestaande `fonds_id`-isolatie; metadata- en koppelingswijzigingen append-only gelogd; capability-checks server-side leidend.
- **Bewust geaccepteerde schuld**: overgangsperiode waarin vrije-tekst-eigenaars naast FK's bestaan (B9); NULL-bronstatus tijdens migratie wordt als "actief" behandeld om retrieval niet te breken (tijdelijk, met review-queue).
- **Proces**: alle v2-beslissingen (B1–B13, O1, O2) zijn geaccepteerd/besloten; er zijn geen besluit-gates meer open die de v2-bouw (A–H/C+) blokkeren. **B14 (platform-identiteit) is besloten (Optie A)** — het is uitsluitend de gate voor de aparte platform-track (Increment P), niet voor v2. De resterende gates per increment zijn **uitvoerings-deliverables** (geen besluiten): C = status/bronstatus-transitietabel opgeleverd; D = notuleninrichting; F/G = compliance-checkpoint (DPIA/AI-governance) + retrieval-regressietests groen. Zie roadmap v1.2 §3 en de "remaining build blockers".

## Referenties

- `03 Functioneel ontwerp/Bestuurdersportaal - Doorontwikkeling v2 functioneel ontwerp v1.1.md`
- `03 Functioneel ontwerp/Bestuurdersportaal - Doorontwikkeling v2 kritische review en gap-analyse v1.1.md`
- `04 Technische inrichting/Bestuurdersportaal - Doorontwikkeling v2 technisch ontwerp v1.1.md`
- `06 Roadmap/Bestuurdersportaal - Doorontwikkeling v2 roadmap v1.1.md`
- `decisions/0002` (generieke proceduremodule als data) — B3 bouwt hierop voort.
- `decisions/0001` (append-only audit) — kader voor metadata-/koppelingslogging.
