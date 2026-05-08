# Proceduremodule MVP-1 — Ontwerpdocument

> **Status**: Revisie 2.1 (na tweede reviewronde 2026-05-07)
> **Datum**: 2026-05-07
> **Bron**: `Inrichting module procedure - aangescherpt.docx` (06-05-2026) + `GOS_Compleet_Operating_Model_Architectuur_Roadmap.pdf` + interne reviews 2026-05-07
> **Doel**: blueprint voor de eerste doorontwikkelslag van de proceduremodule, conform §17.1 / §26 van de spec ("MVP-1").

## Revisielog

**v2.1 (2026-05-07, tweede reviewronde)** — 7 finale correcties verwerkt:
1. Revisielog en sectie 7-kop consistent gemaakt op 1A t/m 1E (was: 1A/B/C/D)
2. AI-validatie via `validatie_domein`-veld (was: ad-hoc filter op `type`) — sectie 4.8 + 13.2
3. `hoog_risico` weggehaald uit `triggert_bij_complexiteit`-voorbeeld (foutieve waarde) — sectie 4.9 + filter-semantiek (AND tussen velden, OR binnen array) gedocumenteerd
4. `procedure_evidence_requirements` hernoemd in sectie 9 naar `procedure_requirements`
5. Snapshot-immutability expliciet gedocumenteerd (no-update/no-delete/server-side hash) — sectie 4.11
6. Target-status ↔ readiness-niveau mapping expliciet — sectie 9 punt 2
7. Demo-vragen voor 1B vastgelegd — sectie 7.3

**v2 (2026-05-07)** — Verwerkt 15-puntenreview:
1. Classificatie multi-dimensioneel (was: één enum-veld) — sectie 4.1
2. Decision Object voorbereid op 1:n via `is_primary_decision` (was: harde unique) — sectie 4.1
3. Evidence requirements generiek met `requirement_type` enum (was: documentgericht) — sectie 4.9
4. Audit snapshot bij besluitvorming automatisch via trigger — nieuwe sectie 4.11
5. AI-interactions: `gebruikt_in_dossier`/`gebruik_context`/`verworpen_reden` toegevoegd — sectie 4.8
6. Dissent: `zichtbaarheid` + `formeel_vastgesteld` toegevoegd — sectie 4.4
7. Volledigheidscheck → readiness met meerdere niveaus — sectie 5
8. Fasering opgesplitst in MVP-1A/B/C/D/E — sectie 7
9. Frontend view-model contract als aparte fase — sectie 7
10. Aparte RLS-strategiesectie — nieuwe sectie 13
11. Governance events: hash per event toegevoegd — sectie 4.10

---

## 1. Doelpositionering

We schuiven het bestuurdersportaal van **Plateau 1** ("Governance Workspace MVP") naar **Plateau 2** ("Procedure-led Governance Platform"), conform de roadmap-PDF. Concreet:

- **Procedure** wordt leidend, **documenten** worden bewijsstukken.
- Een **Decision Object** wordt centraal verankerd als zelfstandige entiteit. Alle informatie (documenten, AI-output, aannames, risico's, dissent, acties, evaluatie) hangt aan dit object.
- **AI** wordt een gecontroleerde laag *binnen* een procedurestap, met validatiestatus, bronverwijzingen en logging.
- Het **statusmodel** wordt aangescherpt naar de 14 statussen uit §23.1, met expliciete toegestane overgangen.
- **Volledigheidscheck** wordt een harde gate (BR-003 / REQ-005), met expliciet gemandateerde override (REQ-006).

---

## 2. Wat blijft, wat gaat weg, wat komt erbij

### Behouden (geen breaking changes)

- `procedures`, `procedure_eigenaars`, `procedure_stappen`, `procedure_checklist`, `procedure_bewijs`, `procedure_log` — werkt door als workflow-laag.
- Bestaande templates `uitbestedingsreview`, `incident_dnb`, `beleidswijziging` — blijven beschikbaar voor lopende dossiers.
- `procedure_besluiten` — wordt herbruikt, maar krijgt aanvullende velden (motivering, alternatieven, voorwaarden, dissent).
- RLS per `fonds_id` — patroon wordt overgenomen voor nieuwe tabellen.

### Nieuw

| Entiteit (spec §24) | Tabel | Functie |
|---|---|---|
| ProcedureTemplate (rijker) | `procedure_template_versies` + `procedure_template_stappen` + `procedure_evidence_requirements` | Templates database-driven, versiebeheer, per-stap evidence requirements (REQ-004). Vervangt op termijn `lib/proces-templates.ts`. |
| DecisionObject | `decision_objects` | Centraal besluitdossier (REQ-002). 1-op-1 met `procedures` in MVP-1. |
| Assumption | `decision_assumptions` | Gestructureerde aannames (REQ-009). |
| RiskItem | `decision_risks` | Risico's gekoppeld aan dit besluit (REQ-010). Los van `risicomatrix`. |
| Scenario | `decision_scenarios` | Scenario-objecten (MVP-2; tabel wel voorbereid). |
| Dissent | `decision_dissent` | Afwijkende standpunten (REQ-014). |
| DecisionCondition | `decision_conditions` | Voorwaarden + KPI's bij voorwaardelijke besluiten (BR-007). |
| ActionItem | `decision_actions` | Acties uit besluit (REQ-017). Bestaande `procedure_log` blijft event log. |
| Evaluation | `decision_evaluations` | Verplicht evaluatiemoment (REQ-018). |
| AIInteraction | `decision_ai_interactions` | Prompt + bronnen + model + validatiestatus (REQ-007/008). |
| GovernanceEvent | `governance_events` | Immutable eventlog op besluitniveau (BR-010). Naast bestaande `procedure_log`. |
| EvidenceRequirement | `procedure_evidence_requirements` | Per stap configureerbaar wat verplicht is. |

### Op termijn migreren (later, niet nu)

- `lib/proces-templates.ts` → database-templates met versies. Voor MVP-1 houden we de code-bron-van-waarheid, maar kopiëren bij `procedure_start` een snapshot naar de DB *plus* maken we een DecisionObject aan.

---

## 3. Statusmodel

### Huidig

```
in_uitvoering  →  wacht_op_besluit  →  afgerond
```

### Nieuw (DecisionObject.status, conform §23.1)

```
concept
  └─→ in_onderbouwing  ←──┐
       ├─→ in_validatie ──┘     ←──┐
       │    ├─→ in_review ────────┘
       │    │    ├─→ geagendeerd
       │    │    │    ├─→ in_bespreking
       │    │    │    │    ├─→ besloten ──→ in_uitvoering ──→ in_evaluatie ──→ afgesloten
       │    │    │    │    ├─→ voorwaardelijk_besloten ──→ in_uitvoering ──→ ...
       │    │    │    │    ├─→ aangehouden
       │    │    │    │    └─→ teruggezet
       │    │    │    └─→ aangehouden
       │    │    └─→ teruggezet
       │    └─→ geescaleerd
       │         └─→ (in_validatie | in_review | aangehouden)
       └─→ teruggezet
afgewezen   (eindstand vanuit elk pad)
geannuleerd (vanuit concept of in_onderbouwing)
heropend    (vanuit afgesloten of in_evaluatie)
```

Toegestane overgangen worden in een aparte tabel `decision_status_overgangen` of in een check-functie afgedwongen. Voorstel: db-side function `assert_status_overgang(oud, nieuw)` die wordt aangeroepen vanuit een `before update` trigger op `decision_objects`.

`procedures.status` blijft bestaan (legacy/workflow), maar `decision_objects.status` is leidend zodra een dossier een Decision Object heeft.

---

## 4. Datamodel — tabel voor tabel

### 4.1 `decision_objects`

> **Wijziging v2**: classificatie gesplitst in zes dimensies; harde 1:1-koppeling met procedure vervangen door partial unique index op `is_primary_decision`. Dat geeft 1:1-gedrag voor MVP-1 zonder dat een latere overgang naar 1:n een datamigratie vergt.

```sql
create table public.decision_objects (
  id                   uuid primary key default uuid_generate_v4(),
  procedure_id         uuid not null references public.procedures(id) on delete cascade,
  fonds_id             uuid not null references public.fondsen(id) on delete cascade,
  besluit_code         text not null unique,                       -- bijv. BSL-2026-0001
  titel                text not null,
  besluitvraag         text not null,
  aanleiding           text,
  scope                text,
  governance_orgaan    text,
  vertrouwelijkheid    text check (vertrouwelijkheid in ('publiek','intern','vertrouwelijk','strikt_vertrouwelijk')) default 'intern',

  -- Classificatie: vijf onafhankelijke dimensies + AI-risicoklasse
  complexiteit         text not null default 'complicated'
                        check (complexiteit in ('routine','complicated','complex')),
  risiconiveau         text not null default 'middel'
                        check (risiconiveau in ('laag','middel','hoog')),
  mandaatgevoelig      boolean default false,
  toezichtgevoelig     boolean default false,
  beleidsafwijking     boolean default false,
  ai_risicoklasse      text default 'laag'
                        check (ai_risicoklasse in ('laag','middel','hoog')),

  status               text not null default 'concept'
                        check (status in (
                          'concept','in_onderbouwing','in_validatie','in_review',
                          'geagendeerd','in_bespreking','besloten','voorwaardelijk_besloten',
                          'afgewezen','aangehouden','geescaleerd','teruggezet',
                          'in_uitvoering','in_evaluatie','afgesloten','heropend','geannuleerd'
                        )),
  is_primary_decision  boolean not null default true,              -- bereid 1:n voor
  eigenaar_id          uuid references auth.users(id) on delete set null,
  eigenaar_naam        text,
  template_versie      text,                                       -- bevriest welke procedureversie geldt
  gewenste_besluitdatum date,
  aangemaakt_op        timestamptz default now(),
  laatst_gewijzigd     timestamptz default now()
);
create index idx_dobj_fonds on public.decision_objects(fonds_id, aangemaakt_op desc);
create index idx_dobj_procedure on public.decision_objects(procedure_id);
-- Partial unique: maximaal één primary decision per procedure.
-- Niet-primary decisions zijn toegestaan, ook in MVP-1 als datamodel-toleratie.
create unique index idx_dobj_one_primary on public.decision_objects(procedure_id)
  where is_primary_decision = true;
```

> **Toelichting classificatie-dimensies**: business rules schakelen op de combinatie. Voorbeelden:
> - `complexiteit = complex` → kernaannames verplicht in readiness-check
> - `risiconiveau = hoog` → risk review verplicht; AI-output validatie verplicht door risk-rol
> - `mandaatgevoelig = true` → mandaatcheck verplicht in readiness-check
> - `toezichtgevoelig = true` → auditdossier krijgt extra verantwoordingsvelden + read-only auditor view
> - `beleidsafwijking = true` → governance-event `policy_deviation_flagged` automatisch geloggd
> - `ai_risicoklasse = hoog` → menselijke validatie van álle AI-output verplicht (BR-009)

### 4.2 `decision_assumptions`

```sql
create table public.decision_assumptions (
  id              uuid primary key default uuid_generate_v4(),
  decision_id     uuid not null references public.decision_objects(id) on delete cascade,
  tekst           text not null,
  type            text check (type in ('macro','beleggingsinhoudelijk','risico','kosten','governance','overig')) default 'overig',
  bron_document_id uuid references public.documenten(id) on delete set null,
  ai_gedetecteerd boolean default false,
  status          text check (status in ('concept','gevalideerd','gewijzigd','verwijderd')) default 'concept',
  onzekerheid     text check (onzekerheid in ('laag','middel','hoog')),
  evaluatiecriterium text,
  aangemaakt_op   timestamptz default now(),
  gewijzigd_door  uuid references auth.users(id)
);
```

### 4.3 `decision_risks`

```sql
create table public.decision_risks (
  id              uuid primary key default uuid_generate_v4(),
  decision_id     uuid not null references public.decision_objects(id) on delete cascade,
  risicomatrix_id uuid references public.risicos(id) on delete set null,  -- optionele koppeling
  categorie       text check (categorie in ('financieel','operationeel','juridisch','reputatie','liquiditeit','compliance','overig')),
  beschrijving    text not null,
  impact          int check (impact between 1 and 5),
  kans            int check (kans between 1 and 5),
  eigenaar_naam   text,
  mitigatie       text,
  residual_risk   text,
  status          text check (status in ('open','gemitigeerd','geaccepteerd')) default 'open'
);
```

### 4.4 `decision_dissent`

> **Wijziging v2**: `zichtbaarheid` + `formeel_vastgesteld` toegevoegd. Niet alle dissent hoort meteen in het formele dossier — privénotitie en gedeelde zorg moeten kunnen bestaan zonder dat ze direct deel uitmaken van verantwoording. RLS-policy voor dissent wordt strenger (zie sectie 13).

```sql
create table public.decision_dissent (
  id                       uuid primary key default uuid_generate_v4(),
  decision_id              uuid not null references public.decision_objects(id) on delete cascade,
  bestuurder_id            uuid references auth.users(id) on delete set null,
  bestuurder_naam          text not null,
  zichtbaarheid            text not null default 'gedeelde_zorg'
                            check (zichtbaarheid in (
                              'prive','gedeelde_zorg','formele_dissent','minderheidsnotitie'
                            )),
  formeel_vastgesteld      boolean default false,
  standpunt                text not null,
  argument                 text,
  gekoppeld_risico_id      uuid references public.decision_risks(id) on delete set null,
  gekoppeld_aanname_id     uuid references public.decision_assumptions(id) on delete set null,
  gekoppeld_voorwaarde_id  uuid,  -- forward reference, FK toegevoegd na decision_conditions
  aangemaakt_op            timestamptz default now()
);
```

### 4.5 `decision_conditions`

```sql
create table public.decision_conditions (
  id              uuid primary key default uuid_generate_v4(),
  decision_id     uuid not null references public.decision_objects(id) on delete cascade,
  voorwaarde      text not null,
  eigenaar_naam   text,
  kpi             text,
  drempelwaarde   text,
  monitorfrequentie text,
  deadline        date,
  heroverwegingstrigger text,
  status          text check (status in ('open','op_schema','afwijking','vervuld','overschreden')) default 'open'
);
```

### 4.6 `decision_actions`

```sql
create table public.decision_actions (
  id              uuid primary key default uuid_generate_v4(),
  decision_id     uuid not null references public.decision_objects(id) on delete cascade,
  voorwaarde_id   uuid references public.decision_conditions(id) on delete set null,
  actie           text not null,
  eigenaar_naam   text,
  deadline        date,
  status          text check (status in ('open','in_behandeling','afgerond','vervallen','escalatie')) default 'open',
  afhankelijk_van uuid references public.decision_actions(id) on delete set null
);
```

### 4.7 `decision_evaluations`

```sql
create table public.decision_evaluations (
  id              uuid primary key default uuid_generate_v4(),
  decision_id     uuid not null references public.decision_objects(id) on delete cascade,
  geplande_datum  date not null,
  uitgevoerd_op   timestamptz,
  verwachte_effecten text,
  realisatie      text,
  afwijkingsanalyse text,
  conclusie       text,
  lessons_learned text,
  uitgevoerd_door uuid references auth.users(id)
);
```

### 4.8 `decision_ai_interactions`

> **Wijziging v2**: `gebruikt_in_dossier` + `gebruik_context` + `verworpen_reden` toegevoegd. Voor de meest relevante audit-vraag — *welke AI-output heeft het besluit beïnvloed?* — moet expliciet zijn welke output gevalideerd én daadwerkelijk gebruikt is, en welke verworpen is en waarom.

```sql
create table public.decision_ai_interactions (
  id                  uuid primary key default uuid_generate_v4(),
  decision_id         uuid not null references public.decision_objects(id) on delete cascade,
  procedure_stap_id   uuid references public.procedure_stappen(id) on delete set null,
  type                text not null
                       check (type in (
                         'samenvatting','aannamedetectie','scenario',
                         'kritische_vraag','vergelijking'
                       )),
  prompt              text not null,
  bronnen             jsonb default '[]',
  model               text default 'claude-sonnet-4-5',
  modelversie         text,
  output              text not null,
  validatiestatus     text default 'concept'
                       check (validatiestatus in (
                         'concept','gevalideerd','aangepast','afgekeurd','gearchiveerd'
                       )),
  gevalideerd_door    uuid references auth.users(id) on delete set null,
  gevalideerd_op      timestamptz,
  aangepaste_output   text,

  -- Audit: welke AI-output heeft besluit beïnvloed?
  gebruikt_in_dossier boolean default false,
  gebruik_context     text,                  -- bijv. "samenvatting voor board review", "input besluittekst"
  verworpen_reden     text,

  -- Validatiedomein: bepaalt welke rol mag valideren (rev. 2.1)
  validatie_domein    text default 'algemeen'
                       check (validatie_domein in (
                         'algemeen','risk','compliance','beleggingen','governance'
                       )),

  aangemaakt_op       timestamptz default now(),
  aangemaakt_door     uuid references auth.users(id) on delete set null
);
```

### 4.9 `procedure_requirements` (was: `procedure_evidence_requirements`)

> **Wijziging v2**: tabel hernoemd en gegeneraliseerd. "Evidence" in governance is breder dan documenten — een vereiste kan ook een gevalideerde aanname, een gevalideerde AI-samenvatting, een mandaatcheck, een risk review, een ingevulde KPI of een evaluatiedatum zijn. `documenttype` blijft bestaan maar wordt nullable: alleen relevant bij `requirement_type = 'document'`.

```sql
create table public.procedure_requirements (
  id                uuid primary key default uuid_generate_v4(),
  template_code     text not null,
  stap_volgorde     int not null,
  requirement_type  text not null
                     check (requirement_type in (
                       'document','field','assumption','risk',
                       'ai_validation','approval','mandate_check',
                       'kpi','evaluation','dissent_review'
                     )),
  label             text not null,
  documenttype      text,                       -- alleen bij requirement_type = 'document'
  veld_pad          text,                       -- alleen bij 'field' (bijv. "decision.besluitvraag")
  verplicht         boolean default true,
  blokkerend        boolean default true,       -- BR-003 gatekeeping
  validatieregel    text,                       -- vrije omschrijving / SQL hint
  -- Conditionele activatie op classificatie-dimensies (sectie 4.1):
  triggert_bij_complexiteit  text[] default null,    -- bijv. ['complex','hoog_risico'] → null = altijd
  triggert_bij_risiconiveau  text[] default null,
  triggert_bij_mandaatgevoelig boolean default null,
  triggert_bij_toezichtgevoelig boolean default null,
  unique (template_code, stap_volgorde, requirement_type, coalesce(documenttype, label))
);
```

> **Voorbeeldconfiguratie** voor template `beleidswijziging_beleggingsbeleid`, stap "Onderbouwing":
> - `requirement_type='document', documenttype='ALM_analyse', verplicht=true, blokkerend=true`
> - `requirement_type='document', documenttype='risicoanalyse', verplicht=true, blokkerend=true`
> - `requirement_type='document', documenttype='liquiditeitsanalyse', triggert_bij_risiconiveau={'hoog'}`
> - `requirement_type='ai_validation', label='AI-samenvatting gevalideerd', verplicht=true, blokkerend=true`
> - `requirement_type='assumption', label='≥ 3 gevalideerde kernaannames', triggert_bij_complexiteit={'complex'}, triggert_bij_risiconiveau={'hoog'}`
> - `requirement_type='mandate_check', label='Mandaatcheck uitgevoerd', triggert_bij_mandaatgevoelig=true`

> **Combineren van triggers (semantiek)**: binnen één array werkt OR (`triggert_bij_complexiteit={'complex','complicated'}` betekent: complexiteit moet complex *of* complicated zijn). Tussen meerdere `triggert_bij_*`-velden werkt AND (alle gezette filters moeten gelden). Wanneer je OR over verschillende dimensies wilt — bijvoorbeeld "vereist bij complex *of* hoog risico" — maak je twee aparte rijen aan: één met `triggert_bij_complexiteit={'complex'}` en één met `triggert_bij_risiconiveau={'hoog'}`. Dat is iets meer schrijfwerk in de seed, maar maakt elke trigger traceerbaar.

> **Voorbeeld bovenstaande `assumption`-rij**: zoals nu geconfigureerd geldt deze alleen wanneer complexiteit complex is **én** risiconiveau hoog. Voor "complex óf hoog risico" zou je dit splitsen in twee rijen.

### 4.10 `governance_events`

> **Wijziging v2**: hash-kolom toegevoegd voor integriteit. Update/delete worden geblokkeerd door triggers (sterker dan alleen `revoke`, omdat triggers ook tegen direct database-werk werken). Chained hash sla ik bewust over voor MVP-1: zonder externe service-role-discipline voegt een keten weinig toe — wie kan inserten, kan ook de keten herberekenen. Wordt wel als toekomstige aanscherping gedocumenteerd.

```sql
create table public.governance_events (
  id              uuid primary key default uuid_generate_v4(),
  decision_id     uuid references public.decision_objects(id) on delete cascade,
  event_type      text not null,
  actor_id        uuid references auth.users(id) on delete set null,
  actor_naam      text,
  object_type     text,                                  -- 'aanname','risico','dissent','status', etc.
  object_id       uuid,
  oude_waarde     jsonb,
  nieuwe_waarde   jsonb,
  reden           text,
  hash            text,                                  -- sha256 over canonical-JSON van event
  tijdstip        timestamptz default now()
);
create index idx_govevents_dec on public.governance_events(decision_id, tijdstip desc);
```

**Append-only afdwingen** (sterker dan alleen revoke):

```sql
create or replace function public.fn_govevent_immutable()
returns trigger language plpgsql as $$
begin raise exception 'governance_events is append-only'; end;
$$;
create trigger trg_govevent_no_update before update on public.governance_events
  for each row execute procedure public.fn_govevent_immutable();
create trigger trg_govevent_no_delete before delete on public.governance_events
  for each row execute procedure public.fn_govevent_immutable();
```

**Hash-trigger** (sha256 over canonical JSON van het event):

```sql
create or replace function public.fn_govevent_hash()
returns trigger language plpgsql as $$
begin
  new.hash := encode(
    digest(
      coalesce(new.event_type,'') || '|' ||
      coalesce(new.decision_id::text,'') || '|' ||
      coalesce(new.object_type,'') || '|' ||
      coalesce(new.object_id::text,'') || '|' ||
      coalesce(new.oude_waarde::text,'') || '|' ||
      coalesce(new.nieuwe_waarde::text,'') || '|' ||
      coalesce(new.tijdstip::text, now()::text),
      'sha256'
    ), 'hex'
  );
  return new;
end;
$$;
create trigger trg_govevent_hash before insert on public.governance_events
  for each row execute procedure public.fn_govevent_hash();
```

> **Toekomstige aanscherping (MVP-2 of later)**: chained hash (event bevat hash van vorige event binnen `decision_id`) plus aparte service-role voor inserts. Voor MVP-1 is de combinatie *append-only triggers + per-event hash* een verdedigbare audit-baseline.

### 4.11 `decision_audit_snapshots` (nieuw v2)

> **Toegevoegd na review**: zonder snapshot kan het auditdossier achteraf veranderen omdat documenten, validatiestatussen of metadata later worden gewijzigd. Voor governance is *de toestand op het moment van besluitvorming* essentieel.

```sql
create table public.decision_audit_snapshots (
  id              uuid primary key default uuid_generate_v4(),
  decision_id     uuid not null references public.decision_objects(id) on delete cascade,
  trigger_status  text not null,                 -- 'besloten' | 'voorwaardelijk_besloten' | 'in_evaluatie' | 'afgesloten'
  snapshot        jsonb not null,                -- volledige Decision Dossier View (sectie 7)
  hash            text not null,                 -- sha256 over snapshot
  aangemaakt_op   timestamptz default now()
);
create index idx_audit_snap_dec on public.decision_audit_snapshots(decision_id, aangemaakt_op desc);
```

Snapshot wordt automatisch via trigger op `decision_objects` aangemaakt bij overgang naar `besloten`, `voorwaardelijk_besloten`, `in_evaluatie` of `afgesloten`. De auditdossier-API kan dan kiezen tussen `?versie=actueel` (live query) of `?versie=besluitmoment` (uit snapshot). Latere wijzigingen zijn aanvullingen, geen stille vervanging — exact wat sectie 9.2 van de spec eist.

De snapshot wordt opgebouwd via dezelfde view-builder als de live API-route (zie sectie 7) zodat één bron-van-waarheid blijft.

**Immutability van snapshots** (rev. 2):

- Geen `update` toegestaan — afgedwongen door `before update`-trigger die exception gooit.
- Geen `delete` toegestaan — idem via `before delete`-trigger.
- Hash wordt server-side berekend (`encode(digest(snapshot::text, 'sha256'), 'hex')`) en samen met de snapshot opgeslagen, zodat manipulatie achteraf detecteerbaar is.
- Snapshot-payload mag nooit client-side worden aangeleverd — alleen de view-builder bepaalt de inhoud.
- Correctie van een onjuiste snapshot gebeurt via een nieuwe snapshot-rij plus een `governance_event` met `event_type='snapshot_corrected'`, niet door de oorspronkelijke rij te overschrijven.

---

## 5. Readiness-check (was: volledigheidscheck — REQ-005, BR-003)

> **Wijziging v2**: één binaire "besluitrijp"-check is te grof. In de praktijk zijn er meerdere readiness-niveaus die elk hun eigen vereisten hebben. Een dossier kan reviewrijp zijn maar nog niet besluitrijp; bespreekrijp maar met open punten; etc.

### 5.1 Readiness-niveaus

| Niveau | Betekenis | Vereisten |
|---|---|---|
| `onderbouwing_compleet` | Vereiste documenten + velden aanwezig | Alle blokkerende `requirement_type='document'` aanwezig; classificatie ingevuld |
| `reviewrijp` | Bestuurders kunnen verantwoord voorbereiden | Onderbouwing compleet + AI-samenvatting `gevalideerd`/`aangepast` + risico's geregistreerd |
| `bespreekrijp` | Dossier mag op agenda | Reviewrijp + besluitvraag + opties + alternatieven + scenario's voor classificatie ≥ complex |
| `besluitrijp` | Besluit kan formeel worden genomen | Bespreekrijp + kernaannames `gevalideerd` (bij complex/hoog) + mandaatcheck (bij mandaatgevoelig) |
| `verantwoordingsrijp` | Auditdossier compleet | Besluit vastgelegd + motivering + alternatieven + voorwaarden (bij voorwaardelijk) + dissent verwerkt |
| `evaluatierijp` | KPI's, aannames, evaluatiemoment ingericht | KPI's gedefinieerd + evaluatiedatum gepland + aannames met evaluatiecriterium |

### 5.2 API

Twee complementaire functies:

```sql
-- Per gewenste overgang: voldoet dossier aan eisen?
decision_readiness_check(p_decision_id uuid, p_target text)
  returns jsonb;
-- → { "voldoet": false, "ontbrekend": [...], "blokkerend": true, "kan_overrulen": ['voorzitter','beheerder'] }

-- Voor dashboard: alle readiness-niveaus tegelijk
decision_readiness_overview(p_decision_id uuid)
  returns jsonb;
-- → { "onderbouwing_compleet": true, "reviewrijp": true, "bespreekrijp": false, ... }
```

Frontend toont een readiness-ladder; doorzetten naar volgende status is alleen mogelijk als `voldoet = true` voor de bijbehorende readiness, of via expliciete override door bevoegde rol (REQ-006), gelogd als `governance_event` met `event_type='override_<readiness>'`.

---

## 6. Auditdossier (REQ-016)

Geen aparte tabel. Server route `/api/decisions/[id]/auditdossier` haalt alle gerelateerde rijen op en levert:

- HTML-export (printbaar), of
- JSON-export voor machine consumption.

Inhoud volgens §9.1: metadata, procedureversie, classificatie + wijzigingen, rollen, documenten + versies, AI-interacties, aannames, scenario's, risico's, mandaat-/kaderchecks, discussiepunten, dissent, besluittekst, motivering, voorwaarden, acties, KPI's, evaluatiemomenten, lessons learned.

---

## 7. Fasering — MVP-1 onderverdeeld in 1A/1B/1C/1D/1E

> **Wijziging v2**: opgesplitst om scope per oplevering beheersbaar te houden. Per subfase moet er werkende, demonstreerbare functionaliteit staan voordat we naar de volgende subfase gaan.

### 7.1 Decision Dossier View — frontend contract (vóór UI)

> **Toegevoegd na review**: voorkomt dat de UI rechtstreeks op losse tabellen werkt en complex wordt.

`lib/decision-view.ts` definieert het samengestelde view-model:

```ts
export interface DecisionDossierView {
  decision: DecisionObject;          // alle classificatie-dimensies
  procedure: ProcedureSummary;       // template_code, versie, fase
  currentStep: ProcedureStep | null; // actieve stap
  readiness: ReadinessOverview;      // alle 6 niveaus + ontbrekend per niveau
  evidence: EvidenceItem[];          // documenten + andere requirement_types
  assumptions: Assumption[];
  risks: RiskItem[];
  scenarios: Scenario[];             // leeg in MVP-1A, gevuld in latere subfases
  aiOutputs: AIInteraction[];
  dissent: DissentItem[];            // gefilterd op zichtbaarheid + rol caller
  conditions: DecisionCondition[];
  actions: ActionItem[];
  evaluations: Evaluation[];
  events: GovernanceEvent[];         // laatste N, gepagineerd
  snapshots: AuditSnapshotMeta[];    // alleen meta, niet de payload
}
```

Eén API-route `GET /api/decisions/:id/dossier` levert dit object in één call. De RLS-policies bepalen welke velden de aanroeper te zien krijgt (zie sectie 13). De server-side functie `fn_build_decision_dossier(decision_id)` is dezelfde die ook door de snapshot-trigger wordt gebruikt.

### 7.2 Subfases

| Subfase | Inhoud | Demonstreerbaar resultaat |
|---|---|---|
| **0** | Ontwerpdocument (deze) — review, akkoord op 5 ontwerpkeuzes | Beslissing op datamodel-richting |
| **1A** | Schema-migratie kern: `decision_objects`, statusmodel, `procedure_requirements`, `governance_events`, readiness-functies, RLS-policies, view-builder `fn_build_decision_dossier` | Decision Object kan worden aangemaakt; readiness-overview werkt; events worden gelogd |
| **1B** | Template seed `beleidswijziging_beleggingsbeleid` v2 + alle requirements + auto-upgrade van bestaande procedures + `lib/decision-view.ts` types + dossier-API | Bij start nieuwe procedure ontstaat compleet Decision Object met readiness-ladder; bestaande procedures krijgen automatisch een Decision Object |
| **1C** | UI: Decision Object header op procedure-detailpagina + classificatie-panel (6 dimensies) + readiness-ladder + per-stap-requirements view + AI-samenvatting binnen stap met validatie-actie | Bestuurder ziet besluitdossier en kan AI-output valideren; readiness blokkeert overgangen |
| **1D** | Aannames + risico's-panelen + besluitregistratie-uitbreiding + dissent-panel met zichtbaarheidsniveaus | Volledig MVP-1 zonder auditdossier-export |
| **1E** | `decision_audit_snapshots` activeren + auditdossier-export (HTML + JSON) met `?versie=actueel` of `?versie=besluitmoment` | Reproduceerbaar besluitdossier |
| **2** | tsc-check, schema-validatie tegen Supabase, HANDOVER.md update | Vercel-deploy ready |

Per subfase: lokaal testen (`npm run dev` + `tsc --noEmit`); pas commit-ready maken na fase 2.

### 7.3 Tussentijdse demo na 1B

Voorstel: na 1B een korte demo met eindgebruiker (bestuurssecretaris) om te toetsen of het mentale model klopt vóórdat we de hele UI bouwen. Goedkoper dan 1C–1E afmaken en dan ontdekken dat de informatiearchitectuur niet werkt.

**Toets-vragen voor de demo** (vooraf afspreken; voorkomt dat het een algemene rondleiding wordt):

1. Begrijpt de gebruiker het verschil tussen *procedure*, *dossier* en *Decision Object*?
2. Is duidelijk waarom documenten *bewijsstukken* zijn binnen een procedure, niet het primaire object?
3. Is de readiness-ladder (zes niveaus) intuïtief leesbaar? Snapt de gebruiker waar het dossier nu staat en wat er nog moet?
4. Zijn ontbrekende vereisten concreet genoeg geformuleerd om actie op te nemen ("ALM-analyse ontbreekt") of te abstract ("requirement-type document")?
5. Snapt de gebruiker waarom iets *blokkerend* is en wat een override betekent?
6. Is de auto-upgrade van bestaande procedures naar Decision Object begrijpelijk of verwarrend?
7. Ontstaat vertrouwen dat dit helpt bij bestuurlijke voorbereiding, of voelt het als extra administratieve last?

Bij positieve antwoorden op 1–7: door naar 1C UI-bouw. Bij twijfel op een of meerdere punten: eerst informatiearchitectuur of terminologie aanpassen voordat UI wordt geïmplementeerd. Demo-uitkomsten worden vastgelegd als `lessons_learned` in `procedure_requirements`-config of als opmerkingen in dit ontwerpdocument.

---

## 8. Migratiestrategie

- **Idempotent**: alle `create table if not exists`, `alter table ... add column if not exists`. Conform bestaande migraties in `supabase/migrations/`.
- **Backwards compatible**: bestaande procedures zonder Decision Object blijven werken; UI valt terug op de oude weergave als `decision_objects.id is null`.
- **Voor lopende dossiers**: bij eerste opening van een procedure zonder Decision Object kan automatisch een minimaal Decision Object worden aangemaakt (status `in_uitvoering` mapt naar `in_onderbouwing`/`in_review` afhankelijk van `wacht_op_besluit`).
- **Geen verlies van bestaande data**: `procedures`, `procedure_stappen`, etc. ongewijzigd. Alleen kolom `decision_id` toegevoegd aan `procedures` als handige foreign key.

---

## 9. Open ontwerpbeslissingen (uit spec §28)

Deze moeten we beantwoorden vóór UI-fase, omdat ze gedrag aansturen:

1. **Welke rol mag AI-output valideren?** Voorstel: per AI-output gestuurd door het veld `validatie_domein` (zie sectie 4.8). Default `algemeen` voor proceseigenaar; `risk`/`compliance`/`beleggingen`/`governance` vragen voorzitter of beheerder. Configuratie van het juiste domein gebeurt in de prompt-template per `requirement_type='ai_validation'` in `procedure_requirements`.
2. **Wanneer is een dossier rijp voor de volgende status?** Voorstel — readiness-target gekoppeld aan statusovergang:

   | Doelstatus | Vereist readiness-niveau |
   |---|---|
   | `in_review` | `reviewrijp` |
   | `geagendeerd` | `bespreekrijp` |
   | `besloten` / `voorwaardelijk_besloten` | `besluitrijp` |
   | `afgesloten` | `verantwoordingsrijp` + (bij complex/hoog) `evaluatierijp` |

   Doorzetten naar een doelstatus zonder bijbehorend readiness-niveau is alleen mogelijk via expliciete override door bevoegde rol (zie punt 3), gelogd als `governance_event`.
3. **Welke overrides toegestaan?** Voorstel: alleen `rol in ('voorzitter','beheerder')`, altijd met reden, altijd als `governance_event` met `event_type='override_<readiness>'`.
4. **Dissent-detail?** Voorstel: standaard op argument-niveau (vrije tekst), optioneel uitgebreide minderheidsnotitie. Zichtbaarheid via `decision_dissent.zichtbaarheid` (zie sectie 4.4 en RLS in 13).
5. **Verplichte KPI's bij beleidswijziging?** Voorstel template-default: rendementsbijdrage, liquiditeitsratio, kostenratio, risicobudgetgebruik, dekkingsgraadimpact, ALM-afwijking.
6. **Regulator view in MVP-1?** Voorstel: nee, datamodel wel klaar; read-only view in MVP-3 (Plateau 5).
7. **Versiebeheer template versus lopende dossiers?** `decision_objects.template_versie` bevriest de versie bij start; templatewijzigingen werken alleen door op nieuwe procedures. Migratie alleen expliciet (knop "migreer naar nieuwe templateversie").

---

## 10. Risico's bij implementatie

| Risico | Mitigatie |
|---|---|
| Te veel datamodel-omzwaai breekt bestaande procedures | Backwards-compatible migratie; bestaande tabellen ongewijzigd |
| `tsc --noEmit` faalt op Vercel | Per fase lokaal `npm run build` draaien voordat we doorgaan |
| Frontend-complexiteit explodeert | UI in fases; eerst Decision Object header op bestaande detailpagina, daarna aparte panelen |
| AI-prompts/validatie te zwaar voor MVP-1 | Eerst alleen samenvatting (REQ-007/008); aannamedetectie + scenario's pas in MVP-2 |
| RLS-gaten bij complexe joins | Alle nieuwe tabellen krijgen `enable row level security` + policy via `decision_id → procedure_id → fonds_id` |

---

## 11. Acceptatiecriteria voor MVP-1 (uit spec §27, samengevat)

Een gebruiker kan de procedure starten en het systeem maakt automatisch een traceerbaar Decision Object. Het systeem toont per procedurestap wat verplicht/optioneel/ontbrekend/gevalideerd/blokkerend is. Een onvolledig kritisch dossier kan niet zonder expliciete override naar board review of besluitvorming. AI-output is altijd gekoppeld aan bronnen, prompt, modelinformatie en validatiestatus. Aannames, risico's, dissent, voorwaarden, acties en evaluatie zijn gestructureerde data en niet alleen vrije tekst. Een besluit kan worden vastgelegd met motivering, verworpen alternatieven, voorwaarden, dissent en heroverwegingscriteria. Het auditdossier kan aantonen wie wat wanneer heeft gezien, toegevoegd, gevalideerd, besloten of overruled.

---

## 12. Wat dit document **niet** is

- Geen line-by-line implementatieplan; dat zit in de fase-tasks.
- Geen UI-mockups; ontwerp-richting is "uitbreiden van bestaande detailpagina met panelen", geen nieuwe IA.
- Geen contractdefinitie voor MVP-2 (Decision Rights, escalatie-engine, scenario-functionaliteit, lessons learned). Het datamodel is **wel** voorbereid op MVP-2 (lege tabellen `decision_scenarios` etc. mogen later worden toegevoegd; we voegen ze nog niet toe in deze migratie tenzij gewenst).

---

## 13. RLS-strategie en autorisatie (nieuw v2)

> **Toegevoegd na review**: voor een gereguleerde sector (pensioenfonds) is RLS geen technisch detail maar deel van de propositie. Onderstaande zes lagen werken samen; elke laag wordt apart getest.

### 13.1 Zes lagen

| Laag | Mechanisme | Tabel(len) |
|---|---|---|
| **1. Tenant-isolatie** | `fonds_id = (select fonds_id from profielen where id = auth.uid())` | `decision_objects` (direct) |
| **2. Decision-chain** | `decision_id in (select id from decision_objects where fonds_id = ...)` | Alle `decision_*`-tabellen + `governance_events` + `decision_audit_snapshots` |
| **3. Rolgebaseerd** | `profielen.rol in (...)` voor specifieke acties | Override-acties, AI-validatie, template-beheer |
| **4. Vertrouwelijkheid** | `decision_objects.vertrouwelijkheid` filter, gecombineerd met rol | Read-policies op decision-chain |
| **5. Dissent-zichtbaarheid** | `decision_dissent.zichtbaarheid` × rol van caller | `decision_dissent` apart strenger |
| **6. Auditor read-only** | Aparte rol `auditor`, alleen `select`-policies, alleen ten tijde van besluit (snapshot) | MVP-1: voorbereid, niet geactiveerd |

### 13.2 Concrete policies

**Decision-chain (laag 2)** — generiek patroon voor `decision_*`-tabellen:

```sql
create policy "fonds <tabel>" on public.<tabel>
  for all using (
    decision_id in (
      select id from public.decision_objects
       where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
    )
  );
```

**Dissent-zichtbaarheid (laag 5)** — strenger:

```sql
create policy "dissent zichtbaarheid" on public.decision_dissent
  for select using (
    -- Eigen dissent altijd zichtbaar
    bestuurder_id = auth.uid()
    or
    -- Gedeelde zorg + formele dissent + minderheidsnotitie: voor voorzitter/secretaris/beheerder
    (zichtbaarheid <> 'prive' and exists (
       select 1 from public.profielen
        where id = auth.uid() and rol in ('voorzitter','beheerder')
    ))
    or
    -- Formele dissent + minderheidsnotitie: voor alle bestuurders binnen fonds
    (zichtbaarheid in ('formele_dissent','minderheidsnotitie')
     and decision_id in (
       select id from public.decision_objects
        where fonds_id = (select fonds_id from public.profielen where id = auth.uid())
     ))
  );
```

**AI-validatie (laag 3)** — alleen specifieke rollen mogen `validatiestatus` updaten, afhankelijk van `validatie_domein`:

```sql
create policy "ai validatie domein" on public.decision_ai_interactions
  for update using (
    case validatie_domein
      when 'algemeen' then auth.uid() is not null  -- elke ingelogde gebruiker binnen fonds
      when 'risk', 'compliance' then exists (
        select 1 from public.profielen
         where id = auth.uid() and rol in ('voorzitter','beheerder')
      )
      when 'beleggingen' then exists (
        select 1 from public.profielen
         where id = auth.uid() and rol in ('voorzitter','beheerder')
      )
      when 'governance' then exists (
        select 1 from public.profielen
         where id = auth.uid() and rol in ('voorzitter','beheerder')
      )
      else false
    end
  );
```

> **Toelichting**: het rolmodel kent in MVP-1 alleen `bestuurder`, `voorzitter`, `beheerder` (zie `profielen.rol`). Wanneer in MVP-2/3 dedicated rollen `risk` en `compliance` worden geïntroduceerd, kunnen die gewoon aan deze case-statement worden toegevoegd zonder de tabel te wijzigen.

### 13.3 Service-role discipline

Alleen server-side code (API-routes met service-role-key) mag in `governance_events` en `decision_audit_snapshots` schrijven. Frontend krijgt geen direct insert-recht — events zijn altijd gevolgen van een API-call. Dit voorkomt dat een gemanipuleerde client events kan injecteren.

### 13.4 Tests vóór release

- Cross-tenant access test: gebruiker A van fonds X probeert decision Y van fonds Z te lezen → geen rij.
- Role-escalation test: bestuurder probeert AI-output te valideren → geweigerd; voorzitter kan wel.
- Dissent-isolation test: privé-notitie van bestuurder A is niet zichtbaar voor bestuurder B.
- Append-only test: poging tot `update`/`delete` op `governance_events` faalt met expliciete fout.
- Snapshot-immutability test: na `besloten` kan snapshot niet worden gewijzigd.

---

*Volgende stap zodra dit ontwerp akkoord is: Fase 1A — schemamigratie schrijven en als `supabase/migrations/2026_05_07_decision_object.sql` toevoegen.*
