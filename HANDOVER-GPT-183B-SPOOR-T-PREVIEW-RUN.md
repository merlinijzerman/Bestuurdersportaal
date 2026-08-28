# Handover — #183b spoor T: preview-run van het referentiepatroon

**Voor:** GPT/Codex-sessie die de preview-run oppakt.
**Van:** de spoor-T-vormsessie (Claude). Datum: 2026-08-27.
**Eén taak, scherp begrensd. Lees eerst §0 en §6 (STOP-grenzen) voor je iets doet.**

---

## 0. Wat dit is, en wat het NIET is

Besluit **0192** (`decisions/0192-governance-events-tenantketen.md`, Vastgesteld) maakt
`governance_events` een tenantketen. #183b spoor T laat 12 bestuurlijke handlers een
ketengebeurtenis schrijven via **triggers per brontabel**. De **vorm** ligt vast in
`TICKET-183B-SPOOR-T-SCHRIJFVORM.md`. Er zijn twee referentiemigraties geschreven maar
**nooit tegen een live database gedraaid**.

**Jouw taak:** draai *alleen* het fundament + de `stemmingen`-referentietrigger op
**Preview**, met de forward→rollback→forward-drill, en stel vast dat het werkt. Dit is
het bewijs dat het patroon deugt vóór het 6× wordt herhaald.

**Uitdrukkelijk NIET jouw taak (zie §6):** de andere zes triggers/RPC-inserts bouwen,
het `event_type`-register maken, of naar `main`/Productie promoveren. Dat gebeurt in de
Claude-sessie *nadat* jij hebt gerapporteerd dat de preview-run schoon is.

## 0e. UPDATE 2026-08-27 (4e) — tweede hash-fix, blokkeert alleen de notulenbaan

Je notulen-observatie ving `42883 ... function digest(text, unknown) does not exist`
in **`fn_doc_meta_log_hash()`** — exact dezelfde klasse als `fn_govevent_hash`, nu in de
document_metadata_log-hashtrigger die de notulen-RPC's geneste aanroepen (fn_notulen_
segment_audit → document_metadata_log). Gefixt met de nieuwe migratie
`2026_08_27_doc_meta_log_hash_extensions_qualify.sql` (extensions.digest, identieke hash).

Bereikbaarheid systematisch gemeten: dit was de **enige** extra unqualified-digest-functie
die geneste vanuit een #183b-functie loopt. De resterende twee (fn_bron_whitelist_log_hash,
fn_decision_snapshot) zijn niet bereikbaar vanuit dit spoor → gate-ticket, niet hier.

**Volgende stap (alleen de notulenbaan resteert):** pas
`2026_08_27_doc_meta_log_hash_extensions_qualify.sql` toe, dán
`2026_08_27_govevent_notulen.sql` opnieuw, en herhaal **alleen** de bevestig/verwijder-
observatie. De brontabellen + document-status-RPC zijn al groen waargenomen op preview.

**Apply-volgorde van de resterende re-apply:** (a) brontabellen (mét de orgprofiel-
typefix — al gedaan bij 0d), (b) document-status-RPC + route, (c) **doc-meta-hash-fix**,
(d) notulen. (b)/(c) vóór (d), want de notulenbaan raakt document_metadata_log.

## 0d. UPDATE 2026-08-27 (3e) — typecorrectie na de brontabel-run

Je preview-run ving een runtimefout: `42883 operator does not exist: uuid = text` in
`fn_orgprofiel_ketengebeurtenis()`. Oorzaak: `organisatie_profielen.bijgewerkt_door` is
**TEXT** (de weergavenaam), geen uuid — mijn trigger vergeleek 'm met `profielen.id`
(uuid) én zou 'm in het uuid-veld `actor_id` zetten. **Gefixt** in
`2026_08_27_govevent_brontabellen.sql`: `actor_id = auth.uid()`, `actor_naam =
new.bijgewerkt_door`, géén profielen-join. De overige actor-kolommen zijn nagemeten en
zijn allemaal uuid (geen verdere typecorrecties nodig). Scanner/gate ongewijzigd
(14/14 lokaal). **Volgende stap:** de drie teruggedraaide migraties (brontabellen,
document-status, notulen) opnieuw toepassen — brontabellen nu mét de fix — en de
resterende brontabel-observaties uitvoeren.

## 0c. UPDATE 2026-08-27 (2e) — BATCH COMPLEET: alle 12 handlers — LEES DIT EERST

Het referentiepatroon (`stemmingen`) draaide schoon op preview; de rest van #183b
spoor T is nu gebouwd. **Beide dragers staan lokaal op 0** (`ketengebeurtenis_vereist`
= 0, `spoor_vereist` = 0), de scanner-gate is **14/14 groen** en `tsc` = 0 —
lokaal geverifieerd (Node/tsc, géén DB). De DB-kant is nog **niet** op preview gedraaid.

**Volledige apply-volgorde op Preview** (Supabase-eerst, met de drill):
1. `2026_08_27_govevent_tenantketen.sql` (fundament: fonds_id + trigger + composite FK + policy)
2. `2026_08_27_govevent_hash_extensions_qualify.sql` (fix 42883)
3. `2026_08_27_govevent_stemmingen.sql` (#8/#9/#11 — al bewezen)
4. `2026_08_27_govevent_brontabellen.sql` (5 triggers: #1, #3/#4, #7, #10, #12)
5. `2026_08_27_govevent_document_status.sql` (RPC voor #2, besluit B) **+ de routewijziging** in `app/api/documents/[id]/route.ts`
6. `2026_08_27_govevent_notulen.sql` (2 RPC's create-or-replace: #5/#6)

**Scanner + gate + §15 zijn mee-aangepast** (lokaal groen, jij draait ze opnieuw):
`tests/karakterisering/audit-inventaris.mjs` (BASE_TRIGGER operatiebewust + RPC_TRAIL +
SPLIT_KLASSE opgeschoond), `audit-inventaris.json` geregenereerd, `audit-inventaris.sanity.ts`
(2 nieuwe anti-drift-tests: operatie-set + RPC-govevents), en `2026_07_08_t3_cross_tenant.sql`
(POSITIEF #7 brontabel-trigger).

**Allowlist:** er zijn nu méér nieuwe functies (7 triggerfuncties + `fn_document_status_zetten`);
regenereer `allowlist-grants.tsv` met `scripts/gen/v3-allowlist-generate.sql` ná het
toepassen. De notulen-RPC's zijn create-or-replace (grants ongewijzigd). Toelichting
staat in `allowlist-grants.toelichting.md`.

**Observatie (het echte bewijs):** doe voor elk van de brontabellen minimaal één
user-scoped mutatie en bevestig dat er precies één keten-event verschijnt, zichtbaar
voor de tenant en niet cross-tenant; en dat een service-role-mutatie dekking krijgt
(geen raise). §15 NEGATIEF #6 (composite FK 23503) en POSITIEF #7 (trigger vuurt)
draaien binnen `bash scripts/cross-tenant-ci.sh`.

**STOP-grenzen blijven** (§6): niet naar `main`/Productie; SQL niet stilzwijgend patchen;
rapporteer afwijkingen letterlijk. Dit is de plek waar een fout in één van de zeven
zich zou vermenigvuldigen, dus de observatie is per brontabel, niet steekproef.

---

## 0b. UPDATE 2026-08-27 — na jouw eerste run (GATE A2) — LEES DIT

De vorige preview-run stopte terecht op **GATE A2** van
`supabase/checks/2026_07_31_r1_structurele_gates.sql`. Dat is opgelost, en het
referentiepatroon is aangescherpt. **De artefacten zijn sindsdien gewijzigd — je
draait ze opnieuw**, met de drill, vanaf schoon:

1. **GATE A2 — opgelost (besluit 0192 §2e).** `governance_events` heeft sinds 0192
   een eigen `fonds_id` en hoort daarmee niet in het A-register (dat is voor tabellen
   *zonder* eigen fonds_id). Het is uit het register gehaald → GATE B dekt het nu
   (WITH CHECK noemt fonds_id → slaagt). **De gatefile is al aangepast**; jij draait
   hem opnieuw en verwacht A1/A2/B groen.
2. **Handhaving fonds/decision-consistentie = composite FK, niet meer een triggercheck
   (besluit C / I5).** `fn_govevent_fonds` leidt nu **alleen** `fonds_id` af; de regel
   "een decision_id hoort bij hetzelfde fonds" wordt afgedwongen door een **composite
   FK** `governance_events(decision_id, fonds_id) → decision_objects(id, fonds_id)`.
   De foundation-migratie is hierop aangepast (functie zonder invariant + twee nieuwe
   constraints). **Re-apply de foundation** (create-or-replace + de constraints zijn
   idempotent).
3. **§15-gedragstest toegevoegd** in `supabase/checks/2026_07_08_t3_cross_tenant.sql`
   (DEEL 2): een POSITIEF (eigen-fonds ketengebeurtenis slaagt) + **NEGATIEF #6**
   (A hangt een event aan een fonds-B-besluit → composite FK weigert, 23503).
4. **NIEUWE migratie `2026_08_27_govevent_hash_extensions_qualify.sql`** — lost de
   `42883: function digest(text, unknown) does not exist` op die de eerste échte
   `stemmingen`-observatie liet vallen. `fn_govevent_hash` riep `digest()`
   ongekwalificeerd aan; de gepinde search_path van de brontabel-trigger erft door
   en mist `extensions`. Fix: `extensions.digest` (huispatroon, identieke hash).
   **Deze migratie MOET vóór de `stemmingen`-observatie zijn toegepast** (volgorde:
   fundament → hash-fix → stemmingen), anders faalt elke ketengebeurtenis opnieuw.

## 1. Projectconventies die hier gelden (niet-onderhandelbaar)

- **Bron van waarheid = code + `supabase/migrations/`.** Lees `CLAUDE.md`.
- **Werkdir is `mvp/`.** De git-repo zit in `mvp/`, niet in de projectroot.
- **Meet tegen `origin/<branch>`, nooit in een werkkopie** (`git fetch` eerst). Doe een
  `git fetch` vóór je vertakt — er lopen parallelle sessies die naar `preview`/`main`
  mergen.
- **Supabase-eerst:** er is **geen migratierunner**. Migraties worden **met de hand**
  in de Supabase SQL-editor van het **Preview-project** geplakt. Preview heeft een
  **eigen** Supabase (los van Productie). Draai DB-werk **op een productiegelijke DB**,
  nooit op een zelf-in-elkaar-gezette.
- **Geen terminal-git commits / geen push naar `main`.** Branch → PR naar `preview`.

## 2. De artefacten (alle vier bestaan al, ongecommit)

| Bestand | Wat |
|---|---|
| `supabase/migrations/2026_08_27_govevent_tenantketen.sql` | FUNDAMENT: `fonds_id`-kolom (nullable, FK, géén backfill), `fn_govevent_fonds` (drietrapsregel, SECURITY INVOKER, **leidt alleen af**), **composite FK** `governance_events(decision_id,fonds_id)→decision_objects(id,fonds_id)` + zijn doel-unieke, asymmetrische policy (`USING` OR-tak / `WITH CHECK` strikt). |
| `supabase/rollbacks/2026_08_27_govevent_tenantketen_ROLLBACK.sql` | Rollback fundament (composite FK + unieke weg, policy terug naar decision_id-only, kolom+trigger weg). |
| `supabase/migrations/2026_08_27_govevent_hash_extensions_qualify.sql` | **NIEUW** — `fn_govevent_hash` → `extensions.digest` (lost 42883 op). Toepassen ná fundament, vóór `stemmingen`. Identieke hash. |
| `supabase/rollbacks/2026_08_27_govevent_hash_extensions_qualify_ROLLBACK.sql` | Rollback hash-fix (terug naar ongekwalificeerd — alleen als de brontabel-triggers ook weg zijn). |
| `supabase/migrations/2026_08_27_govevent_stemmingen.sql` | REFERENTIETRIGGER: `fn_stemming_ketengebeurtenis` + `trg_stemming_ketengebeurtenis` (AFTER INSERT OR UPDATE; 3 event_types via TG_OP+status; gecureerde payload; brontrigger zet `fonds_id`). |
| `supabase/rollbacks/2026_08_27_govevent_stemmingen_ROLLBACK.sql` | Rollback trigger. |
| `supabase/checks/2026_07_31_r1_structurele_gates.sql` | **GEWIJZIGD** — `governance_events` uit A-register (§2e); draai opnieuw, verwacht A1/A2/B groen. |
| `supabase/checks/2026_07_08_t3_cross_tenant.sql` | **GEWIJZIGD** — DEEL 2: fonds-B besluit-seed + POSITIEF + NEGATIEF #6 (composite FK). Draait binnen `bash scripts/cross-tenant-ci.sh`. |

Lees ze vóór je iets draait. De ontwerpredenen staan in 0192 §2b/§2c/§5 en in het
ticket §2/§4/§6b.

## 3. Volgorde van uitvoeren (fundament EERST — de trigger leunt erop)

1. `git fetch`; vertak van de actuele `preview`-tip (bv. `feat/183b-spoor-t-stemmingen`).
   Neem **alleen** de bestanden uit §2 mee (twee migraties + hun rollbacks, de hash-fix
   + rollback, en de twee gewijzigde check-files). *(Let op: in de werkkopie kunnen ook
   ongerelateerde spoor-M-bestanden staan; die horen NIET in deze PR.)*
2. Plak **`2026_08_27_govevent_tenantketen.sql`**. Verwacht: slaagt schoon.
3. Plak **`2026_08_27_govevent_hash_extensions_qualify.sql`**. Verwacht: slaagt schoon.
   (Zónder deze faalt stap 5's observatie op `42883`.)
4. Plak **`2026_08_27_govevent_stemmingen.sql`**. Verwacht: slaagt schoon.
5. **Forward→rollback→forward-drill**, per migratie, op de productiegelijke DB:
   - `stemmingen`-rollback → `hash-fix`-rollback → `tenantketen`-rollback → alle drie
     opnieuw forward. Doel: omkeerbaar + herhaalbaar. Noteer fouten letterlijk.

## 4. Verificatie (aantoonbaar, niet beweerd)

**A. Structurele gates (verplicht na policy/grant/functie-wijziging).**
- `supabase/checks/2026_07_31_r1_structurele_gates.sql` tegen de Preview-DB → schoon
  (gates A1, A2, B, C, C2, E, F, G, H, D).
- **Twee nieuwe functies** (`fn_govevent_fonds`, `fn_stemming_ketengebeurtenis`) hebben
  EXECUTE-grants → de **V3-grants-gate** vereist een regel per functie in
  `supabase/checks/allowlist-grants.tsv`. Regenereer met
  `scripts/gen/v3-allowlist-generate.sql` en motiveer de toevoeging in
  `allowlist-grants.toelichting.md`. Draai daarna de V3-grants-gate
  (`2026_08_20_v3_grants_volledig.sql`) → schoon. **Zonder deze regels faalt de gate
  op "onbekend object".**

**B. Cross-tenant §15-suite (HÉT verificatiecommando).**
- `bash scripts/cross-tenant-ci.sh` (tsc + app-laag T1–T14 + DB-laag onder échte RLS).
  DB-laag vereist `TEST_DATABASE_URL`/`supabase start`. Eén rood/groen.
- Ook `npm run gates` (typecheck, sanity, lint:colors, mapindeling, §15).

**C. Gedragsobservatie op OMG-1-achtige data — het eigenlijke bewijs.**
Bewijs beide richtingen, want een test die alleen afwezigheid toont slaagt ook op een
trigger die nooit vuurt:
- **User-scoped:** als een tenantgebruiker in fonds A een `stemmingen`-rij aanmaakt
  (open) en later sluit/intrekt, verschijnen er `governance_events`-rijen met
  `event_type` ∈ {`stemming_geopend`,`stemming_gesloten`,`stemming_ingetrokken`},
  `fonds_id = A`, gecureerde `nieuwe_waarde`, en ze zijn **zichtbaar voor de fonds-A-
  tenant** en **niet** voor fonds B.
- **Service-role (dekking):** een service-role-insert op `stemmingen` produceert **wél**
  een rij (bewijst dat `fn_govevent_fonds` de brontrigger-`fonds_id` accepteert i.p.v.
  raist) en **breekt niet**.
- **Cross-tenant weigering:** de consistentie-invariant weigert een rij waarvan
  `decision_id` bij een ander fonds hoort dan `fonds_id` (generieke melding,
  `errcode='GV001'`, géén identifiers).

## 5. Wat je terugrapporteert

Kort en feitelijk: (1) drill-uitkomst (forward/rollback/forward, per migratie); (2)
gate-uitkomsten (structureel + V3 + §15), met de allowlist-toevoeging; (3) de drie
observaties uit §4C, met bewijs (query-uitvoer of screenshot van de rijen); (4) elke
afwijking van de verwachte SQL — **letterlijk**, niet geïnterpreteerd. Een fout die
alleen bij uitvoering opvalt (bv. een `OLD`-referentie op INSERT, of een kolom die
anders heet) is precies wat deze run moet vangen.

## 6. STOP-grenzen (hard)

- **Bouw de andere zes triggers / de 2 RPC-inserts NIET.** Bouw het `event_type`-register
  NIET. Dat volgt pas ná jouw schone rapport, in de Claude-sessie — juist zodat een
  systematische fout zich niet over zeven triggers vermenigvuldigt.
- **Promoveer NIET naar `main`/Productie.** Alleen Preview, alleen een PR naar `preview`.
- **Wijzig de SQL niet stilzwijgend om een gate groen te krijgen.** Loopt iets vast,
  rapporteer het letterlijk (§5) en laat de fix een expliciet besluit zijn — een
  bewijsketen is geen plek voor een snelle patch.
- **Raak de spoor-M-bestanden niet aan** (aparte capability-migratie + workerroutes):
  die horen bij een andere PR.

## 7. Achtergrond als je dieper wilt

- Besluit: `decisions/0192-governance-events-tenantketen.md` (§2b drietrapsregel + INVOKER
  + consistentie-invariant; §2b(iii) staande regel over-capture; §2c policy).
- Vorm: `TICKET-183B-SPOOR-T-SCHRIJFVORM.md` (§2 over-capture, §4 hybride vorm, §6b payload/actor/volgorde).
- Toetsregel domeinspoor: `decisions/0191-…-audit-union.md` §7 (amendement) + §8 DPIA-delta-2 (`actor_naam`).
