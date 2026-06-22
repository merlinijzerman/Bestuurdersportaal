# 0017 — Increment F: persoonlijk bestuurdersprofiel (keuzes en scope-afbakening)

- **Status:** Geaccepteerd
- **Datum:** 2026-06-22
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder, compliance-akkoord), Claude Code (uitvoering)

## Context

De werkopdracht Increment F (FO v1.3 §14, Module 12) introduceert een persoonlijk
bestuurdersprofiel (bestuurlijke rol, expertise, gremia, kritische focusgebieden,
antwoordvoorkeuren) dat de AI-voorbereiding **prioriteert** zonder de gedeelde
feitenbasis te filteren of te verbergen. Tijdens de plansessie zijn twee scope-keuzes
gemaakt die afwijken van de letterlijke werkopdracht; die legt dit besluit vast.
De feature valt onder de B10-poort: profilering vereist een geactualiseerde DPIA +
AI-governance-checkpoint vóór go-live (build/merge mag, deploy wacht).

## Besluit

1. **Profielen zijn strikt zelfbeheerd (override op werkopdracht-scope-item 3).**
   Alleen de persoon zelf wijzigt het eigen profiel. Er is bewust **geen
   `profile.manage.all`** — een beheerder of voorzitter kan andermans profiel niet
   muteren (privacy/dataminimalisatie). De capability `profile.manage.own` is aan alle
   drie de rollen toegekend; RLS dwingt de eigen rij af op `id=auth.uid()` (profielen)
   resp. `profiel_id=auth.uid()` (join-tabellen). Geen service-role.

2. **B9 (eigenaars vrije tekst → FK) is volledig uit Increment F gehaald.** Bij
   verificatie bleken de relevante eigenaar-FK's (`risicos.eigenaar_id`,
   `decision_dissent.bestuurder_id`, `procedure_eigenaars.gebruiker_id`) al te bestaan.
   Een mapping-tabel/backfill is niet nodig en zou F nodeloos vergroten; bestaande
   FK-kolommen blijven ongemoeid.

3. **Profielsturing = prioritering, geen filtering.** De profielregel landt uitsluitend
   in het **dynamische (ongecachte) contextblok** van `app/api/chat/route.ts`
   (`bouwDynamischeContext`) — nooit in de gecachte toon-systeemprompt en nooit in de
   retrieval-filters. Retrieval blijft byte-voor-byte gelijk; alleen volgorde/nadruk
   van het antwoord verschilt (gedragsneutraliteit, acceptatiecriterium 9). De AI maakt
   in het antwoord expliciet dat de ordening op het profiel is afgestemd.

4. **"Algemeen perspectief"-toggle.** Eén body-vlag (`algemeen_perspectief`) schakelt de
   profielsturing uit: dezelfde bronnen, collectieve weergave. `standaard_ai_modus`
   voorselecteert bij een schone start de AI-antwoordmodus (A4).

## Overwogen alternatieven

- **Beheerder/voorzitter mag profielen beheren (`profile.manage.all`)** — verworpen op
  expliciet verzoek opdrachtgever; vereiste een rol-clausule in RLS of service-role en
  botst met dataminimalisatie. Een sanity-test borgt dat deze capability nergens
  toegekend wordt.
- **B9 meenemen in F** — verworpen: bestaande FK's dekken de behoefte; mapping/backfill
  is onnodige complexiteit.
- **Profiel in de retrieval verwerken (filteren op focusgebieden)** — verworpen:
  schendt de eis "niet filteren/verbergen" en gedragsneutraliteit.

## Gevolgen

- **RLS/autorisatie:** join-tabellen `for all using/with check (profiel_id=auth.uid())`;
  composite-FK (`fonds_id NOT NULL`) borgt tenant-/fondsconsistentie (besluit 0007).
  `profile.manage.own` server-side afgedwongen in `app/api/profiel/route.ts`.
- **Audit:** elke profielmutatie landt append-only in `profiel_log` (alleen metadata).
  Elke profielgestuurde AI-vraag logt `profielsturing` (`actief`/`uitgeschakeld`/
  `geen-profiel`) + `profielsturing_aspecten` in `governance_log.retrieval_meta`.
- **Datamodel/migraties:** `2026_06_22_profiel.sql` (+ROLLBACK): 5 profielvelden,
  3 join-tabellen, `profiel_log`. Migratie-eerst-dan-deploy.
- **Tests:** `lib/capabilities.sanity.ts` borgt `profile.manage.own` op alle rollen én
  de afwezigheid van `profile.manage.all`.
- **B10-poort:** go-live geblokkeerd tot DPIA + AI-governance-checkpoint geactualiseerd.

## Referenties

- FO v1.3 §14 (Module 12), TO v1.2 §2.7.
- [`supabase/migrations/2026_06_22_profiel.sql`](../supabase/migrations/2026_06_22_profiel.sql),
  [`app/api/profiel/route.ts`](../app/api/profiel/route.ts),
  [`app/api/chat/route.ts`](../app/api/chat/route.ts),
  [`lib/capabilities.ts`](../lib/capabilities.ts).
- Besluiten `0006` (B9/B10/B11), `0007` (composite-FK), `0009` (capability-set).
