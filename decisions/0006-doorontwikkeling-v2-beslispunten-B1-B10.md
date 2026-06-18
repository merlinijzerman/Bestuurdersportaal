# 0006 — Doorontwikkeling v2: beslispunten B1–B10 (blokkerend voor de bouw)

- **Status:** Geaccepteerd — B1–B10 geaccepteerd; O1 en O2 besloten; capability-opslag besloten (zie onder). Geen openstaande beslissingen meer die de bouw blokkeren.
- **Datum:** 2026-06-18 (laatst bijgewerkt 18-06-2026, ronde v1.2)
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

### Eerder open, nu besloten (geen B-nummer)

- **O1 — Multi-fonds in v2**: **BESLOTEN (18-06-2026) — multi-fonds.** v2 wordt vanaf de start fonds-specifiek opgezet voor meerdere fondsen. Gevolg: catalogi (`procesmodellen`, `gremia`, `expertises`, `kritische_focusgebieden`) krijgen een globale standaardset (`fonds_id` NULL) die per fonds kan worden gekopieerd/aangepast; alle nieuwe tabellen dragen `fonds_id` en vallen onder de bestaande RLS-tenantisolatie. Increment A bouwt hierop. Gate voor A daarmee vervuld voor het multi-fonds-deel.
- **O2 — Decision Object → dossierstatus-mapping**: **BESLOTEN (18-06-2026).** Mapping 17→8 vastgelegd (zie TO v1.1 §3.2). Prioriteitsregel: de dossierstatus volgt het **primaire** Decision Object (`is_primary_decision`); zonder Decision Object geldt een handmatige dossierstatus. Subkeuzes: (a) `in_evaluatie` → dossierstatus `in_implementatie` (evaluatie vraagt nog open governance-aandacht); (b) `vw_dossier_status` wordt **bestendig gebouwd voor 1-op-n** via `is_primary_decision`, maar functioneel houdt v2 **1 Decision Object per dossier** (huidige praktijk, conform migratie-notitie "1-op-1 voor MVP"); (c) zij-toestanden `teruggezet`/`geescaleerd`/`aangehouden` worden getoond als **zichtbaar sublabel voor alle bestuurders** (consistent met het principe dat informatie niet wordt weggefilterd). Gate voor increment B daarmee vervuld.

## Overwogen alternatieven

- **B1-alternatief: scope ook "MVP" noemen** — verworpen: botst met de live MVP-1 en verwart bestuur/uitvoering.
- **B2-alternatief: parallel besluitspoor naast Decision Object** — verworpen: leidt tot een derde besluitconcept en versnippert de governance-keten (besluit → onderbouwing → evaluatie → audit).
- **B3-alternatief: templates in code houden** — verworpen voor v2: fonds-specifieke configuratie zonder deploy is een kerneis; wel gefaseerd uitfaseren met seed + verificatie.
- **B5-alternatief: volledig autonome auto-koppeling** — verworpen: AI-koppeling met bestuurlijke impact zonder terugdraai is in strijd met "AI adviseert, mens besluit".
- **B7-alternatief: boolean `actief` uitbreiden** — verworpen: één veld met meerdere betekenissen; gescheiden lagen (technische beschikbaarheid / documentstatus / bronstatus) zijn auditbaarder.

## Gevolgen

- **Datamodel/migraties**: catalogus- en organentabellen, join-tabellen (i.p.v. `uuid[]`), documentstatus/bronstatus-velden, `vw_dossier_status`, capability-model. Alle additief met ROLLBACK + backfill + verificatiequery.
- **RLS/audit**: nieuwe tabellen onder bestaande `fonds_id`-isolatie; metadata- en koppelingswijzigingen append-only gelogd; capability-checks server-side leidend.
- **Bewust geaccepteerde schuld**: overgangsperiode waarin vrije-tekst-eigenaars naast FK's bestaan (B9); NULL-bronstatus tijdens migratie wordt als "actief" behandeld om retrieval niet te breken (tijdelijk, met review-queue).
- **Proces**: alle beslissingen (B1–B11, O1, O2) zijn geaccepteerd/besloten; er zijn geen besluit-gates meer open. De resterende gates per increment zijn **uitvoerings-deliverables** (geen besluiten): C = status/bronstatus-transitietabel opgeleverd; D = notuleninrichting; F/G = compliance-checkpoint (DPIA/AI-governance) + retrieval-regressietests groen. Zie roadmap v1.2 §3 en de "remaining build blockers".

## Referenties

- `03 Functioneel ontwerp/Bestuurdersportaal - Doorontwikkeling v2 functioneel ontwerp v1.1.md`
- `03 Functioneel ontwerp/Bestuurdersportaal - Doorontwikkeling v2 kritische review en gap-analyse v1.1.md`
- `04 Technische inrichting/Bestuurdersportaal - Doorontwikkeling v2 technisch ontwerp v1.1.md`
- `06 Roadmap/Bestuurdersportaal - Doorontwikkeling v2 roadmap v1.1.md`
- `decisions/0002` (generieke proceduremodule als data) — B3 bouwt hierop voort.
- `decisions/0001` (append-only audit) — kader voor metadata-/koppelingslogging.
