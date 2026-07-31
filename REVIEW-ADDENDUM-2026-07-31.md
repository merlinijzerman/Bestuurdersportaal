# Addendum bij de integrale review — live verificatie, 31 juli 2026

Bij het herstel van de code-findings is de productiedatabase live geverifieerd.
Dat leverde **zes bevindingen op die de statische review niet kón zien**, omdat
productie op punten afweek van de repository. Twee daarvan zijn Kritiek en één
Hoog. Alle zes zijn gedicht.

Dit addendum hoort bij `CODE_REVIEW_REPORT.md` (30 juli). Waar het afwijkt van
dat rapport, is dit addendum leidend.

---

## 1. Wat de statische review niet kon zien

Het reviewrapport toetste de repository. De aanname daarbij — impliciet, en
achteraf de belangrijkste blinde vlek — was dat de migraties in de repository
ook op productie waren toegepast. Er is geen migratierunner; migraties worden
handmatig in de Supabase SQL-editor geplakt. Vier van de zes bevindingen
hieronder bestaan uitsluitend doordat die aanname niet klopte.

| ID | Ernst | Bevinding | Status |
|---|---|---|---|
| K-02 | Kritiek | Twee wees-policies op `document_chunks` (`chunks schrijven`, INSERT, `TO public`, `with_check = true`). Ongeauthenticeerd schrijfpad naar de RAG-corpus: iedereen met de publieke anon-key kon chunks invoegen onder een willekeurig document, ook van een ander fonds. Die tekst wordt door retrieval opgehaald en als `[Bron N]` geciteerd — dus als vastgestelde fondsbron. Beïnvloeding van bestuurlijke advisering, niet slechts inzage. | Gedicht (R2) |
| K-03 | Kritiek | `profielen` stond in de ongeharde toestand: één `FOR ALL`-policy met alleen `USING (auth.uid() = id)` en zonder `WITH CHECK`. Postgres valt dan voor de schrijfkant terug op `USING`, dat alleen de rij-identiteit toetst. Gevolg: `rol` en `fonds_id` waren zelf-muteerbaar door elke ingelogde gebruiker. Rechtenescalatie naar beheerder, en — zodra er een tweede fonds is — volledige doorbraak van de tenantisolatie, omdat vrijwel elke RLS-policy op `profielen.fonds_id` sleutelt. Migratie `2026_07_03_profielen_rls_hardening.sql` was nooit gedraaid. | Gedicht (R3) |
| H-18 | Hoog | Vijf `SECURITY DEFINER`-RPC's waren ongeauthenticeerd aanroepbaar: `aqlab_claim_run_jobs` (evaluatiepijplijn stilleggen), `aqlab_add_run_cost` (kostenplafond corrumperen), `aqlab_log_download` (insert in een append-only auditspoor), `aqlab_assurance_meetwaarden` en `aqlab_audit_export_bron`. Zie §3 — de oorzaak is leerzamer dan de bevinding. | Gedicht (R7) |
| O-03 | Hoog (was Observatie) | `anon` hield `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` op alle 95 tabellen in `public` — de Supabase-standaardgrant. RLS was daarmee de enige barrière, en op `TRUNCATE` werkt RLS niet: dat raakt de append-only auditsporen rechtstreeks. Dit is de systemische oorzaak onder K-02. | Gedicht (R4, R6); zie §4 voor het restrisico |
| L-08 | Laag | `reindex_runs` droeg een handgeschreven policy met een andere naam dan de migratie en zonder expliciete `WITH CHECK`. Geen escalatiepad — `fonds_id` staat zelf in de `USING`-expressie, dus de terugval dekt de schrijfkant af — maar wel drift. | Gedicht (R5) |
| T-01 | Hoog | `npm run sanity` stond sinds 15 juli rood op een verouderde prompt-hash. Omdat het script bij de eerste rode stopte, hebben **45 suites twee weken niet gedraaid**, waaronder `pii-gate`, `rate-limit`, `tenant-enforce`, `tenant-domains`, `rag-fondsdiscipline` en `platform-wrapper`. Na herstel bleken alle 45 groen — de dekking was er wel, de terugkoppeling niet. | Gedicht |

---

## 2. Toegepaste migraties

Alle zeven zijn op productie toegepast en fail-closed geverifieerd binnen de
eigen transactie. Elke migratie heeft een rollback.

| | Bevinding | Kern |
|---|---|---|
| R1 | K-01, H-01, H-02, M-01, M-04 | Vijf cross-tenant policygaten gedicht; `search_path` gepind op vijf `SECURITY DEFINER`-functies; `fn_zelfde_fonds()` als parent-gebonden helper |
| R2 | K-02 | Wees-policies op `document_chunks` verwijderd |
| R3 | K-03 | `profielen`-RLS gesplitst in SELECT + UPDATE mét `WITH CHECK`, plus de bevriezingstrigger op `rol`/`fonds_id` |
| R4 | O-03 | `anon` alle schrijfrechten kwijt; `TRUNCATE`/`REFERENCES`/`TRIGGER` weg bij beide PostgREST-rollen |
| R5 | L-08 | `reindex_runs`-policy gelijkgetrokken met de repository |
| R6 | O-03b | Default privileges dichtgezet voor de `postgres`-kant (tabellen én functies) |
| R7 | H-18 | EXECUTE-rechten van `anon` teruggebracht tot drie publieke RPC's |

**Forensische controle (31-07-2026):** de rolverdeling in `profielen` is
gecontroleerd — één beheerder, acht bestuurders, allen in hetzelfde fonds, geen
afwijking. `document_chunks` bevatte geen wees-chunks. Beide controles zijn
indicatief, geen sluitend bewijs: er is geen wijzigingsspoor op `profielen.rol`,
en met één fonds in productie zou `fonds_id`-manipulatie sowieso geen effect
hebben gehad. Gegeven de besloten gebruikersgroep en het ontbreken van enig
signaal is de kans op daadwerkelijke exploitatie **laag**.

---

## 3. Het patroon onder de bevindingen

Vier van de zes bevindingen zijn dezelfde faalvorm: **de maatregel bestond, deed
zijn werk, en de uitkomst kwam nergens terecht.**

- K-02 en K-03: de migraties bestonden in de repository en waren nooit gedraaid.
- T-01: de testgate vuurde correct en niemand las het resultaat.
- H-18 is de scherpste variant. Twee migraties bevatten een expliciete
  `revoke`, een comment die de maatregel beschrijft (*"Geen EXECUTE voor
  anon/authenticated: uitsluitend de service-role draait de worker"*), en een
  codereview die er overheen is gegaan. De maatregel bestond niet: Supabase'
  default-ACL kent EXECUTE toe **expliciet aan de rol `anon`**, niet via
  `PUBLIC`. `revoke ... from public` haalde dus een recht weg dat er niet was,
  terwijl de anon-grant bleef staan.

Het reviewuitgangspunt luidde *"ontbrekend bewijs betekent niet automatisch dat
een beheersmaatregel bestaat"*. H-18 is de omgekeerde en lastigere variant:
**aanwezig bewijs betekende hier evenmin dat de maatregel bestond.**

De consequentie is dat controle op intentie in de broncode niet volstaat. Er
moet getoetst worden op de uitkomst in de database. Daarvoor zijn acht
structurele gates toegevoegd (`supabase/checks/2026_07_31_r1_structurele_gates.sql`):

| Gate | Toetst |
|---|---|
| A1/A2 | Parent-afgeleide tenanttabellen staan in het register en noemen de parent |
| B | Tabellen met eigen `fonds_id` binden aan fonds of aan `auth.uid()` |
| C / C2 | Geen `USING (true)` en geen `WITH CHECK (true)` |
| D | `anon` ziet geen enkele rij in de tenanttabellen (gedragstest met seed) |
| E | Elke `SECURITY DEFINER`-functie heeft een gepind `search_path` |
| F | `anon` heeft nergens schrijfrechten; geen `TRUNCATE`/`REFERENCES`/`TRIGGER` |
| G | Geen `FOR ALL`-policy zonder `WITH CHECK` |
| H | `anon` kan geen applicatiefunctie uitvoeren, op drie publieke RPC's na |

Vier daarvan (C2, F, G, H) zijn vandaag ontstaan uit een bevinding die de
statische review niet kon zien.

---

## 4. Restrisico's

### O-03b — default privileges van `supabase_admin` (geaccepteerd, gedetecteerd)

`pg_default_acl` kent voor schema `public` twee eigenaren. De `postgres`-kant is
door R6 dichtgezet. De `supabase_admin`-kant staat onveranderd op
`anon = arwdDxtm` voor tabellen en `anon = X` voor functies, en `postgres` is
geen lid van die rol en kan de entry niet wijzigen.

**Gevolg:** een object dat door `supabase_admin` in `public` wordt aangemaakt —
bij extensies die daar installeren, en bij platformmigraties van Supabase zelf —
krijgt de volledige grant terug, inclusief `INSERT` voor de publieke anon-key en
`TRUNCATE`.

**Preventie is niet haalbaar** met de rechten die het project heeft. Gates F en H
zijn de detectie, maar zien het pas nadat het object bestaat.

Dit is een bestuurlijk besluit, geen technisch detail: er wordt vertrouwd op een
controle achteraf in plaats van op een barrière vooraf. Dat is alleen
verdedigbaar als die controle daadwerkelijk draait. Tot de gates in CI staan is
de maatregel afhankelijk van eraan denken — en T-01 laat zien hoe dat afloopt.

**Interim:** gates draaien na elke Supabase-platformwijziging en vóór elke
release.

### Overige openstaande punten

| Punt | Aard |
|---|---|
| Storage-policy `documenten storage lezen`, tak `generiek` | Mist `auth.uid() is not null` (M-02, derde locatie). Alleen handmatig in het dashboard aan te passen. |
| Rotatie `ANTHROPIC_API_KEY` | Open sinds de review; `git log --all -- .env.vercel-now` nog niet gedraaid. |
| Decompressiebudget leest de ZIP-header | `beoordeelDecompressie` vertrouwt de gedeclareerde `uncompressedSize`, die de aanvaller zet. Vangt de gewone zipbom, niet de bewust liegende. Een harde cap tijdens de daadwerkelijke extractie zou dat sluiten. |
| Vier AQLab-consolepagina's | Gebruiken de service-role buiten `withPlatformRead` (H-15, laagste prioriteit binnen die bevinding). |
| `notifyByRole` doet stilzwijgend niets | Bewust niet gewijzigd; vergt een functioneel besluit. |
| `authenticated` houdt EXECUTE op alles wat het had | R7 is bewust geen gedragswijziging voor ingelogde gebruikers. Versmallen vergt analyse per functie. |

### Procedureel — uitgesteld tot na contractondertekening

Branch protection, omgevingsscheiding, migratierunner, foutmonitoring, backup- en
hersteltest, externe pentest.

Twee daarvan zijn door de bevindingen van vandaag zwaarder geworden:

- **Migratierunner.** K-02, K-03 en L-08 bestaan alle drie omdat er geen is.
  Zolang migraties handmatig worden geplakt, is "de migratie staat in de repo"
  geen bewijs dat de maatregel op productie werkt.
- **CI-gates (H-17).** Zonder CI is de detectie onder O-03b afhankelijk van
  handmatige discipline. Dit is repository-werk, geen leverancierswerk, en het is
  de goedkoopste maatregel op de hele lijst.

---

## 5. Herziene go/no-go

**Wat er nu staat, feitelijk.** Alle code-findings zijn hersteld en geverifieerd:
`tsc` schoon, 136 cross-tenant-tests groen, alle sanity-suites groen, build
groen. Zeven migraties zijn toegepast en fail-closed geverifieerd. Acht
structurele gates zijn schoon op productie. De rookproef is uitgevoerd en geeft
geen bevindingen.

**Huidige situatie — één fonds, besloten gebruikersgroep: verantwoord.** De
kritieke bevindingen zijn gedicht en er is geen aanwijzing voor exploitatie. De
resterende risico's zijn benoemd, begrensd en gedetecteerd.

**Tweede fonds: nog niet.** De tenantisolatie werkt aantoonbaar op codeniveau en
in de policies, maar de organisatie eromheen niet. Concreet moeten vóór het
onboarden van een tweede fonds op orde zijn:

1. een migratierunner, zodat repository en productie aantoonbaar gelijk lopen;
2. de structurele gates in CI, inclusief de gedragstest
   `2026_07_31_r1_tenantgrenzen.sql` tegen een testdatabase;
3. omgevingsscheiding — vandaag draait een preview-deploy tegen de
   productiedatabase;
4. branch protection op `main`.

Zonder 1 en 2 is de tenantisolatie niet *aantoonbaar*, en dat is bij
multi-tenant pensioenuitvoering het criterium — niet of hij toevallig werkt.

**Bestuurlijk aandachtspunt buiten de techniek:** er is één beheerder. Na R3 kan
niemand zichzelf nog promoveren, ook niet legitiem in noodgevallen. Een tweede
beheerder is daarmee een randvoorwaarde geworden in plaats van een wens.

---

*Opgesteld 31 juli 2026 als aanvulling op de integrale review van 30 juli.
Alle bevindingen zijn geverifieerd tegen de productiedatabase; waar een uitspraak
berust op interpretatie of op een controle die niet sluitend is, staat dat
expliciet vermeld.*
