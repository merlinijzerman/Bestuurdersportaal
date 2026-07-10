# 0053 — T10: review-/publicatieworkflow generieke contentlaag (statusmachine + review-verval)

- **Status:** Geaccepteerd
- **Datum:** 2026-07-10
- **Betrokkenen:** Merlin IJzerman (opdrachtgever, akkoord per beslispunt), Claude Code (uitvoering)

## Context

Increment T10 bouwt de T6-contentlaag (besluit 0048: canonieke generieke status AFGELEID
over `status`/`bronstatus`, geen kolom) uit tot een **beheerd redactieproces**: een review-/
publicatieworkflow met verplichte periodieke review, gecontroleerde status-overgangen en
actieve signalering van verlopen/ingetrokken content. Leidend: werkopdracht T10, beslisnotitie
v0.4 §9/§11, de T6-werkopdracht, besluit 0045 (RAG published-only) en 0048 (afgeleide status).

As-built bij aanvang (geverifieerd tegen de code):
- De canonieke status is afgeleid (`lib/generiek-status.ts`); `published` = de 0045-gate.
- Er bestaat al een status-**transitietrigger** (`fn_document_status_overgang_check`, migratie
  2026_06_18), maar die dekt alleen `documenten.status` (niet `bronstatus`) en gebruikt de
  **fonds**-lifecycle-tabel. `withdrawn`/`deprecated` via `bronstatus` waren ongated; er was
  géén pad dat `withdrawn` produceerde ("intrekken" zette `alleen_historisch`+`historisch` =
  **deprecated**).
- De retrieval-RPC's filteren generiek al published-only, maar checkten **géén datum-verloop**
  (0048 schoof datum-expiry expliciet door naar T10).
- `document_metadata_review_queue` heeft `fonds_id NOT NULL` en sluit generiek expliciet uit.
- Audit loopt append-only via `document_metadata_log` (hash) + `platform_event_log`.

## Besluit (per beslispunt, met akkoord Merlin)

1. **Vervalbeleid = BLOKKEREN als actuele bron** (niet: waarschuwen). Een generiek published
   document met verstreken `volgende_review` telt niet meer als actuele bron in RAG/UI. Veilige
   faalrichting (bron ontbreekt i.p.v. verouderd meekomen), consistent met 0045. **NULL
   `volgende_review` = NIET afgedwongen** (backward-compat: bestaande content zonder reviewdatum
   blijft beschikbaar en wordt in het overzicht als "geen reviewdatum" gesignaleerd).

2. **Handhaving = READ-TIME, geen muterende job.** De verval-toestand is afgeleid (datum <
   peildatum), net als de canonieke status. Geen cron die status omzet → geen human-in-the-loop-
   omzeiling, geen extra auditflip. Gate in **beide** RPC's (`d.volgende_review IS NULL OR
   d.volgende_review >= p_peildatum`) én in de app-guard `handhaafFondsdiscipline` (twee lagen,
   patroon 0045). `volgende_review` gelezen via de bestaande documenten-join — **geen
   denormalisatie, geen reindex**.

3. **Canonieke toestandsmachine, server-side afgedwongen.** Toegestane overgangen:
   `draft→published`, `published→deprecated`, `published→withdrawn`, `deprecated→withdrawn`,
   `deprecated→published` (herpublicatie na review); **`withdrawn` = terminaal** (herstel = nieuw
   document). Reden verplicht op alle behalve `draft→published`. Afgedwongen door
   `trg_generiek_status_overgang` (dekt óók de `bronstatus`-as). De bestaande fonds-lifecycle-
   trigger **slaat generiek voortaan over** — één autoriteit per bibliotheek; de fonds-flow
   ongewijzigd. **Deprecate vs withdraw expliciet gescheiden:** de UI-actie "intrekken" (die een
   deprecate was) is hernoemd naar **deprecate** ("Markeer verouderd"); een nieuwe **withdraw**
   (`bronstatus='uitgesloten'`) en **herpubliceren** (deprecated→published) zijn toegevoegd.

4. **Signalering = afgeleide weergave, geen tweede store.** Het curatie-overzicht (verlopen /
   nadert-review / geen-datum / deprecated / withdrawn) wordt **in-app afgeleid** over de al via
   RLS opgehaalde generieke documenten. De bestaande fonds-queue (`fonds_id NOT NULL`) wordt
   **niet** verruimd (zou tenant-RLS raken en de generiek/fonds-scheiding vermengen).
   *Afwijking t.o.v. het plan (een DB-view):* de test-DB draait op **PostgreSQL 14**, waar een
   view geen `security_invoker` kent en dus als *definer* zou draaien (RLS-bypass-geur). In-app
   afleiden is identiek qua uitkomst en veiliger.

5. **Curatierol = hergebruik `platform.generic.library.manage`** (MFA/AAL2 + twee-fasen-audit)
   voor zowel muteren als het overzicht. De fijnmazige splitsing lezen-vs-muteren en het formele
   eigenaarschap van generieke curatie zijn **Increment P** (platform-beheermodule), niet T10.

## Standaard reviewhorizon

Publicatie (create/vervangen/herpubliceren) zonder expliciete `volgende_review` zet een
**standaardhorizon van 12 maanden** (`STANDAARD_REVIEW_MAANDEN`). Bewust een expliciete,
configureerbare governance-default (te valideren met Merlin), zodat verse published-content niet
zónder reviewhandhaving landt. De curator kan altijd een eigen datum opgeven.

## Overwogen alternatieven

- **Waarschuwen i.p.v. blokkeren** — verworpen: laat verouderde content stil als actuele bron
  meekomen (schijnzekerheid; ondermijnt het T10-doel).
- **Muterende job die verlopen content omzet** — verworpen: automatische status-schrijf zonder
  mens in de lus; botst met append-only/human-in-the-loop; read-time is eenvoudiger en zonder bijwerking.
- **Aparte `generiek_status`-kolom / statemachine op een nieuwe kolom** — verworpen (0048): tweede
  bron van waarheid. De poort werkt over de afgeleide status.
- **Fonds-queue verruimen naar `fonds_id` nullable** — verworpen: raakt tenant-RLS + T5-suite en
  vermengt generiek/fonds; een afgeleide weergave hergebruikt het patroon zonder store.
- **DB-view `generiek_review_overzicht`** — verworpen op PG14 (geen `security_invoker`; definer-view
  = RLS-bypass-geur). In-app afleiden gekozen.

## Gevolgen

- **RLS/tenant-isolatie:** ONGEWIJZIGD. Geen policywijziging; de trigger is een extra weigering
  (defense-in-depth), de RPC-gate is additief (verruimt zichtbaarheid nooit). Generiek blijft
  read-only voor fondsen; curatie via de service-role achter withPlatform.
- **Audit:** geen nieuwe logtabel — elke overgang (deprecate/withdraw/herpubliceren) schrijft
  append-only naar `document_metadata_log` (reden verplicht) + `platform_event_log` via
  withPlatform. `volgende_review` toegevoegd aan `RAG_VELDEN` (rag_impact=true bij wijziging).
  **Reden-plicht ook op de vrije edit:** `curatieBijwerken` kan via de status/bronstatus-subset
  een canonieke overgang inhouden; daarom dwingt die actie dezelfde reden-plicht fail-closed af
  wanneer de afgeleide status wijzigt (`generiekTransitieRedenplicht`) en geeft de reden nu ook
  door aan `platform_event_log` (reviewbevinding H1). *Bekend vervolgpunt (M1):* `logMetadata` is
  best-effort ná de commit (pre-existing P1-patroon over álle curatie-acties); wie/wanneer/reden
  overleeft in het fail-closed `platform_event_log`, maar de veld-niveau oud→nieuw-rij niet. Een
  atomische DB-triggeraanpak (zoals T8b) is de nette fix en is bewust buiten T10-scope gehouden.
- **Retrieval (0045):** beide RPC's drop+create (return-kolom `volgende_review` erbij);
  coördineert met T4. **Gedragswijziging (bewust):** generiek published met verstreken review
  valt weg als actuele bron. Fondsdocumenten ondervinden GEEN wijziging.
- **Datamodel/migraties:** `2026_07_10_t10_generiek_transitiepoort.sql` +
  `2026_07_10_t10_retrieval_review_verval.sql` (beide + `_ROLLBACK`), idempotent, migratie-eerst.
  Volgorde: transitiepoort → retrieval_review_verval. `schema.sql` bijgewerkt als documentatie.
- **Test:** `supabase/checks/2026_07_10_t10_review_verval.sql` (R1 verlopen onzichtbaar in beide
  RPC's, R2/R3 regressie, P1 poort weigert withdrawn→published / staat published→deprecated toe),
  gebundeld in `scripts/cross-tenant-ci.sh`. `lib/generiek-status.sanity.ts` uitgebreid met de
  transitiematrix + review-verval (11/11 groen). `tsc --noEmit --skipLibCheck` exit 0.
- **Procesmatig geborgd (T10) vs Increment P:** T10 levert het redactieproces op de contentlaag
  (statusmachine, review-verval, curatie-overzicht). De **brede platform-curatie-UI**, rolsplitsing
  lezen-vs-muteren en formeel eigenaarschap van de curatierol horen bij Increment P.

## Referenties

- Migraties: `supabase/migrations/2026_07_10_t10_generiek_transitiepoort.sql`,
  `.../2026_07_10_t10_retrieval_review_verval.sql` (+ `_ROLLBACK`).
- Code: `lib/generiek-status.ts` (transitieset + verval-/signaal-helpers), `lib/rag.ts`
  (review-verval in de guard + plumbing), `app/(platform)/platform/(beveiligd)/generieke-bibliotheek/`
  (`acties.ts`: deprecate/withdraw/herpubliceren; `_components/GeneriekeBibliotheekClient.tsx`:
  overzicht + acties).
- Test: `supabase/checks/2026_07_10_t10_review_verval.sql`, `lib/generiek-status.sanity.ts`.
- Voorafgaand: `decisions/0048` (afgeleide status), `0045` (published-gate + namespace),
  `0040` (B3), beslisnotitie v0.4 §7/§9/§11.
