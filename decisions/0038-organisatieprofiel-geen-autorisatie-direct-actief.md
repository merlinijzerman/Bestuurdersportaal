# 0038 — Organisatieprofiel: geen autorisatie/vaststelling/gating, direct actief

- **Status:** Geaccepteerd — besluitpunt 1 (schrijven alleen via service-role) deels herzien door [0039](0039-organisatieprofiel-tenant-zelfservice-beheerder.md)
- **Datum:** 2026-07-06
- **Betrokkenen:** Merlin (akkoord), Claude (uitvoering)

## Context

Het FO Organisatieprofiel v0.4 introduceert een generiek, bestuurlijk-licht
contextprofiel per organisatie dat AI-duiding grondt met organisatiespecifieke
feiten en strategie, zodat de assistent geen sectoraannames doet (FR-1). OP-1 is
het eerste, standalone-veilige bouwticket: alleen het datamodel (tabel
`organisatie_profielen`), nog zonder code die de tabel gebruikt (die volgt in
OP-2..OP-5).

Bij het ontwerp speelden twee richtingsvragen die niet 1-op-1 uit een eerder
besluit volgen: (1) hoeveel beheer-/governance-laag heeft een contextprofiel
nodig, en (2) de naamgeving. Randvoorwaarden: tenant-isolatie via het bestaande
RLS-patroon (SELECT eigen fonds), migratie-eerst-dan-deploy, en consistentie met
het generiek-curatie-schrijfpatroon (service-role server-side, geen aparte
schrijfrol).

## Besluit

1. **Bewust geen autorisatie-/vaststellings-/gating-laag.** Er is geen
   `profiel_status`/gating (elk profiel is direct actief), geen schrijfrol of
   goedkeuring, en geen vaststellings-/vier-ogen-/herbevestigingsvelden. Van
   beheer resteert uitsluitend wie/wanneer-audit (`bijgewerkt_door`/`_op`).
   Schrijven loopt server-side via de platform-back-office met de service-role
   (omzeilt RLS) — hetzelfde patroon als generiek-curatie bij documenten. RLS
   staat aan met alleen een SELECT-policy op het eigen fonds; er is bewust géén
   INSERT/UPDATE/DELETE-policy voor `authenticated`.
2. **Generiek hernoemd van "Fondsprofiel" naar "Organisatieprofiel".** De tabel
   heet `organisatie_profielen` en de feitvelden zijn sectorneutraal
   (`organisatietype`, `uitvoerende_partijen`, `omvang`, `kernfeiten`), zodat het
   model niet impliciet een pensioenfonds veronderstelt. De koppeling blijft
   1-op-1 aan `fondsen` (`fonds_id UNIQUE`, `on delete cascade`).

## Overwogen alternatieven

- **Concept/actief-status + vaststelling nu bouwen** — verworpen: disproportioneel
  voor een contextprofiel dat AI-duiding grondt (geen besluitobject). Een latere
  concept/actief-toggle is additief (één kolom + één filter in de OP-2-helper),
  dus uitstel kost niets.
- **Aparte schrijfrol/RLS-write-policy voor bestuurders** — verworpen: schrijven
  loopt via de back-office (service-role); een tenant-schrijfrol zou het
  generiek-curatie-patroon doorbreken en de aanvalsvlakte vergroten.
- **`bijgewerkt_door` als FK naar `auth.users`** — verworpen voor nu: de bewerker
  is niet altijd een portaal-`auth.users`-sessie (back-office/service-role);
  consistent met bestaande wie-als-tekst-velden. Later promoveerbaar naar FK.
- **Naam "Fondsprofiel" behouden** — verworpen: sectorspecifiek; botst met het
  generieke, herbruikbare karakter (B13 tenant-isolatie generiek).

## Gevolgen

- **RLS/tenant-isolatie:** RLS aan. SELECT eigen fonds
  (`fonds_id = (select fonds_id from public.profielen where id = auth.uid())`) —
  exact het huispatroon. Geen write-policy → schrijven alleen via service-role.
  `on delete cascade`: verwijderen van een organisatie ruimt het profiel mee op.
- **Datamodel/migraties:** nieuwe tabel `organisatie_profielen`
  (`2026_07_06_organisatie_profielen.sql`, idempotent, met ROLLBACK). De vier
  strategische velden (`missie`, `visie`, `strategische_speerpunten`,
  `risicohouding`) hebben een CHECK ≤600 tekens. Touch-trigger
  `trg_organisatie_profielen_touch` zet `bijgewerkt_op` bij elke UPDATE.
- **Audit/reproduceerbaarheid:** lichte wie/wanneer-audit (geen `*_log`-tabel in
  scope). Geen AI-/besluitlogica in OP-1 zelf.
- **Gebruikers-/beheerervaring:** beheer via de back-office; voor de bestuurder is
  het profiel read-only context die AI-duiding grondt.
- **Bewust geaccepteerde schuld:** geen status/gating en `bijgewerkt_door` als vrij
  tekstveld; beide additief te promoveren zodra OP-2..OP-5 of multi-tenant dat
  vragen.

## Referenties

- `mvp/supabase/migrations/2026_07_06_organisatie_profielen.sql` (+ ROLLBACK)
- `mvp/supabase/schema.sql` (blok "2b. Organisatieprofiel", documentatie)
- FO Organisatieprofiel v0.4 (§2, §4, §5, §7, §13, FR-1, FR-8)
- `decisions/0022` (generiek-curatie service-role-schrijfpatroon), `0017`
  (persoonlijk profiel strikt zelfbeheerd — contrast), `0006` B13 (tenant-isolatie
  generiek)
