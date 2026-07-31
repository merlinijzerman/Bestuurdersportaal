# 0096 — Restrisico geaccepteerd: default privileges van `supabase_admin` zijn niet te sluiten

- **Status:** Geaccepteerd
- **Datum:** 2026-07-31
- **Betrokkenen:** Merlin (opdrachtgever, besluitnemer), Claude (analyse en uitvoering)

## Context

Bij de integrale review van 30-31 juli 2026 bleek dat de rol `anon` — de rol achter de
**publieke, in de browserbundel meegeleverde** `NEXT_PUBLIC_SUPABASE_ANON_KEY` — op élke tabel
in schema `public` het volledige rechtenpakket hield: `DELETE, INSERT, REFERENCES, SELECT,
TRIGGER, TRUNCATE, UPDATE`. Dat is de Supabase-standaardgrant, niet iets wat dit project bewust
heeft gezet; alleen `rate_limit_events` was uitgezonderd (`2026_06_10_rate_limiting.sql`).

RLS was daarmee de enige barrière. Dat is precies het mechanisme onder bevinding **K-02**: één
wees-policy met `with_check = true` op `document_chunks` werd een volwaardig, ongeauthenticeerd
schrijfpad naar de RAG-corpus, uitsluitend omdat `anon` de INSERT-grant al had. Zonder die grant
was diezelfde kapotte policy een dode letter geweest.

Twee rechten verdienen daarbij aparte aandacht omdat RLS ze niet afdekt:

- **`TRUNCATE`** — Postgres evalueert géén policy bij een TRUNCATE. Wie het recht heeft, leegt de
  tabel ongeacht wat er aan policies op staat. Dat raakt rechtstreeks de append-only
  auditsporen (`platform_event_log`, `governance_log`, `document_inzage`,
  `decision_audit_snapshots` en de overige `*_log`-tabellen). Het uitgangspunt "auditdata mag
  niet manipuleerbaar zijn" is met dat recht niet houdbaar.
- **`TRIGGER` / `REFERENCES`** — het recht om een eigen trigger of foreign key op andermans
  tabel te hangen. Geen enkele applicatiefunctie heeft dit nodig.

Migratie `2026_07_31_r4_grant_hygiene.sql` trok deze rechten in op de **bestaande** objecten.
`2026_07_31_r6_default_privileges.sql` moest voorkomen dat ze terugkomen bij nieuwe objecten.
Daar loopt het vast op het rechtenmodel van gehost Supabase.

**Meting (`pg_default_acl`, schema `public`, 31-07-2026, ná R6):**

| Eigenaar | Type | ACL |
|---|---|---|
| `postgres` | tabellen | `anon=r`, `authenticated=arwdm` |
| `postgres` | functies | *(geen anon-entry meer)* |
| `supabase_admin` | tabellen | `anon=arwdDxtm`, `authenticated=arwdDxtm` |
| `supabase_admin` | functies | `anon=X` |

`ALTER DEFAULT PRIVILEGES` werkt **per eigenaar**. R6 draaide als `postgres` en raakte daarom
alleen de eerste twee regels. De variant `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin …`
vereist lidmaatschap van die rol, en `postgres` is dat op een gehost project niet — R6 vangt die
fout op en meldt hem als `WARNING` in plaats van te crashen.

## Besluit

**Het restrisico wordt geaccepteerd.** Preventie op de `supabase_admin`-kant is niet haalbaar met
de rechten die dit project heeft. In plaats daarvan geldt **detectie** als beheersmaatregel:
gate F (schrijfrechten en `TRUNCATE`/`REFERENCES`/`TRIGGER` bij `anon`/`authenticated`) en gate H
(EXECUTE op functies bij `anon`) in `supabase/checks/2026_07_31_r1_structurele_gates.sql`.

Dit is expliciet een besluit om **achteraf te controleren in plaats van vooraf te blokkeren**, en
het is alleen verdedigbaar zolang die controle daadwerkelijk draait.

## Overwogen alternatieven

- **`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`** — de directe oplossing. Geweigerd door
  de database: vereist lidmaatschap van de eigenaar-rol. Getest in R6 stap 3; de fout wordt
  opgevangen en gemeld.
- **Supabase-support vragen om de default-ACL aan te passen** — niet geprobeerd. Zou de
  afhankelijkheid van een derde partij introduceren voor een instelling die bij een volgende
  platformwijziging weer kan terugkeren, zonder dat wij dat merken. Detectie blijft dan hoe dan
  ook nodig, dus het vervangt de maatregel niet — het zou hem hooguit aanvullen. Kan alsnog,
  maar is geen voorwaarde.
- **Periodiek een sweep draaien die alle grants opnieuw intrekt** (cron/edge function) — lost
  het gat pas ná het ontstaan op, net als detectie, maar doet dat *stilzwijgend*. Dan zie je
  nooit dát er iets is teruggekomen, en verlies je het signaal dat er een platformwijziging is
  geweest. Bewust niet gekozen: liever een luide gate dan een stille reparatie.
- **`SELECT` óók intrekken bij `anon`** — overwogen en niet gedaan in deze ronde. Vergt eerst
  bewijs dat geen enkel publiek pad leest. Gate D toont aan dat RLS `anon` nu al nul rijen
  teruggeeft; de winst is dus kleiner dan die van de schrijfrechten. Blijft op de lijst.

## Gevolgen

**Beheersing.** Het gat is smal maar echt: `supabase_admin` maakt zelden iets in `public` — de
Table Editor en de migraties draaien als `postgres` — maar het gebeurt wél bij extensies die in
`public` installeren en bij platformmigraties van Supabase zelf. Dat zijn precies de momenten
waarop wij geen controle hebben en geen melding krijgen.

**Voorwaarde aan dit besluit.** De gates moeten draaien:

- **Nu, handmatig:** na elke Supabase-platformwijziging en vóór elke release.
- **Vóór onboarding van fonds 2:** in CI (bevinding H-17). Zonder dat is de detectie afhankelijk
  van eraan denken, en bevinding **T-01** uit dezelfde ronde laat zien hoe dat afloopt — een
  testgate die twee weken rood stond terwijl 45 suites niet draaiden, zonder dat iemand het zag.

**Herzien wanneer.** Dit besluit vervalt en moet opnieuw worden gewogen zodra (a) Supabase het
rechtenmodel wijzigt zodat de default-ACL wél aanpasbaar wordt, (b) er een tweede fonds wordt
onboard — dan verschuift de impact van "provider-globale data" naar "tenantdata van een ander
fonds", of (c) gate F of H daadwerkelijk vuurt: dan is het risico gematerialiseerd en is een
incidentanalyse aan de orde, geen herbevestiging.

**Tenant-isolatie.** Geen directe impact vandaag: R4 heeft de bestaande grants ingetrokken en er
is één fonds in productie. De impact ontstaat pas bij een nieuw object van `supabase_admin` in
combinatie met een te ruime policy — dezelfde combinatie als K-02.

**Audit en reproduceerbaarheid.** `TRUNCATE` blijft het scherpste punt: het is het enige recht in
dit dossier waartegen RLS niets uitricht, en het maakt append-only sporen leegbaar. Gate F is
daarmee niet alleen hygiëne maar de bewaking van een governance-belofte.

**Bewust geaccepteerde schuld.** Er is een periode tussen het ontstaan van een object en de
eerstvolgende gate-run waarin het risico onopgemerkt bestaat. Bij handmatige uitvoering is die
periode onbepaald. Dat is de kern van wat hier wordt geaccepteerd, en het is de reden dat de
CI-stap geen "nice to have" is maar de voorwaarde waaronder dit besluit standhoudt.

## Referenties

- Migraties: `supabase/migrations/2026_07_31_r4_grant_hygiene.sql`,
  `2026_07_31_r6_default_privileges.sql`, `2026_07_31_r7_execute_grants_anon.sql` (elk met
  `_ROLLBACK`)
- Gates: `supabase/checks/2026_07_31_r1_structurele_gates.sql` — gate F en gate H
- Bevindingen: `REVIEW-ADDENDUM-2026-07-31.md` §1 (K-02, O-03, H-18) en §4 (restrisico's)
- Controlekader: `T3-RLS-CONTROLEKADER.md` §8b en §9 punt 4-5
- Eerdere, ontoereikende variant van dezelfde maatregel: `2026_07_10_aqlab_4_run_jobs.sql`
  r.131-132 en `2026_07_12_d1b_assurance_rpcs.sql` r.200-201 — beide doen `revoke … from public`
  terwijl de grant expliciet aan `anon` hangt (bevinding H-18)
