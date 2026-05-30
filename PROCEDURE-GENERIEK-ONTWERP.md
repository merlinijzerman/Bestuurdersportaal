# Generieke proceduremodule — Ontwerpdocument

> **Status**: Revisie 0.2 (concept ter review)
> **Datum**: 2026-05-22
> **Bron**: `lib/proces-templates.ts`, `supabase/migrations/2026_05_07_decision_object.sql` (procedure_requirements, decision_objects), `supabase/migrations/2026_05_08_phase_1b_template_requirements.sql`, `PROCEDURE-MVP1-ONTWERP.md` (§2 "Op termijn migreren"), `Procedures-per-sector.docx` (pensioensectie)
> **Doel**: blauwdruk voor een generieke proceduremodule waarin procedure-*definities* als data leven (niet als code), zodat één engine willekeurig veel gedefinieerde procedures ondersteunt — met een **eenvoudige eindgebruikerservaring** aan de voorkant. Scope van deze revisie: de **acht pensioenprocedures**.
> **Scope-afbakening**: geen code in deze fase — dit document is het canonieke formaat + registry-DDL + UX-laag + migratiepad ter akkoord, conform het patroon "eerst ontwerp/prototype, dan iteratie".

## Revisielog

**v0.2 (2026-05-22)** — na reviewronde op v0.1. Zeven wijzigingen verwerkt:
1. Nieuwe sectie 6 **Gebruikerservaring — complexiteit onder de motorkap**: intakewizard, expliciete mapping intakevraag → classificatie/requirement/trigger, progressive disclosure per rol, drie vrijheidsniveaus.
2. `profiel_type` toegevoegd aan `ProcedureDefinitie` (§3) en aan `procedure_templates` (§4).
3. `fase_type` toegevoegd aan `StapDefinitie` (§3) en `procedure_template_stappen` (§4) — de generieke hoofdflow als lichtgewicht tag, niet als verplicht skelet.
4. Nieuwe sectie 9 **Validatie en tests** (Zod/JSON Schema + zes testklassen).
5. Fase B herordend (§10): eerst drie representatieve procedures, dán pas de overige vijf.
6. Nieuwe sectie 11 **Uitgestelde ontwerpbeslissing: bouwblokkenlaag** — met expliciet herbeoordelingsmoment en meetbare go/no-go-criteria.
7. Bewust *niet* opgenomen: een formele bouwblok-compositie-engine, `applicability_rules`, `override_policy` als schema-constructen (zie §11 voor de motivering).

**v0.1 (2026-05-22)** — eerste opzet: doelpositionering, canoniek formaat, registry-DDL, dekkingsanalyse 8 pensioenprocedures, uitgewerkt voorbeeld Wtp-invaarbesluit, migratiepad.

---

## 1. Doelpositionering

Vandaag is de procedure-*engine* al grotendeels generiek, maar de procedure-*definities* zijn hardcoded in `lib/proces-templates.ts`. Elke nieuwe of gewijzigde procedure vereist daardoor een code-deploy. Dat is de bottleneck die we wegnemen.

Het kerndoel kent twee kanten die even zwaar wegen:

- **Onder de motorkap — definitie als data, niet als code.** Eén canoniek formaat beschrijft een volledige procedure (metadata, stappen, checklist-items, per-stap-vereisten en hun conditionele activatie). De engine, de readiness-ladder en het Decision Object blijven ongewijzigd; ze gaan alleen lezen uit een database-registry in plaats van uit een TypeScript-array.
- **Aan de voorkant — eenvoud voor de eindgebruiker.** De bestuurder, het bestuursbureau en de secretaris merken niets van classificatie, conditionele requirements, `external_submission` of templateversies. Zij kiezen een begrijpelijk type besluit, beantwoorden een paar intakevragen, en krijgen een heldere procedure met zichtbare voortgang en vereisten. De generieke complexiteit blijft onder de motorkap (zie §6).

Twee niet-doelen voor deze fase, expliciet om scope-creep te voorkomen: geen in-app template-editor (komt later) en geen verzekeraars/woningcorporaties (alleen de acht pensioenprocedures als testset). Een derde, bewust *uitgestelde* beslissing — een formele bouwblokkenlaag — staat in §11.

---

## 2. Huidige situatie — wat al generiek is, wat niet

### Al generiek (behouden)

- **De engine**: snapshot-bij-start (template → `procedure_stappen`/`procedure_checklist`), validatie bij stap-voltooien (checklist + bewijs + besluit), automatische activatie van de volgende stap.
- **`procedure_requirements`** — al getypeerd en conditioneel. Feitelijke kolommen (bevestigd uit `2026_05_07_decision_object.sql` + `2026_05_08_phase_1c_requirements_columns.sql`):

  | Kolom | Betekenis |
  |---|---|
  | `template_code`, `stap_volgorde` | sleutel naar stap binnen template |
  | `requirement_type` | enum: document/field/assumption/risk/ai_validation/approval/mandate_check/kpi/evaluation/dissent_review |
  | `label` | leesbare omschrijving |
  | `documenttype` | alleen bij `document` |
  | `veld_pad` | alleen bij `field` (bv. `decision.besluitvraag`) |
  | `verplicht`, `blokkerend` | gating-vlaggen (BR-003) |
  | `validatieregel` | vrije omschrijving / SQL-hint |
  | `triggert_bij_complexiteit[]`, `triggert_bij_risiconiveau[]` | OR binnen array |
  | `triggert_bij_mandaatgevoelig`, `triggert_bij_toezichtgevoelig` | boolean-trigger |
  | `vereist_validatie_domein` | algemeen/risk/compliance/beleggingen/governance (welke rol mag valideren) |
  | `min_aantal` | drempel, default 1 (bv. ≥ 3 kernaannames) |

- **Classificatie-dimensies** op `decision_objects`: `complexiteit` (routine/complicated/complex), `risiconiveau` (laag/middel/hoog), `mandaatgevoelig`, `toezichtgevoelig`, `beleidsafwijking`, `ai_risicoklasse` (laag/middel/hoog), plus `template_versie` die de gebruikte versie bevriest.

> **Belangrijke observatie voor het vervolg**: `requirement_type` is in feite al een set herbruikbare, semantische bouwstenen, en `triggert_bij_*` is al het mechanisme "activeer op basis van classificatie". Veel van het hergebruik dat een bouwblokkenlaag zou bieden, bestaat dus al op requirement-niveau. Dit is de reden dat we een tweede, bovenliggend compositiemodel pas bouwen als de noodzaak bewezen is (§11).

### Nog niet generiek (te bouwen)

- **De definitiebron**: de template-structuur (stappen + checklist) leeft in code (`lib/proces-templates.ts`), de vereisten in losse SQL-seeds. Er is geen registry, geen versionering op recordniveau, en geen one-shot definitie die de hele procedure beschrijft.
- **De startbeleving**: een procedure starten betekent nu een template-code kiezen uit een lijst. Er is geen intake die gebruikerstaal vertaalt naar de juiste inrichting (§6).
- **Geen import-/exportpad**: definities zijn niet uitwisselbaar als data; een nieuwe procedure betekent code + SQL-seed schrijven.

---

## 3. Het canonieke definitieformaat

De kern van dit ontwerp. Eén object beschrijft een volledige procedure-versie. Dit is tegelijk het frontend-/import-contract (`lib/procedure-definitie.ts`) én de bron waaruit de registry-tabellen worden gevuld. Het verenigt de huidige `ProcessTemplate`-shape met de `procedure_requirements`-config.

```ts
export interface ProcedureDefinitie {
  code: string;                 // stabiele type-code, bv. "pf_wtp_invaarbesluit"
  versie: string;               // semver-achtig, bv. "1.0.0" — (code, versie) is uniek
  naam: string;
  sector: "pensioenfondsen" | "verzekeraars" | "woningcorporaties";
  profiel_type: ProfielType;    // categorie t.b.v. de intakewizard (§6)
  korte_omschrijving: string;
  context?: string;             // bestuurlijke betekenis (uit docx)
  // Meta-blok (1:1 met docx-meta):
  aanleiding?: string;
  frequentie?: string;          // "incidenteel" | "jaarlijks" | "vierjaarlijks" | ...
  eigenaar_rol?: string;
  regelgeving?: string[];       // ["Pensioenwet", "Wtp", "DNB-toezicht"]
  geschat_aantal_dagen: number;
  aandachtspunten?: string;
  // Suggestie van classificatie bij start; bestuursbureau/voorzitter kan bijstellen (§6.4):
  classificatie_default?: ClassificatieDefault;
  stappen: StapDefinitie[];
}

// Categorieën voor de intakewizard — bewust grofmazig en begrijpelijk:
export type ProfielType =
  | "generiek_besluit"
  | "beleidswijziging"
  | "uitbesteding"
  | "incident"
  | "toezichtmelding"
  | "geschiktheid"
  | "evaluatie";

export interface ClassificatieDefault {
  complexiteit?: "routine" | "complicated" | "complex";
  risiconiveau?: "laag" | "middel" | "hoog";
  mandaatgevoelig?: boolean;
  toezichtgevoelig?: boolean;
  beleidsafwijking?: boolean;
  ai_risicoklasse?: "laag" | "middel" | "hoog";
}

export interface StapDefinitie {
  volgorde: number;
  naam: string;
  beschrijving: string;
  fase_type: FaseType;          // lichtgewicht tag op de generieke hoofdflow (§3.1)
  vereist_besluit: boolean;
  geschatte_dagen: number;
  eigenaar_rol?: string;
  tijdkritisch?: boolean;       // bv. Incident-meldplicht DNB (24-72u)
  checklist: ChecklistItem[];
  requirements: RequirementDefinitie[];
}

// De generieke hoofdflow als TAG, niet als verplicht skelet (zie §3.1):
export type FaseType =
  | "intake"            // intake & classificatie
  | "onderbouwing"      // dossieropbouw, documenten
  | "analyse"           // analyse & onderbouwing, second line
  | "consultatie"       // consultatie / externe input / hoorrecht
  | "besluitvorming"    // formeel besluit
  | "externe_indiening" // toezichthoudermelding / externe communicatie
  | "implementatie"
  | "evaluatie";        // evaluatie & auditdossier

export interface ChecklistItem {
  volgorde: number;
  label: string;
  bewijs_vereist: boolean;
}

export interface RequirementDefinitie {
  requirement_type: RequirementType;
  label: string;
  documenttype?: string;        // bij 'document'
  veld_pad?: string;            // bij 'field'
  verplicht: boolean;
  blokkerend: boolean;
  min_aantal?: number;          // default 1
  vereist_validatie_domein?: "algemeen" | "risk" | "compliance" | "beleggingen" | "governance";
  validatieregel?: string;
  // Conditionele activatie (OR binnen array, AND tussen velden — conform §4.9 MVP-1):
  triggert_bij?: {
    complexiteit?: Array<"routine" | "complicated" | "complex">;
    risiconiveau?: Array<"laag" | "middel" | "hoog">;
    mandaatgevoelig?: boolean;
    toezichtgevoelig?: boolean;
    beleidsafwijking?: boolean;
  };
  // Voor externe meldingen / tijdgebonden vereisten (§7):
  termijn_dagen?: number;
  bevestiging_vereist?: boolean;
}

// Bestaande 10 + twee voorgestelde uitbreidingen (§7, open beslissing OB-1):
export type RequirementType =
  | "document" | "field" | "assumption" | "risk" | "ai_validation"
  | "approval" | "mandate_check" | "kpi" | "evaluation" | "dissent_review"
  | "external_submission" | "consultation";
```

Drie ontwerpprincipes:

1. **Eén bron per procedure.** Stappen, checklist én vereisten zitten in hetzelfde object; bij import worden ze uit elkaar getrokken naar de juiste tabellen.
2. **Conditionals i.p.v. duplicatie.** `triggert_bij` is het mechanisme waarmee één definitie meerdere situaties dekt. Een zware vereiste staat in de definitie maar activeert alleen bij de juiste classificatie.
3. **Versie is onderdeel van de identiteit.** `(code, versie)` is uniek; lopende procedures bevriezen hun versie via `decision_objects.template_versie`.

### 3.1 `fase_type` — de generieke hoofdflow als tag, niet als skelet

De feedback stelde een generieke hoofdflow voor (intake → dossieropbouw → analyse → consultatie → besluit → externe indiening → implementatie → evaluatie). Die flow is een waardevolle *mentale bril*, maar als verplicht skelet zou hij wringen: bij het Wtp-invaarbesluit zit hoorrecht *tussen* voorgenomen en definitief besluit, en de volgorde van analyse en consultatie verschilt per procedure. Daarom nemen we de hoofdflow op als **lichtgewicht tag** (`fase_type`) per stap, niet als afgedwongen structuur. Voordelen: rapportage en filtering "toon alle consultatie-stappen", een consistente woordenschat over procedures heen, en een natuurlijke kapstok als we later (§11) bouwblokken zouden willen extraheren — zonder dat we nu iets forceren of een compositie-engine bouwen.

---

## 4. Database-registry + versionering

Drie nieuwe tabellen vervangen `lib/proces-templates.ts` als bron van waarheid voor de stappen/checklist-structuur. `procedure_requirements` blijft bestaan en krijgt één extra kolom (`template_versie`).

```sql
-- 4.1 Template-kop (één rij per versie van een procedure)
create table if not exists public.procedure_templates (
  id                   uuid primary key default uuid_generate_v4(),
  code                 text not null,
  versie               text not null,                       -- bv. "1.0.0"
  naam                 text not null,
  sector               text not null
                        check (sector in ('pensioenfondsen','verzekeraars','woningcorporaties')),
  profiel_type         text                                 -- categorie t.b.v. intakewizard
                        check (profiel_type in (
                          'generiek_besluit','beleidswijziging','uitbesteding',
                          'incident','toezichtmelding','geschiktheid','evaluatie'
                        )),
  korte_omschrijving   text,
  context              text,
  aanleiding           text,
  frequentie           text,
  eigenaar_rol         text,
  regelgeving          jsonb default '[]'::jsonb,            -- string[]
  geschat_aantal_dagen int,
  aandachtspunten      text,
  classificatie_default jsonb default '{}'::jsonb,
  schema_versie        text,                                 -- versie van het ProcedureDefinitie-contract (Zod, §9)
  status               text not null default 'concept'
                        check (status in ('concept','actief','gearchiveerd')),
  is_laatste_versie    boolean not null default false,       -- welke versie nieuwe starts pakken
  fonds_id             uuid references public.fondsen(id) on delete cascade,  -- null = gedeelde bibliotheek
  aangemaakt_op        timestamptz default now(),
  aangemaakt_door      uuid references auth.users(id) on delete set null,
  unique (code, versie)
);
create unique index if not exists idx_template_laatste
  on public.procedure_templates(code, coalesce(fonds_id::text, 'shared'))
  where is_laatste_versie = true;

-- 4.2 Stappen per template-versie (snapshot-bron)
create table if not exists public.procedure_template_stappen (
  id                uuid primary key default uuid_generate_v4(),
  template_id       uuid not null references public.procedure_templates(id) on delete cascade,
  volgorde          int not null,
  naam              text not null,
  beschrijving      text,
  fase_type         text,                                    -- lichtgewicht hoofdflow-tag (§3.1)
  vereist_besluit   boolean default false,
  geschatte_dagen   int,
  eigenaar_rol      text,
  tijdkritisch      boolean default false,
  unique (template_id, volgorde)
);

-- 4.3 Checklist-items per template-stap
create table if not exists public.procedure_template_checklist (
  id                uuid primary key default uuid_generate_v4(),
  template_stap_id  uuid not null references public.procedure_template_stappen(id) on delete cascade,
  volgorde          int not null,
  label             text not null,
  bewijs_vereist    boolean default false,
  unique (template_stap_id, volgorde)
);

-- 4.4 procedure_requirements: één kolom erbij voor versionering
alter table public.procedure_requirements
  add column if not exists template_versie text;
```

Sleutelkeuzes:

- **`fonds_id` nullable** maakt een gedeelde bibliotheek (`null`) plus optionele fonds-specifieke varianten mogelijk. Voor de pensioen-only MVP zijn alle acht definities gedeeld.
- **`procedure_requirements` blijft de readiness-bron.** We folden hem bewust niet in een nieuwe child-tabel; alleen de keying wordt `(template_code, template_versie, stap_volgorde)`.
- **Géén bouwblok-kolommen nu.** We voegen bewust geen `actieve_bouwblokken`/`conditionele_bouwblokken` toe; die beslissing staat in §11.
- **Versie-promotie** verloopt in één transactie (nieuwe versie `actief` + `is_laatste_versie=true`, vorige op `false`); de partial unique index waarborgt één "laatste" versie.

---

## 5. Hoe de engine het formaat consumeert

Drie raakpunten, allemaal kleine wijzigingen op bestaande code — geen herontwerp.

1. **Bij `procedure_start`** leest een nieuwe helper `vindTemplateVersie(code, fonds_id)` de laatste actieve versie uit de registry. Stappen + checklist worden — net als nu — gesnapshot naar `procedure_stappen`/`procedure_checklist`; `decision_objects.template_versie` wordt op de gebruikte versie gezet.
2. **Readiness/vereisten**: ongewijzigd qua mechaniek. `buildEvidenceLijst` en `fn_decision_readiness_check` filteren `procedure_requirements` op `template_code + template_versie + stap_volgorde` plus de bestaande classificatie-conditionals.
3. **Code-fallback tijdens transitie**: `vindTemplateVersie` valt terug op `lib/proces-templates.ts` voor codes die nog niet in de registry staan. Daardoor blijft alles werken tijdens de migratie; de code-array verdwijnt pas als alle gewenste definities in de DB staan.

Het snapshot-pattern blijft heilig: lopende procedures wijzigen nooit mee met een nieuwe template-versie.

---

## 6. Gebruikerservaring — complexiteit onder de motorkap

Dit is een eerste-klas onderdeel van het ontwerp, geen bijzaak. Leidend principe:

> **Toon standaard alleen wat nodig is voor de gebruikerstaak van dat moment. Verberg onderliggende configuratie, conditionele vereisten en technische classificaties totdat een gebruiker daar expliciet rechten of behoefte voor heeft.**

De generieke complexiteit (classificatie, requirement-types, triggers, versies) zit volledig onder de motorkap. De bestuurder, het bestuursbureau en de secretaris zien een eenvoudige, begrijpelijke procedurebeleving.

### 6.1 De intakewizard

Een procedure starten verloopt via een korte wizard die gebruikerstaal vertaalt naar het interne model. Vier stappen:

**Stap 1 — Wat wilt u doen?** (kiest `profiel_type`)
Beleidswijziging · Uitbesteding / leverancierskeuze · Incident / melding · Evaluatie / periodieke review · Governance / bestuurder · Anders / generieke besluitprocedure.

**Stap 2 — Waar gaat het over?** (kiest de concrete `code` + versie)
Bv. bij beleidswijziging: Beleggingsbeleid · ABTN · Premiebeleid · Risicohouding · Communicatiebeleid · Anders. Hiermee staat de basis-set stappen/checklist/requirements vast (de `classificatie_default` van die definitie wordt voorgeladen).

**Stap 3 — Enkele eenvoudige classificatievragen** (zet classificatie + conditionals; zie 6.2)
Een handvol ja/nee-vragen in bestuurstaal.

**Stap 4 — Bevestiging.** Het systeem toont een leesbare samenvatting van wat de procedure wordt — inclusief wat *niet* van toepassing is (geen kunstmatige compleetheid), bv.:

> Wij stellen een procedure voor met: risicoanalyse, onderbouwing met ALM-document, second-line risk-validatie, formeel besluit en auditdossier. *Niet van toepassing:* liquiditeitsanalyse (geen hoog risico) en mandaatcheck (niet mandaatgevoelig).

Daarna: **Procedure starten**.

### 6.2 Mapping — welke intakevraag zet welk intern element aan

Dit is het hart van "complexiteit onder de motorkap": de wizardvragen uit Stap 3 vertalen één-op-één naar classificatie-dimensies op het Decision Object, die via `triggert_bij_*` de juiste vereisten activeren. De voorbeelden verwijzen naar de al-geseede requirements van `beleidswijziging_beleggingsbeleid` (migratie 1B/1C).

| Intakevraag (Stap 3) | Zet intern | Activeert (voorbeeld) |
|---|---|---|
| Is een formeel bestuursbesluit vereist? | markeert de besluitstap (`vereist_besluit`) → `approval`-requirement | readiness-niveau *besluitrijp*; besluitregistratie-gate (motivering + verworpen alternatieven) |
| Wijkt dit af van bestaand beleid? | `beleidsafwijking = true` | governance-event `policy_deviation_flagged`; zwaardere onderbouwing |
| Heeft dit (grote) impact op deelnemers of werkgevers? | verhoogt `risiconiveau` (→ middel/hoog) | bij hoog: `document` *liquiditeitsanalyse* (`triggert_bij_risiconiveau {hoog}`), evenwichtigheidstoets |
| Is dit een omvangrijk of principieel besluit? | verhoogt `complexiteit` (→ complex) | `assumption` *≥ 3 gevalideerde kernaannames* (`triggert_bij_complexiteit {complex}`, `min_aantal=3`); scenario's voor *bespreekrijp* |
| Is mandaat of bevoegdheid een aandachtspunt? | `mandaatgevoelig = true` | `mandate_check` (`triggert_bij_mandaatgevoelig=true`) |
| Is toezichthouderbetrokkenheid nodig? | `toezichtgevoelig = true` | `external_submission` (DNB/AFM-indiening + bevestiging + termijn); extra verantwoordingsvelden in auditdossier |
| Is externe consultatie nodig (VO, hoorrecht, stakeholders)? | zet consultatie-vlag op de relevante stap | `consultation`-requirement (VO geconsulteerd, reactie gewogen) |
| Is het tijdkritisch (wettelijke meldtermijn)? | `tijdkritisch=true` op de stap + `termijn_dagen` | aftel-indicatie in de UI; `external_submission.termijn_dagen` |
| AI-ondersteuning met verhoogd risico? | `ai_risicoklasse` (→ middel/hoog) | menselijke validatie van AI-output verplicht (BR-009) |

Twee belangrijke nuances. Ten eerste: `complexiteit` en `risiconiveau` worden deels *afgeleid* — uit de `classificatie_default` van het gekozen profiel plus het aantal "ja"-antwoorden — en niet rauw aan de gebruiker gevraagd. Ten tweede: de antwoorden van een gewone gebruiker produceren een **voorgestelde** classificatie; het bijstellen van de ruwe dimensies is voorbehouden aan bestuursbureau/voorzitter (vrijheidsniveau 2, §6.4).

### 6.3 Progressive disclosure per rol

Wat iemand standaard ziet, hangt af van de taak en de rol — niet van wat er technisch onder zit.

| Rol | Ziet vooral |
|---|---|
| Bestuurder | voortgang, stukken, vragen, besluitpunten, "wat ontbreekt nog" |
| Bestuursbureau / secretaris | stappen, verantwoordelijken, deadlines, bewijsstukken, vereisten |
| Beheerder / productteam | profielen, conditionele requirements, classificatie, versies |
| Audit / verantwoording | volledige onderbouwing: *waarom* iets verplicht was (classificatie + triggers) |

### 6.4 Drie vrijheidsniveaus

Een generieke procedure mag niet zó vrij worden dat inconsistent gebruik ontstaat. Daarom begrensde vrijheid in drie niveaus:

| Niveau | Voor wie | Vrijheid |
|---|---|---|
| Standaard profiel | gewone gebruiker | proceduretype kiezen + intakevragen beantwoorden |
| Classificatie | bestuursbureau / voorzitter | risiconiveau, toezichtgevoeligheid, consultatieplicht e.d. bijstellen |
| Override op vereisten | beheerder / voorzitter | alleen met motivering — vastgelegd als `governance_event` |

Elke override op een blokkerende vereiste verloopt via de bestaande override-mechaniek (REQ-006) en wordt als governance-event gelogd. Niets hiervan vraagt een nieuwe rules-engine; het bouwt op de classificatie + readiness-gates die al bestaan.

---

## 7. Dekkingsanalyse — de acht pensioenprocedures

De `Procedures-per-sector.docx` is de testset. Onderstaande tabel (geverifieerd tegen de docx) mapt elke procedure.

| # | Procedure | Stappen | Besluitstappen | Bijzondere vereisten |
|---|---|---|---|---|
| 1 | Wtp-invaarbesluit | 7 | 1, 4, 5 | evenwichtigheidstoets (extern), hoorrecht/consultatie VO, DNB-indiening + goedkeuring |
| 2 | ABTN-actualisatie | 5 | 1, 4 | consultatie verantwoordingsorgaan, DNB-melding |
| 3 | Beleidswijziging beleggingsbeleid | 5 | 4 | second-line risk (validatie_domein=risk), evenwichtigheidstoets |
| 4 | Selectie/vervanging vermogensbeheerder | 6 | 1, 4, 5 | DD-rapporten per partij (`min_aantal`), IMA/SLA-approval |
| 5 | Uitbestedingsreview pensioenuitvoerder | 5 | 5 | ISAE 3402 (extern assurance-document), triangulatie |
| 6 | Incident-meldplicht DNB | 6 | 2, 5 | **tijdkritisch**, melding binnen termijn + bevestiging |
| 7 | ALM-studie / portefeuille-herziening | 5 | 1, 5 | scenario-modellering (kpi/assumption), adviseurselectie |
| 8 | Geschiktheidstoetsing nieuwe bestuurder | 6 | 3, 6 | DNB-indiening + DNB-gesprek + goedkeuring (`external_submission`) |

Zes van de acht passen volledig binnen de bestaande tien `requirement_type`-waarden. Twee terugkerende patronen testen de randen:

- **Externe melding/indiening bij een toezichthouder met termijn en bevestiging** — in 1, 2, 6 en 8. **Voorstel: nieuw type `external_submission`** (`termijn_dagen` + `bevestiging_vereist`).
- **Consultatie van een stakeholder vóór besluit** — VO (1, 2) en hoorrecht (1). **Voorstel: nieuw type `consultation`**.

Beide zijn additief (een waarde in de CHECK-constraint + een tak in de readiness-logica) en geen blokker, maar maken het auditspoor scherper voor precies de zwaarste procedures. Belangrijk: ze worden alléén toegevoegd als `fn_decision_readiness_check` én `buildEvidenceLijst` ze ook echt meetellen — anders bestaan ze in data maar niet in functie. Dit is open beslissing OB-1 (§12). Het tijdkritische karakter van procedure 6 wordt gevangen met `StapDefinitie.tijdkritisch=true` plus een `external_submission` met `termijn_dagen`.

---

## 8. Uitgewerkt voorbeeld — Wtp-invaarbesluit

De zwaarste procedure, gekozen omdat hij alle randgevallen tegelijk test (externe toets, consultatie, hoorrecht, DNB-goedkeuring). Verkort weergegeven; let op de `fase_type`-tags en de conditionele requirements.

```jsonc
{
  "code": "pf_wtp_invaarbesluit",
  "versie": "1.0.0",
  "naam": "Wtp-invaarbesluit",
  "sector": "pensioenfondsen",
  "profiel_type": "beleidswijziging",
  "korte_omschrijving": "Omzetting bestaand pensioenvermogen naar persoonlijke pensioenvermogens onder de Wtp, incl. evenwichtigheidstoets, hoorrecht en DNB-goedkeuring.",
  "aanleiding": "Wettelijke Wtp-transitie (uiterlijk 2028)",
  "frequentie": "eenmalig / incidenteel",
  "eigenaar_rol": "voorzitter",
  "regelgeving": ["Wet toekomst pensioenen", "Pensioenwet", "DNB-toezicht"],
  "geschat_aantal_dagen": 540,
  "classificatie_default": {
    "complexiteit": "complex", "risiconiveau": "hoog",
    "mandaatgevoelig": true, "toezichtgevoelig": true,
    "beleidsafwijking": true, "ai_risicoklasse": "middel"
  },
  "stappen": [
    {
      "volgorde": 1, "fase_type": "intake",
      "naam": "Voorbereidingsbesluit en projectopzet",
      "beschrijving": "Bestuur stelt projectplan vast; externe adviseurs gecontracteerd.",
      "vereist_besluit": true, "geschatte_dagen": 30,
      "checklist": [
        { "volgorde": 1, "label": "Projectplan met mijlpalen vastgesteld", "bewijs_vereist": true },
        { "volgorde": 2, "label": "Stuurgroep + werkgroepen samengesteld", "bewijs_vereist": false },
        { "volgorde": 3, "label": "Externe adviseurs aangesteld en contracten getekend", "bewijs_vereist": true },
        { "volgorde": 4, "label": "Communicatieplan voor sociale partners en deelnemers", "bewijs_vereist": true }
      ],
      "requirements": [
        { "requirement_type": "field", "label": "Besluitvraag ingevuld", "veld_pad": "decision.besluitvraag", "verplicht": true, "blokkerend": true },
        { "requirement_type": "field", "label": "Classificatie ingevuld", "veld_pad": "decision.complexiteit+risiconiveau", "verplicht": true, "blokkerend": true },
        { "requirement_type": "document", "label": "Projectplan", "documenttype": "projectplan", "verplicht": true, "blokkerend": true }
      ]
    },
    {
      "volgorde": 3, "fase_type": "consultatie",
      "naam": "Evenwichtigheidstoets",
      "beschrijving": "Wettelijk verplichte, onafhankelijk uitgevoerde/gevalideerde toets.",
      "vereist_besluit": false, "geschatte_dagen": 45,
      "checklist": [
        { "volgorde": 1, "label": "Evenwichtigheidstoets afgerond door externe partij", "bewijs_vereist": true },
        { "volgorde": 2, "label": "Verantwoordingsorgaan geconsulteerd", "bewijs_vereist": true },
        { "volgorde": 3, "label": "Reactie VO verwerkt of beargumenteerd weersproken", "bewijs_vereist": true }
      ],
      "requirements": [
        { "requirement_type": "document", "label": "Evenwichtigheidstoets (extern)", "documenttype": "evenwichtigheidstoets", "verplicht": true, "blokkerend": true },
        { "requirement_type": "consultation", "label": "Verantwoordingsorgaan geconsulteerd", "verplicht": true, "blokkerend": true }
      ]
    },
    {
      "volgorde": 4, "fase_type": "besluitvorming",
      "naam": "Voorgenomen besluit en hoorrecht",
      "beschrijving": "Voorgenomen invaarbesluit; VO, gewezen deelnemers en gepensioneerden krijgen hoorrecht.",
      "vereist_besluit": true, "geschatte_dagen": 60,
      "checklist": [
        { "volgorde": 1, "label": "Voorgenomen besluit geformaliseerd in dossier", "bewijs_vereist": true },
        { "volgorde": 2, "label": "Hoorzittingen of schriftelijke consultatie gepland", "bewijs_vereist": true },
        { "volgorde": 3, "label": "Reacties verzameld en gewogen", "bewijs_vereist": true }
      ],
      "requirements": [
        { "requirement_type": "consultation", "label": "Hoorrecht uitgevoerd", "verplicht": true, "blokkerend": true },
        { "requirement_type": "approval", "label": "Voorgenomen besluit vastgelegd", "verplicht": true, "blokkerend": true }
      ]
    },
    {
      "volgorde": 6, "fase_type": "externe_indiening",
      "naam": "DNB-melding en goedkeuring",
      "beschrijving": "Indiening volledig dossier bij DNB; DNB toetst en geeft formele goedkeuring.",
      "vereist_besluit": false, "geschatte_dagen": 120,
      "checklist": [
        { "volgorde": 1, "label": "DNB-dossier compleet en ingediend", "bewijs_vereist": true },
        { "volgorde": 2, "label": "Eventuele DNB-vragen beantwoord", "bewijs_vereist": false },
        { "volgorde": 3, "label": "Goedkeuringsbrief DNB ontvangen", "bewijs_vereist": true }
      ],
      "requirements": [
        { "requirement_type": "external_submission", "label": "DNB-melding ingediend", "verplicht": true, "blokkerend": true, "bevestiging_vereist": true },
        { "requirement_type": "external_submission", "label": "DNB-goedkeuring ontvangen", "verplicht": true, "blokkerend": true, "bevestiging_vereist": true }
      ]
    }
    // stappen 2, 5, 7 analoog — volledig uit te schrijven in fase B1
  ]
}
```

---

## 9. Validatie en tests

Omdat definities van code naar data verschuiven, verdwijnt een deel van de compile-time-zekerheid die `tsc` nu biedt. Die zekerheid herstellen we expliciet, anders verschuiven fouten van ontwikkeltijd naar runtime.

- **Schema-validatie**: een **Zod-schema** (of JSON Schema) voor `ProcedureDefinitie`, gedraaid (a) in CI op alle JSON-definities in de repo, en (b) door de seed-importer vóór een insert. `procedure_templates.schema_versie` legt vast tegen welke contractversie een definitie is gevalideerd.
- **Starttest**: voor elke definitie — kan er een procedure mee gestart worden (snapshot lukt, geen ontbrekende verwijzingen)?
- **Snapshot-test**: stappen + checklist-items komen correct in `procedure_stappen`/`procedure_checklist` terecht.
- **Conditionele-activatie-test**: per relevante classificatie-combinatie activeren de juiste `triggert_bij`-requirements (en níet de andere). Bv. `risiconiveau=hoog` activeert de liquiditeitsanalyse; `middel` niet.
- **Versie-stabiliteitstest**: een lopende procedure verandert niet wanneer een nieuwe templateversie actief wordt (snapshot-integriteit).
- **Readiness-test**: de zes readiness-niveaus blijven per status correct evalueren tegen versie-gefilterde requirements (regressietest op `fn_decision_readiness_check`).

Bij invoering van `external_submission`/`consultation` (OB-1) hoort een test die bewijst dat ze daadwerkelijk meetellen in zowel de readiness-check als de evidence-lijst — niet alleen in data bestaan.

---

## 10. Migratiepad

Incrementeel en backwards-compatible. **Bewust herordend**: eerst drie concrete procedures uitschrijven, dán pas beslissen over een bouwblokkenlaag (§11) en de overige vijf — zodat we de abstractie baseren op echte duplicatie en niet op intuïtie.

| Fase | Inhoud | Resultaat |
|---|---|---|
| **A** (dit document) | Canoniek formaat + registry + UX-laag + migratiepad ter akkoord | Beslissing op richting en formaat |
| **B1** | Drie representatieve procedures volledig als canonieke JSON: Beleggingsbeleid (sluit aan op bestaande implementatie), Incident-meldplicht DNB (tijdkritisch + external_submission), Wtp-invaarbesluit (complex + consultatie + zwaar auditspoor) | Drie gevalideerde definities; reële duplicatie zichtbaar |
| **B2** | **Beslismoment bouwblokkenlaag** — duplicatie meten tegen de criteria in §11; go/no-go vastleggen | Bewuste keuze: wel/niet abstractielaag |
| **B3** | Overige vijf pensioenprocedures uitwerken (in de gekozen vorm) | Acht definities compleet |
| **C** | Registry-tabellen (migratie) + idempotente seed-importer (JSON → tabellen) + Zod-validatie (§9) | Definities in de DB; nog niet in gebruik |
| **D** | `vindTemplateVersie()` + engine leest registry met code-fallback; nieuwe starts data-driven | Nieuwe procedures draaien data-driven |
| **E** | `procedure_requirements.template_versie` + readiness tegen versie-gefilterde requirements | Versionering sluitend |
| **F** | Intakewizard + progressive disclosure (§6) op het werkende model | De eindgebruikers-payoff |
| **G** (later, buiten scope) | In-app template-editor; bouwblokkenlaag indien §11 = go | Procedures bouwen zonder developer |

De intakewizard (fase F) is de zichtbare gebruikerswaarde en kan vroeg als klikbaar HTML-prototype worden gevalideerd (conform het bestaande "eerst prototype"-patroon), parallel aan C–E.

---

## 11. Uitgestelde ontwerpbeslissing: de bouwblokkenlaag

Een bovenliggende abstractielaag — herbruikbare bouwblokken die via procedureprofielen worden gecomponeerd — is aantrekkelijk en mogelijk het juiste eindbeeld. We bouwen hem **nu bewust niet**, om twee redenen: het hergebruik dat hij belooft bestaat grotendeels al op requirement-niveau (`requirement_type` + `triggert_bij_*`, zie §2), en een compositie-engine vóór de concrete procedures is geschreven, is premature abstraction met risico op een tweede configuratiemodel dat het beheer juist compliceert.

**Herbeoordelingsmoment**: aan het einde van **fase B1** (na het volledig uitschrijven van de drie representatieve procedures), vastgelegd als fase **B2**. Op dat moment is de werkelijke duplicatie meetbaar.

**Go/no-go-criteria** — we bouwen de bouwblokkenlaag alléén als de eerste drie criteria aantoonbaar gelden:

1. **Aantoonbare duplicatie**: minstens vier kandidaat-blokken (bv. *formeel besluit*, *DNB-indiening*, *evenwichtigheidstoets*, *risicoanalyse*) komen structureel (vrijwel) identiek terug in **≥ 3 van de 8** procedures.
2. **Onderhoudspijn**: een typische wijziging aan zo'n blok (bv. een extra checklist-item bij DNB-indiening) zou anders op **≥ 3 plaatsen** apart moeten worden doorgevoerd.
3. **Stabiele blokgrens**: het herhaalde blok heeft een zelfstandige grens (stappen + checklist + requirements) die in **niet meer dan ~20%** van de toepassingen een per-procedure-override nodig heeft. Vragen de meeste toepassingen toch om overrides, dan loont compositie niet.
4. **Beheervriendelijkheid (randvoorwaarde, geen optie)**: een procedure samenstellen uit blokken moet *eenvoudiger* te schrijven en te begrijpen zijn dan uitschrijven. Heeft compositie een aparte regels-/conditietaal nodig om bruikbaar te zijn, dan is dat juist een signaal om het **niet** te bouwen.

**Wat we sowieso niet doen** (ongeacht de uitkomst): `applicability_rules` en `override_policy` als generieke rules-engine introduceren. Dat vraagt een eigen, zware rechtvaardiging die verder gaat dan duplicatie alleen, en staat haaks op de eis van beheervriendelijkheid.

**Bij no-go**: we blijven procedures als canonieke JSON-definities schrijven. Dankzij hergebruik op requirement-niveau (de tien/twaalf types + classificatie-conditionals) is dat al voldoende DRY voor acht procedures. De `fase_type`-tag (§3.1) houdt de deur open om later alsnog blokken te extraheren zonder herontwerp.

---

## 12. Tradeoffs en open beslissingen

**Tradeoffs**

- **Verlies van git-review en type-safety op definities.** *Mitigatie*: canonieke JSON-definities in de repo (`definities/pensioenfondsen/*.json`) als bron van waarheid, DB als afgeleide via de importer; plus Zod-validatie in CI (§9).
- **Snapshot-integriteit.** Fase D verandert alléén de bron van de snapshot (registry i.p.v. code), niet het mechanisme.
- **Enum-uitbreiding raakt de readiness-functie.** Nieuwe `requirement_type`-waarden vragen een tak in `fn_decision_readiness_check` én `buildEvidenceLijst`; meebouwen in fase E met de test uit §9.

**Open beslissingen**

1. **OB-1 — Nieuwe requirement-types?** Voorstel: voeg `external_submission` en `consultation` toe, mét readiness-/evidence-ondersteuning. Alternatief: modelleren met `approval`/`field` + metadata.
2. **OB-2 — Gedeelde bibliotheek of per-fonds?** Voorstel: gedeelde definities (`fonds_id = null`); kolom alvast aanwezig voor latere fonds-varianten.
3. **OB-3 — Canonieke bron: JSON-in-repo of DB?** Voorstel: JSON-in-repo als bron, DB als afgeleide; bij invoering van de editor (fase G) verschuift de bron naar de DB met export-naar-repo als backup.
4. **OB-4 — Reconciliatie bestaande template.** De geïmplementeerde `beleidswijziging_beleggingsbeleid` (6 stappen) is leidend en wordt `versie 1.0.0` in de registry; de docx-versie geldt als bron voor de overige zeven.
5. **OB-5 — Bouwblokkenlaag.** Uitgesteld; herbeoordeling op fase B2 met de criteria in §11.

---

## 13. Wat dit document niet is

- Geen implementatieplan op regelniveau — dat komt per fase (B t/m G).
- Geen in-app editor-ontwerp (fase G, eigen document).
- Geen verzekeraars/woningcorporaties — die 16 procedures volgen zodra het formaat op pensioen is bewezen (sluit aan op de multi-sector-strategie in `HANDOVER.md`).
- Geen formele bouwblok-compositie-engine — bewust uitgestelde beslissing (§11).
- Geen wijziging aan het Decision Object, statusmodel of de readiness-niveaus — die blijven exact zoals in `PROCEDURE-MVP1-ONTWERP.md`.

---

*Volgende stap zodra dit ontwerp akkoord is: fase B1 — de drie representatieve procedures (Beleggingsbeleid, Incident-meldplicht DNB, Wtp-invaarbesluit) volledig uitwerken als canonieke JSON en valideren tegen `Procedures-per-sector.docx`, gevolgd door het beslismoment over de bouwblokkenlaag (B2).*
