# Impactanalyse: simplificatie van de documentmetadata

| | |
|---|---|
| **Status** | v0.2 — concept ter bespreking (plansessie Cowork); `context` als kandidaat toegevoegd |
| **Doel** | Het metadatamodel op `documenten` vereenvoudigen zonder de RAG-correctheid, governance en auditbaarheid te breken. |
| **Anker** | Bouwt voort op de statusprofiel-werkopdracht (rapportage) en het eerdere gesprek over onderbouwing/analyse in de RAG. |
| **Geen juridisch/architectuurbesluit** | Dit document bereidt voor; de keuzes (met name spoor B) horen bij een expliciet besluit met de betrokken eigenaren. |

---

## 1. Aanleiding

De metadata op `documenten` is over meerdere increments (C, C+/B13, E/G, P1, T6, 0136, 0140) organisch gegroeid en telt inmiddels ~25 velden. Het gevoel is dat dit te complex is geworden voor wie een document aanlevert. Deze analyse scheidt **essentiële** complexiteit (stuurt aantoonbaar gedrag) van **accidentele** complexiteit (overhead), en stelt een gefaseerde, risico-gewogen simplificatie voor.

## 2. Scope-afbakening — wat reken ik tot "de metadata"

Wél: de classificatie-, status- en beschrijvende velden die een mens (bestuurder/curator) invult of die de RAG/governance leest. **Niet:** puur technische/pipeline-velden (`verwerkingsstatus`, `scan_resultaat`, `bestand_hash`, `mime_gedetecteerd`, `ocr_*`, `bestandstype`, `opslag_pad`, `geindexeerd`, `paginas`) — dat is machinerie, geen invullast, en blijft buiten deze simplificatie.

## 3. Huidige staat — inventaris (bron: `supabase/schema.sql` `documenten`)

| Groep | Velden | Verplicht? | Leest de RAG dit? |
|---|---|---|---|
| **Identiteit/herkomst** | `bibliotheek`, `bron`, `titel` | ja | `bibliotheek` (weging) |
| **Ophangpunt** | `context` (enum), `procesinstantie_id`, `vergadering_id`, `agendapunt_id` | `context` default 'algemeen' | `context`: **nee** (geverifieerd); de FK-koppelingen: alleen optionele scoping (document-scope, agendapunt-modus) |
| **Classificatie (vrij/enum)** | `documenttype`, `toepassingsgebied`, `doelgroep`, `thema`, `statusinterpretatie`, `regelingstype` | nee (nullable) | **alleen `documenttype`** (en straks meer); de rest: **nee** (geverifieerd) |
| **Status/actualiteit (3 lagen)** | `actief`, `status` (8 waarden), `bronstatus` (4), `documentdatum`, `geldig_vanaf`, `geldig_tot`, `vervangt_/vervangen_door_document_id` | nee | ja — de actueel-poort, peildatum, vervangingsketen |
| **Bronsoort-beschrijvend (alleen generiek)** | `normgewicht`, `bronorganisatie`, `extern_url`, `eigenaar`, `volgende_review`, `versie` | nee | `normgewicht` (weging), `volgende_review` (review-verlopen, generiek) |
| **Review/governance** | `metadata_te_controleren`, `metadata_review_status`, `metadata_gecontroleerd_door/-op` | nee | nee (workflow, geen retrieval) |

**Feit (geverifieerd via grep op `core/lib` + `rag.ts`):** `toepassingsgebied`, `doelgroep`, `thema`, `statusinterpretatie` en `regelingstype` worden **nergens in de retrievalkern gelezen** — geen filter, geen weging, geen scoping. Ze zijn voor de assistent inert. (`thema` komt wel in ~16 bestanden voor; te verifiëren of dat UI/klantbeeld/stuurinfo is vóór verwijderen.)

## 4. Analyse — essentieel vs. accidenteel

### 4.1 Essentieel (load-bearing — niet aankomen)

- **`actief`** — harde uitsluiting, onvoorwaardelijk in de zoek-RPC (`where d.actief = true`). Security/tenant-relevant.
- **`status ∈ {vastgesteld, van_kracht}`** — de actueel-poort (`ACTUELE_BRON_STATUSSEN`); tevens het onderscheid dat de besluitvorming-modus en de "niet-vastgestelde stukken"-signalering (0091) nodig hebben.
- **Geldigheid** (`geldig_vanaf/tot` + peildatum) — de enige automatische actualiteitsfilter.
- **Vervangingsketen** (`vervangt_/vervangen_door`) — versie-actualiteit.
- **`normgewicht`** (generiek) — weging + zwak-generiek-uitsluiting.
- **`bibliotheek`** — de enige weging-as (fonds/generiek).

Deze zes dragen de RAG-correctheid en de governance. Vereenvoudiging mag ze **niet platslaan**; hooguit *automatiseren/afleiden* zodat de gebruiker ze minder handmatig hoeft te zetten.

### 4.2 Accidenteel (kandidaat voor simplificatie)

- **De vijf vrije-tekst-/enumvelden** `toepassingsgebied`, `doelgroep`, `thema`, `statusinterpretatie`, `regelingstype` — niet gelezen door de RAG, niet genormaliseerd, geen filter. Sterkste kandidaat om uit de invoer te halen of te schrappen.
- **De dubbele status-as** — `status` (levenscyclus) en `bronstatus` (RAG-zichtbaarheid) overlappen in de beleving ("is dit nog actueel?"). `NULL ≡ actief` betekent dat vrijwel niemand `bronstatus` ooit zet; het is de facto al een zeldzame expert-override. Kandidaat om te **verbergen** (spoor A) of, mits de data het toelaat, te **versmelten** (spoor B).
- **De `context`-enum** (`dossier`/`vergadering`/`algemeen`) — **niet gelezen door de RAG** (geverifieerd); enige functie is de integriteitsregel `valideerContext` (dossier→procesinstantie, vergadering→vergadering). Bovendien al **incoherent bijgehouden**: de uploadroute zet `context` niet, dus een vergaderstuk met `vergadering_id` houdt `context='algemeen'`. Het label is één-op-één afleidbaar uit de aanwezigheid van de FK's. **Let op:** alleen het *label* is redundant — de koppelingen `procesinstantie_id`/`vergadering_id`/`agendapunt_id` zelf zijn load-bearing (procedure-readiness, agenda, optionele scoping) en blijven.
- **De metadata-review-workflow** (`metadata_te_controleren` + `metadata_review_status` + gecontroleerd_door/op) — governance-overhead; te toetsen of de review-queue in de MVP daadwerkelijk waarde levert of alleen ruis.

### 4.3 Te verifiëren vóór een onomkeerbare keuze

- Populatiegraad van elk kandidaatveld per fonds (hoeveel niet-NULL?).
- Bestaan er documenten waar `bronstatus` afwijkt van wat `status` impliceert (bv. `status=van_kracht` maar `bronstatus=historisch/uitgesloten`)? Zo **nee**, dan is de onafhankelijke `bronstatus`-as in de praktijk ongebruikt en wordt versmelten (spoor B) verdedigbaar. Zo **ja**, dan encodeert de as een echte behoefte en moet hij blijven.
- Breder gebruik van `thema`/`regelingstype` buiten de RAG (klantbeeld, stuurinfo, UI-facetten).

## 5. Simplificatie-opties

### Spoor A — conservatief: oppervlak verkleinen, model intact (aanbevolen als eerste)

Geen datamigratie, volledig reversibel:

1. **Statusprofiel per documenttype** (al ontworpen): per type alleen de zinvolle statussen tonen (rapportage → `concept`/`vastgesteld`; normatief → volledige cyclus). Verkleint de gevoelde status-taxonomie het meest.
2. **`bronstatus` als verborgen expert-override:** uit het standaard-invoer/UI halen; alleen zichtbaar achter een "geavanceerd"-actie voor wie de capability heeft. Gedrag ongewijzigd (`NULL ≡ actief`).
3. **Inerte vrije-tekstvelden uit de invoer halen:** `toepassingsgebied`, `doelgroep`, `statusinterpretatie` (en `regelingstype`/`thema` na de gebruikscheck) niet meer tonen bij aanleveren; kolommen blijven (nog) staan.
4. **Afleiden i.p.v. vragen:** `documentdatum` defaulten op de uploaddatum (editeerbaar); **`context` volledig berekenen uit de FK-koppelingen** (procesinstantie → dossier, vergadering → vergadering, anders algemeen) i.p.v. als losse keuze op te slaan — dat neemt meteen de huidige incoherentie weg. Minder handmatige velden.

Netto: fors minder verplichte/zichtbare beslissingen bij aanlevering, met **nul** RAG-/governance-risico.

### Spoor B — structureel: kolommen schrappen/samenvoegen (na verificatie)

Hoger risico, deels onomkeerbaar:

1. **Inerte kolommen daadwerkelijk droppen** (na populatie- + gebruikscheck): migratie + as-built-actualisatie.
1b. **`context`-kolom + de twee CHECK-constraints droppen:** de integriteitsregel verschuift naar "de FK ís de context" (per definitie consistent). Verifieer eerst de join-tabel `document_procesinstanties` (many-to-many) en of iets buiten `valideerContext` de enum leest. Middelgrote ingreep: migratie + `document-metadata.ts`/`valideerContext` opschonen + sanity's.
2. **Status-assen versmelten** — alléén als 4.3 uitwijst dat `bronstatus` onafhankelijk vrijwel niet wordt gebruikt: `bronstatus` afschaffen en de RAG-zichtbaarheid volledig uit `status` + geldigheid afleiden. **Grote blast radius:** transitietabel, DB-trigger-spiegel, `rag.ts`-gates, sanity-tests, datamigratie. Niet lichtvaardig.
3. **Review-workflow versoberen** als hij weinig gebruikt blijkt.

## 6. Aanbeveling

**Spoor A eerst, gefaseerd; spoor B alleen na de verificatiequery (§8).** Spoor A levert het grootste deel van de gevoelde simplificatie tegen minimaal risico en is terug te draaien. Spoor B is pas verantwoord als data bevestigt dat een veld/as werkelijk dood is — anders ruil je gevoelde eenvoud in voor stille correctheids- of auditverliezen. Dit beschermt bewust tegen de neiging om meteen structureel te snijden.

## 7. Concrete invulling spoor A (requirements + H/D/M)

- **R1 (D):** statusprofiel per documenttype dwingt de toegestane statussen af (server-side), UI toont alleen die. *AC:* rapportage biedt geen `van_kracht`; normatief wel.
- **R2 (D):** `bronstatus` verdwijnt uit de standaard-invoer; alleen achter capability + "geavanceerd". *AC:* een bestuurder zonder de capability ziet de as niet; gedrag (`NULL ≡ actief`) ongewijzigd; sanity groen.
- **R3 (D/UI):** de inerte classificatievelden zijn niet meer zichtbaar bij aanleveren. *AC:* upload-/metadataformulier toont ze niet; bestaande waarden blijven leesbaar tot een eventuele spoor-B-drop.
- **R4 (D):** `documentdatum` defaultt op uploaddatum (editeerbaar); `context` afgeleid uit de ingang. *AC:* een rapportage-upload vult `documentdatum` zonder handmatige invoer; te overschrijven.
- **R5 (D):** `context` wordt niet meer als losse invoer gevraagd/opgeslagen maar afgeleid uit de FK-koppelingen. *AC:* een vergaderstuk met `vergadering_id` levert afgeleid `context='vergadering'`; `valideerContext` blijft de integriteit borgen; sanity groen.
- **Kernregel:** geen compliance-relevante guardrail verhuist naar uitsluitend klasse M; alle bovenstaande zijn D (deterministisch, server-side, getest).

## 8. Verificatie vooraf (draai dit vóór spoor B)

```sql
-- Populatiegraad per kandidaatveld (per fonds), en de kritieke as-onafhankelijkheid.
select
  count(*)                                                        as documenten,
  count(*) filter (where toepassingsgebied is not null)           as heeft_toepassingsgebied,
  count(*) filter (where doelgroep is not null)                   as heeft_doelgroep,
  count(*) filter (where thema is not null)                       as heeft_thema,
  count(*) filter (where statusinterpretatie is not null)         as heeft_statusinterpretatie,
  count(*) filter (where regelingstype is not null)               as heeft_regelingstype,
  count(*) filter (where bronstatus is not null)                  as bronstatus_expliciet_gezet,
  -- De beslissende: bestaat er een document waar bronstatus afwijkt van wat status impliceert?
  count(*) filter (
    where status in ('vastgesteld','van_kracht')
      and bronstatus in ('historisch','uitgesloten')
  )                                                               as as_onafhankelijk_in_gebruik,
  -- Context-coherentie: staat het label gelijk aan wat de FK's impliceren?
  count(*) filter (where context = 'algemeen'
                     and (procesinstantie_id is not null or vergadering_id is not null))
                                                                  as context_incoherent
from public.documenten
group by fonds_id;
```

Interpretatie: is `as_onafhankelijk_in_gebruik = 0` over alle fondsen, dan is de `bronstatus`-as in de praktijk ongebruikt en wordt versmelten (spoor B, punt 2) verdedigbaar. Is hij > 0, dan blijft de as. Lage `heeft_*`-tellingen bevestigen dat de vrije-tekstvelden veilig te droppen zijn.

## 9. Risico's & blinde vlekken

- **Over-simplificatie:** een veld dat de RAG niet leest, kan tóch elders (UI-facet, klantbeeld, export) worden gebruikt — vandaar de gebruikscheck vóór droppen (`thema`/`regelingstype`).
- **Verlies van governance-signaal:** de review-workflow versoberen kan de aantoonbaarheid raken; toets tegen de `audit-evidence-reviewer`.
- **Afleiden ≠ negeren:** `documentdatum` defaulten mag de bestuurder niet verleiden een verkeerde datum te laten staan bij een rapportage (periodekritisch) — houd het veld zichtbaar en editeerbaar, niet stil.
- **Reversibiliteit:** spoor A is terug te draaien, spoor B (drop/versmelt) niet zonder herstelmigratie. Eén richting op met bewijs.

## 10. Openstaande keuzes

1. Akkoord op **spoor A als eerste stap** (reversibel, geen migratie)?
2. Draaien we de **verificatiequery** (§8) om spoor B te onderbouwen?
3. Reikwijdte: nemen we de **review-workflow** mee in de simplificatie of laten we die buiten scope?
4. Eigenaar per besluit (AI Governance Owner / Technical & Security Owner) conform het AI-governance-ontwerp.
