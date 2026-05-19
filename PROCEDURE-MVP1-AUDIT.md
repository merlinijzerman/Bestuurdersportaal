# Decision Object MVP-1 — Audit naar aanleiding van reviewfeedback

> **Status**: Revisie 1.1 — na review op v1.0 (2026-05-18)
> **Aanleiding**: externe review van `PROCEDURE-MVP1-ONTWERP.md` (v2.1) leverde zes substantiële technische bevindingen op. Aangezien de subfases 1A t/m 1E al volledig zijn opgeleverd en op live Supabase staan, is de vraag: welke bevindingen spelen in de huidige code, hoe ernstig, en wat is de aanbevolen fix?
> **Methode**: gerichte code- en SQL-inspectie van `supabase/migrations/2026_05_07_decision_object.sql`, `supabase/schema.sql`, `lib/decision*.ts`, `lib/auditdossier-html.ts`, en de relevante API-routes onder `app/api/decisions/`.
> **Format**: per bevinding — status (bevestigd / nuance / niet van toepassing), bewijs uit de code, aanbevolen fix met effort-schatting.

## Revisielog

**v1.1 (2026-05-18)** — na review op v1.0:

1. **Snapshot-fix (punt 2) herzien.** De voorgestelde `unique index on (decision_id, trigger_status)` blokkeert legitieme tweede snapshots in heropen-cyclus (afgesloten → heropend → opnieuw afgesloten). Aanbeveling herzien: meerdere snapshots per triggerstatus toestaan en de API explicieter maken via `?versie=besluitmoment&trigger=…` (variant A). Effort bijgewerkt van 0.25 naar 0.5 dag.
2. **Cascade-fix (punt 5) herzien.** `on delete set null` is een UPDATE die op de bestaande no-update-trigger stuk loopt — fix werkte feitelijk niet. Aanbeveling herzien naar `on delete restrict` plus expliciete governance-keuze: Decision Objects met audit-trail zijn principieel niet hard verwijderbaar. Demo/test-cleanup via maintenance-script of admin-only purge-functie buiten product-FK's om.
3. Bijbehorende framing in §5 aangescherpt: het gedrag is "mogelijk geen bug maar een ongeformaliseerde governance-keuze".

**v1.0 (2026-05-18)** — Eerste opname met zes bevindingen, samenvattende tabel en aanbevolen pakket.

---

## Samenvatting

| # | Bevinding | Status | Ernst | Effort |
|---|---|---|---|---|
| 1 | RLS-permissive policies neutraliseren AI-domein-restrictie | Bevestigd, server-side gecompenseerd | Middel | 0.5 dag |
| 2 | Snapshot-keuze bij meerdere snapshots (incl. heropen-cyclus) | Nuance — API-semantiek vraagt verduidelijking | Laag tot middel | 0.5 dag |
| 3 | Auditclaim "wie heeft gezien" | Bevestigd — geen view-logging | Laag tot middel | 0.5 dag óf claim aanpassen |
| 4 | `unique(coalesce(...))`-constraint | Niet van toepassing — is een unique *index*, dat is geldig | n.v.t. | 0 |
| 5 | `governance_events` cascade-conflict — governance-principe | Bevestigd, plus principiële keuze: hard-delete uitsluiten | Middel | 0.5 dag |
| 6 | AI-bronnen-schema | Bevestigd — geen DB-level constraint | Middel | 0.5 dag |

Totaal: ~2.5 dev-dagen aan technische schuld, plus twee principiële keuzes (auditclaim versmallen of view-logging bouwen; hard-delete van Decision Objects principieel uitsluiten). Geen van de bevindingen is acuut blokkerend voor productie.

---

## 1. RLS-permissive policies kunnen AI-domein-restrictie omzeilen

### Bevinding

Op `decision_ai_interactions` staan twee policies:

- **Generieke fonds-policy** (regels 702-709 in `2026_05_07_decision_object.sql`):
  ```sql
  create policy "fonds decision_ai_interactions" on public.decision_ai_interactions
    for all using (decision_id in (select id from public.decision_objects where fonds_id = ...))
  ```

- **AI-validatie-domein-policy** (regels 764-785):
  ```sql
  create policy "ai validatie domein" on public.decision_ai_interactions
    for update using (... and (validatie_domein = 'algemeen' or
      (validatie_domein in (...) and exists (select 1 from public.profielen
        where id = auth.uid() and rol in ('voorzitter','beheerder')))))
  ```

In PostgreSQL worden meerdere policies standaard PERMISSIVE gecombineerd — als één policy toegang geeft, is het rijniveau-toegestaan. De generieke `for all`-policy geeft elke gebruiker binnen het fonds UPDATE-rechten, waardoor de specifieke domein-policy in de praktijk geen filter meer is: hij voegt extra toelating toe in plaats van toelating te beperken.

### Status

**Bevestigd** met de nuance dat de server-side rolcheck in `app/api/decisions/[id]/ai-interactions/[aiid]/route.ts` (regels 76-96) een hard 403 teruggeeft voor niet-privileged gebruikers op specialistische domeinen. Dat compenseert in de praktijk — geen privilege-escalation via de UI — maar de RLS-laag is op zichzelf niet veilig.

### Aanbevolen fix

Drie sporen, oplopend in zwaarte:

- **Klein** (0.5 dag): markeer de domein-policy expliciet als `as restrictive` (PostgreSQL 10+ syntax). Restrictive policies worden geïntersecteerd in plaats van geunieerd; dan filtert de domein-check echt.
- **Middel** (1 dag): drop de generieke `for all`-policy en vervang door vier expliciete policies (`for select`, `for insert`, `for update`, `for delete`) met de juiste filters per operatie. De `for update`-variant krijgt de domein-restrictie ingebouwd.
- **Groot** (volgens reviewer): RLS uitsluitend voor zichtbaarheid en tenant-isolatie, gevoelige acties via server-side RPC zoals `validate_ai_interaction(...)`. Aangrijpend voor de hele codebase; alleen overwegen als onderdeel van een breder security-traject (sluit aan op Route C uit `SECURITY-ROUTE-A-PLAN.md`).

Voorstel: kies *Klein*. Restrictive-keyword toevoegen is één SQL-regel, idempotent in een nieuwe migratie. De server-side rolcheck blijft staan als defense-in-depth. Het grotere refactor naar RPC-functies hoort thuis in een serieus security-traject, niet als bijvangst van deze audit.

---

## 2. Snapshot-keuze bij meerdere snapshots

### Bevinding

Snapshots worden automatisch aangemaakt bij overgang naar `besloten`, `voorwaardelijk_besloten`, `in_evaluatie`, `afgesloten`. De auditdossier-API selecteert bij `?versie=besluitmoment` de snapshot via:

```ts
.order("aangemaakt_op", { ascending: false }).limit(1)
```

(`app/api/decisions/[id]/auditdossier/route.ts` regels 81-89.)

Dat is deterministisch: de meest recente snapshot wint. Functioneel is dat verdedigbaar — een dossier dat van `besloten` naar `in_evaluatie` naar `afgesloten` is gegaan, geeft als "besluitmoment" feitelijk *de laatst-gepasseerde besluit-status*. Een gebruiker die letterlijk de eerste besluit-stand wil zien, kan dat met de huidige API niet expliciet opvragen.

Daarnaast: de trigger `fn_decision_snapshot` (regels 497-520) heeft geen `on conflict`-clausule en er is geen unique constraint op `(decision_id, trigger_status)`. Race conditions bij snelle status-overgangen kunnen theoretisch duplicaten opleveren.

### Status

**Nuance**. Werkt in de praktijk eenduidig; geen acute bug. Aanscherping van de API-semantiek is gewenst — niet via een unique index op de tabel.

### Aanbevolen fix (herzien in v1.1)

De eerdere v1.0-aanbeveling van een unique index op `(decision_id, trigger_status)` blokkeert legitieme tweede snapshots in een **heropen-cyclus** (afgesloten → heropend → opnieuw afgesloten). Een tweede `afgesloten`-snapshot is dan bestuurlijk wenselijk maar zou worden geweigerd. Daarom is die fix vervallen.

In plaats daarvan:

- **Documenteer expliciet** dat `?versie=besluitmoment` semantisch betekent "meest recente snapshot, ongeacht trigger-status" — in een API-comment in `app/api/decisions/[id]/auditdossier/route.ts` en in `PROCEDURE-MVP1-ONTWERP.md` §4.11.
- **Breid de API uit** met:
  - `?versie=besluitmoment&trigger=besloten` (of `voorwaardelijk_besloten` / `in_evaluatie` / `afgesloten`) — selecteert de meest recente snapshot van die specifieke trigger-status. Onontbeerlijk voor reconstructie in heropen-cyclus.
  - Optioneel `?versie=snapshot&id=<snapshot_id>` voor expliciete selectie.
- Houd meerdere snapshots per `(decision_id, trigger_status)` expliciet toe. De bestaande append-only-trigger op `decision_audit_snapshots` waakt al over immutability van iedere snapshot afzonderlijk.

Race conditions bij gelijktijdige status-overgangen zijn theoretisch mogelijk maar praktisch onwaarschijnlijk (statusovergang gaat via één API-call per gebruiker; de DB-trigger werkt binnen één transactie). Indien ooit een probleem: applicatielogica kan de check doen, niet de tabel-constraint.

Effort: 0.5 dag (API-uitbreiding + documentatie + verificatie met testdossier dat door heropen-cyclus is gegaan).

---

## 3. Auditclaim "wie wat wanneer heeft gezien"

### Bevinding

`PROCEDURE-MVP1-ONTWERP.md` §3 (acceptatiecriteria) stelt: *"Het auditdossier kan aantonen wie wat wanneer heeft gezien, toegevoegd, gevalideerd, besloten of overruled."*

In de codebase:

- `governance_events` registreert mutaties (toegevoegd, gevalideerd, besloten, overruled, exports) maar **niet lees-acties** op het dossier.
- `app/api/decisions/[id]/auditdossier/route.ts` (regels 142-150) logt alleen het *exporteren* van het auditdossier, niet het ophalen voor live weergave.
- `app/api/decisions/[id]/dossier/route.ts` doet geen access-logging.
- `document_inzage` (van de bibliotheek-module) logt wel inzage van originelen, maar wordt niet hergebruikt voor decision-objecten.

### Status

**Bevestigd**. De claim "wie heeft gezien" is op dit moment niet onderbouwd door code.

### Aanbevolen fix

Twee opties, en de keuze is principieel:

- **Claim versmallen** (0 dev-werk): pas de tekst in `PROCEDURE-MVP1-ONTWERP.md` §3 aan naar *"wie wat wanneer heeft toegevoegd, gevalideerd, besloten of overruled"*. Sluit aan op wat de code daadwerkelijk levert. Aanbevolen voor MVP-1.
- **Logging bouwen** (0.5 dag): nieuwe tabel `decision_access_log` met `(id, decision_id, gebruiker_id, gelezen_op)`; trigger of expliciete insert in de dossier-API-routes. Optioneel: filter op rol of consolideer per dag om logvolume hanteerbaar te houden.

Voorstel: claim versmallen. View-logging is een stevige extra feature (privacy, retentie, volumebeheersing) en hoort niet als bijvangst van een ontwerpdocument-audit te ontstaan. Het kan een aparte iteratie 2-feature zijn met eigen ontwerpdocument.

---

## 4. `unique(coalesce(...))` op `procedure_requirements`

### Bevinding

Reviewer claim: *"Een UNIQUE-constraint binnen CREATE TABLE kan niet zomaar een expressie als coalesce(...) bevatten. Dit moet worden opgelost met een unique index."*

In de codebase staat (regels 328-329 in `2026_05_07_decision_object.sql`):

```sql
create unique index if not exists idx_req_uniek on public.procedure_requirements
  (template_code, stap_volgorde, requirement_type, coalesce(documenttype, label));
```

Dit is **al een unique index**, niet een table-constraint. PostgreSQL ondersteunt `coalesce()` in expression-indexes sinds versie 8.0. Werkt correct.

### Status

**Niet van toepassing**. Reviewer zat hier mis — het zag eruit als een constraint vanwege de naamgeving, maar de syntax is een unique index.

### Aanbevolen fix

Geen. Mogelijk kort terugleggen bij reviewer ter clarificatie.

---

## 5. `governance_events` cascade-conflict met immutable-trigger

### Bevinding

`governance_events.decision_id` heeft `on delete cascade` naar `decision_objects` (regel 334):

```sql
foreign key (decision_id) references public.decision_objects(id) on delete cascade
```

Tegelijk blokkeert trigger `trg_govevent_no_delete` elke delete (regels 356-364):

```sql
create trigger trg_govevent_no_delete before delete on public.governance_events
  for each row execute function fn_govevent_immutable();
-- fn_govevent_immutable: raise exception 'governance_events is append-only';
```

Bij `delete from decision_objects where id = ...` probeert PostgreSQL eerst de gerelateerde `governance_events`-rijen te cascaderen → de delete-trigger raise't een exception → de hele delete faalt. In de praktijk is een Decision Object daarmee **niet meer hard-verwijderbaar** zodra er één `governance_events`-rij aan hangt.

Voor de productie-flow waar Decision Objects worden geannuleerd/afgesloten via status en niet hard-deleted, is dit geen probleem. Maar bij demo-cleanup, test-resets, of als een fonds zou worden verwijderd, blokkeert het.

### Status

**Bevestigd**. Maar deze status is in v1.1 principieel anders ingevuld dan in v1.0 — zie hieronder.

### Herframing (v1.1)

Het huidige gedrag — een Decision Object met audit-trail is feitelijk niet hard-verwijderbaar — is mogelijk **geen bug maar een ongeformaliseerde governance-keuze**. Hard-delete van een besluit dat in een formeel auditspoor zit, ondergraaft de hele auditfunctie. De vraag is dus niet alleen "hoe maken we delete weer mogelijk", maar **of we hard-delete überhaupt willen toestaan** voor objecten met audit-events.

Voor een product dat zich positioneert als governance-instrument luidt het antwoord vrijwel zeker: nee. Annulering en afsluiting horen via status, niet via delete; demo- en testdata-cleanup hoort buiten de productlogica om plaats te vinden.

### Aanbevolen fix (herzien in v1.1)

De v1.0-aanbeveling van `on delete set null` werkte feitelijk **niet**: PostgreSQL voert bij `set null` een UPDATE uit op de child-rij (`update governance_events set decision_id = null where ...`), en de no-update-trigger `trg_govevent_no_update` op `governance_events` blokkeert die UPDATE óók. Resultaat: delete faalt nog steeds. Voorstel daarmee vervallen.

In plaats daarvan:

- **Verander de FK** naar `on delete restrict` in een nieuwe migratie. Maakt het gedrag dat nu impliciet bestaat (delete blokkeert) **expliciet en intentioneel**. Foutmelding bij poging tot delete wordt schoon en begrijpelijk: *"foreign key violation on governance_events"*, in plaats van de minder voorspelbare *"governance_events is append-only"*-exception.
- **Documenteer expliciet** als governance-principe (in `PROCEDURE-MVP1-ONTWERP.md` §4.11 of een nieuw zelfstandig blok): *"Decision Objects met governance-events zijn niet hard verwijderbaar. Annulering verloopt via status `geannuleerd` of `afgewezen`; afsluiting via status `afgesloten`."*
- **Voor demo-/test-cleanup**: aparte admin-only `purge_decision_object(decision_id, motivering)`-functie of maintenance-script buiten de product-FK's om. Bij demo-reset wordt dat script handmatig aangeroepen; het schoont in één transactie de child-tabellen op en daarna het Decision Object zelf, met expliciete logging in een aparte `purge_log`-tabel.

Effort: 0.5 dag (migratie schrijven + idempotente drop/recreate van de FK-constraint + documentatie-update + optioneel skeleton voor purge-script).

---

## 6. AI-bronnen-schema te losjes

### Bevinding

`decision_ai_interactions.bronnen` is `jsonb default '[]'` (regel 270) — geen CHECK-constraint of expliciet schema. TypeScript-interface `AIBron` in `lib/decision-view.ts` (regels 334-339) bestaat:

```ts
export interface AIBron {
  document_id?: string;
  titel?: string;
  paragraaf?: string;
  fragment?: string;
}
```

Maar dit is een frontend-contract dat de database niet afdwingt. Een API-route kan willekeurige JSON in `bronnen` opslaan; later kunnen audit-claims over "AI-output op deze bronnen gebaseerd" niet hard onderbouwd worden.

### Status

**Bevestigd**. Voor een product met een kernclaim *"AI met controleerbare bronverwijzing"* is dit auditmatig zwakker dan gewenst.

### Aanbevolen fix

Twee niveaus, kies één:

- **Minimaal** (0.5 dag): voeg een CHECK-constraint toe die alleen het type valideert:
  ```sql
  alter table decision_ai_interactions
    add constraint chk_bronnen_array check (jsonb_typeof(bronnen) = 'array');
  ```
  Plus validatie in elke API-route die `bronnen` schrijft: minimaal `[{ document_id?, titel?, paragraaf?, fragment? }, ...]`.

- **Genormaliseerd** (2-3 dagen, voor iteratie 2): aparte tabel `decision_ai_interaction_sources` met `(id, ai_interaction_id, document_id FK, titel, paragraaf, fragment, bron_type, document_version_id)`. Geeft echte audit-grade traceerbaarheid: welke documentversie, welke passage, formele referentie naar het document. Vergt migratie van bestaande `bronnen`-jsonb naar de nieuwe tabel.

Voorstel: minimaal voor nu, met expliciet plan voor genormaliseerd in een latere fase. Klein CHECK + applicatie-validatie sluit het meest acute gat (willekeurige JSON), en het zwaardere refactor hoort in een ontwerpdocument over AI-traceability als zelfstandige feature.

---

## Aanbevolen pakket (v1.1)

Bij elkaar opgeteld voor MVP-1 nu:

| Punt | Actie | Type | Effort |
|---|---|---|---|
| 1 | `as restrictive` toevoegen aan `ai validatie domein`-policy | SQL-migratie | 0.5 dag |
| 2 | API uitbreiden met `?trigger=…` voor snapshot-selectie + documentatie van semantiek; géén unique index | Code + doc | 0.5 dag |
| 3 | Claim in `PROCEDURE-MVP1-ONTWERP.md` §3 aanpassen ("gezien" weg) | Tekst | 0.1 dag |
| 4 | n.v.t. | — | 0 |
| 5 | FK `governance_events.decision_id` → `on delete restrict` + governance-principe expliciet documenteren | SQL-migratie + doc | 0.5 dag |
| 6 | `chk_bronnen_array` + JSON-schema-validatie in API-routes | SQL + code | 0.5 dag |

Totaal: ~2.1 werkdagen. Logisch in één deploy meenemen: nieuwe migratie `2026_05_19_review_followups.sql` met de twee SQL-aanpassingen (punt 1 en 5) plus eventuele bronnen-validatie (punt 6), plus API-uitbreiding voor punt 2, plus claim-correctie in de twee ontwerpdocumenten.

Punt 3 en 4 zijn geen technisch werk maar communicatie naar de reviewer: bevestig dat de claim is bijgesteld en dat de unique-index-discussie een misvatting was.

**Governance-besluit** (uit punt 5): wordt bewust vastgelegd dat Decision Objects met audit-trail principieel niet hard-verwijderbaar zijn. Voor demo- en testreset komt een aparte admin-only purge-functie buiten de product-FK's om; ontwerp daarvan is een aparte (kleine) iteratie zodra het nodig blijkt.

---

## Wat dit auditrapport bewust niet doet

- **Niet** ontwerpen van een view-logging-feature voor decision-objecten — als die toegevoegd moet worden, hoort hij in een eigen ontwerpdocument met privacy- en retentieafwegingen.
- **Niet** refactoren van AI-bronnen naar een aparte tabel — past bij iteratie 2, met eigen migratie- en backfill-strategie.
- **Niet** de bredere RLS-strategie (server-side RPC voor alle gevoelige acties) ter discussie stellen — dat is een Route-C-traject, niet een follow-up op deze audit.

---

*Einde rapport. Verzoek aan reviewer: bevestig of de voorgestelde fixes voldoende zijn. Daarna kan migratie `2026_05_19_review_followups.sql` worden uitgewerkt en gedraaid.*
