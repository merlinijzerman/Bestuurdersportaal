# 0218 — Zoekpad R1: `zoek_chunks_begrensd`, RLS-behoudende versnelling van het tekstzoeken achter een vlag

- **Status:** Geaccepteerd voor bouwen en lokaal testen; Preview-migratie en merge zijn aparte akkoorden; Productie na nulmeting en apart akkoord
- **Datum:** 2026-10-03
- **Betrokkenen:** opdrachtgever (beslisser), Claude Code (implementatie)
- **Besluit 0217** is hiermee **deels besloten**: de tekstarm (R1) is gekozen; de vectorarm (R1b), de rechtenvraag voor een eventuele R2 en het `plain`-vangnet blijven open.

## Context

`zoek_chunks` is een `LANGUAGE sql`-functie onder RLS. Postgres plant het lichaam
zonder parameterwaarden, schat de chunkscan op 1 rij en kiest een nested loop die
`documenten` per chunkrij opnieuw scant (PR0-rapport H1: 57k buffers per aanroep
op 25k chunks; Productie 0,8–1,0 s warm, uitschieters tot 8,6 s tegen een
`statement_timeout` van 8 s). PR0 (#526) heeft gemeten dat een id-begrensde,
RLS-behoudende vorm (R1) de FTS-arm naar O(zichtbare chunks) brengt (≈ 5–6k
buffers) zónder dat de beveiligingsgrens verschuift; de `SECURITY DEFINER`-route
(R2) is sneller maar verplaatst de tenantgrens naar functiecode + ACL (H-18) en
lekt bij een EXECUTE-grant aan een rol zonder tabelgrants.

Randvoorwaarden: tenant-isolatie via RLS blijft primair (CLAUDE.md), géén
`SECURITY DEFINER`, bestaande aanroepvormen/regexen/checks blijven geldig,
uitrol per fonds terugdraaibaar, en elke afwijking van het oude gedrag is
expliciet en getest.

## Besluit

1. **R1, als aparte functie `public.zoek_chunks_begrensd`** naast `zoek_chunks`
   (die ongewijzigd blijft): exact dezelfde 10 parameters (namen/typen/defaults)
   en dezelfde 23 retourkolommen (naam/type/volgorde). plpgsql, `STABLE`,
   `SECURITY INVOKER`, `set search_path = public, pg_temp`, geen GUC's/`set_config`.
   Twee stappen: toelaatbare document-id's uit `documenten` onder RLS (alleen
   `actief` en documentscope), daarna de chunks via `document_id = any(…)`
   gejoind met een **gematerialiseerde CTE** van diezelfde documentrijen, met de
   tsquery als variabele en het volledige oude filterblok letterlijk (incl.
   `p_fonds_id`-clausule en generiek/review-regel).
   *Planbewijs (lokaal, PR0-fixture 25.471 chunks, `authenticated`):* de
   array+join-vorm zonder CTE kreeg in het custom plan (eerste vijf aanroepen
   per backend) bij een rows=1-schatting een nested loop met `Seq Scan on
   documenten` per rakende chunkrij — de R0-vorm, begrensd tot de treffers.
   Daarom de CTE: generiek plan = CTE Scan (74 documenten) → Index Scan
   `idx_chunks_document` per document, 6,0k buffers; custom plan = één seq scan
   over de chunks met de id-array als filter (75 % van de tabel is zichtbaar) →
   CTE Scan, 6,9k buffers; in geen van beide een scan op `documenten` per
   chunkrij (`tests/karakterisering/uitvoer/zoekpad-r1/planbewijs-b0.txt`).
   Afwijking van de letter van de bouwgate: de planner kiest een plain Index
   Scan, geen Bitmap Index Scan; buffers (6,0k) liggen op R1-niveau (PR0 R1:
   5,4k; R0: 57k).
2. **Vlag — waarheidstabel** (`core/lib/retrieval/zoektekst-vlag.ts`, één bron
   voor fondsconfig én retrievalkern; de kern past de hoofdstop opnieuw toe):

   | env `ZOEK_TEKST_V2` | fondsvlag `zoek_tekst_v2` | effect |
   |---|---|---|
   | ontbreekt / ≠ `on` | (wat dan ook) | **uit** — env is de hoofdstop |
   | `on` | ontbreekt | **uit** — geen stille omschakeling |
   | `on` | `false` | uit |
   | `on` | `true` | **aan** — alleen dit (pilot)fonds |

   Beide schakelaars staan standaard uit; het pad is **alleen aan bij env `on`
   én fondsvlag `true`** (besluit opdrachtgever 04-10-2026, correctie op de
   eerste PR-versie waarin env `on` + ontbrekende fondsvlag "aan" was). Env
   `on` alleen schakelt dus geen enkel fonds om; fondsen zonder vlagrij
   blijven op `zoek_chunks`. Ook een aanroeper zonder fondsresolutie
   (meegegeven vlag ontbreekt) blijft uit. Standaard uit. Met de vlag uit roept de app de functie nooit aan en zijn de
   karakteriseringssnapshots byte-gelijk.
3. **Limiet — expliciete afwijzing.** `p_limit > 1000` ⇒ `raise exception`
   met SQLSTATE `P0R01` ('zoek_chunks_begrensd: p_limit > 1000'), niet stil
   afgekapt. `zoek_chunks` kent geen bovengrens (accepteert 1001). De ondergrens
   `greatest(p_limit, 1)` is identiek (null/0/−5 ⇒ 1 rij). De app vraagt
   maximaal `max(3 × maxResults, 20)` ≤ 60 rijen.
4. **Tiebreaker `, c.id`** op de sortering (lijn 0139): alleen bínnen gelijke
   `(rang, chunk_index)` wijkt de id-volgorde af van `zoek_chunks`; buiten
   tie-groepen is de id-reeks identiek. Pariteit wordt daarom gemeten op
   id-set + geordende `(rang, chunk_index)`-reeks + id-set per tie-groep.
5. **Scanbewijs blijft app-side** (`filterOpScanbewijs`), net als bij
   `zoek_chunks`; de vangnetten `plain`/`ilike`, de #516-begrenzing,
   `voerFtsPogingenUit`, `handhaafFondsdiscipline`, `maakHybrideRpc` en de
   fasenamen zijn ongewijzigd. Geen schaduwmodus met dubbele aanroepen.
6. **ACL-pariteit, inclusief `service_role`:** `revoke all … from public, anon;
   grant execute … to authenticated, service_role` — byte-gelijk aan
   `zoek_chunks` (drie allowlistregels naar het bestaande patroon). De
   #505-matrixverwachting (`service_role` ziet de volledige, door `p_fonds_id`
   begrensde set; `portaal_beperkt` 42501) blijft zo gelijk.
7. **Auditmarker en terugval.** Alleen met de vlag aan draagt
   `retrieval_meta.invoer.retrieval_fasetijden.tekstzoekpad` de waarde `nieuw`
   of `fallback_pgrst202` (gesloten enum; migratievrij op basisniveau; in
   dezelfde `[retrieval][fasetijden]`-logregel bij dezelfde correlatie-id).
   Ontbreekt de functie in de database (PostgREST `PGRST202`), dan valt de
   retrieval **éénmaal** terug op `zoek_chunks` (request-lokale grendel, ook
   voor de speculatieve terugvalpoging), met precies één warn-regel
   `[retrieval][tekstzoekpad]`; de r1-releasecheck telt `fallback_pgrst202`
   én `db_timeout` rood. Elke andere fout wordt niet gemaskeerd.

## Overwogen alternatieven

- **R2 (`SECURITY DEFINER`, GIN)** — niet gekozen: verplaatst de tenantgrens
  naar functiecode + ACL (0216, H-18), lekt gemeten bij een EXECUTE-grant aan
  `portaal_beperkt`, is leeg voor `service_role`. Blijft een optie in 0217.
- **`zoek_chunks` zelf herschrijven** — niet gekozen: elf aanroepers/checks
  pinnen de bestaande functie (md5-pin, allowlist, drift-pins, T4/T10/G20/#500/
  #505); een nieuwe naam achter een vlag maakt uitrol per fonds en rollback
  zonder appwijziging mogelijk.
- **Array + join zonder CTE** — gemeten en verworpen (zie planbewijs onder 1).
- **Stil afkappen op 1.000** — verworpen: een stille afwijking is niet te
  onderscheiden van "er was niet meer"; de afwijzing is zichtbaar en getest.
- **Schaduwmodus (oud én nieuw aanroepen, vergelijken)** — verworpen: dubbele
  volscans onder RLS op Productie, precies wat deze PR bestrijdt.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd — de functie is INVOKER en voegt alleen
  filters toe. Bewijs onder echte RLS: `supabase/checks/2026_10_03_r1_zoektekst_pariteit.sql`
  (8 actoren × 11 scenario's nieuw == oud; sectie-M-filtermatrix van #500;
  negatieve controles via pg_temp-kopie met één clausule uit ⇒ rood, met
  `fonds` bij het eigen fonds gedocumenteerd als `rls_dekt` en `actief`/`scope`
  als `dubbel_gedekt`; catalogus-pin; limietafwijzing; tiebreaker), plus de
  rollbackrondgang in `scripts/cross-tenant-ci.sh`.
- **Performance (lokaal, bouwgate — geen productievoorspelling):** CI-light
  `2026_10_03_r1_zoektekst_performance.sql` (strikt 25 runs p95 < 500 ms,
  buffers ≤ 1/3 oud, plan-assert); lokale meting b0/b5000/cpu025 in de PR-body.
- **Audit:** nieuwe gesloten sleutel `tekstzoekpad` onder een bestaand
  basisobject; geen migratie, geen nieuw event-type.
- **Datamodel/migratie:** `2026_10_03_r1_zoek_chunks_begrensd.sql` (idempotent,
  fail-closed catalogusvergelijking) + rollback; `schema.sql` als documentatie.
- **Deployvolgorde:** Preview-migratie en merge zijn aparte akkoorden;
  fidelitypin +2 regels (functie + comment). Productie: nulmeting
  (`2026_10_03_r1_releasecheck_productie.sql`) → migratie met vlag uit →
  nameting ≤ 12 aanroepen → env `ZOEK_TEKST_V2=on` in Vercel (verwacht: nog
  geen enkele beurt met marker `nieuw`, want geen fonds heeft de vlag) →
  fondsvlag `zoek_tekst_v2 = true` uitsluitend op het gekozen pilotfonds →
  releasecheck (marker `nieuw` alleen bij dat fonds). Terugdraaien: fondsvlag
  op `false` mét versie + 1 (per fonds; geaudit via `fonds_config_log`) of env
  `off` (hoofdstop, alle fondsen). Niet verwijderen: een delete wordt niet
  geaudit en opnieuw aanzetten botst dan op `fonds_config_log_versie_uniek`
  (gevonden in CI, 04-10-2026).
- **Niet opgelost door deze PR:** #500 blijft open tot R1b (vectorarm) en de
  pilot; de FTS blijft O(zichtbare chunks) (geen GIN onder RLS); het
  `plain`-vangnet (H7) blijft een apart issue.

## Referenties

- `ZOEKPAD-HERONTWERP-PR0-RAPPORT.md`, `decisions/0217-zoekpad-twee-fasen-CONCEPT.md`, 0216, 0139
- `supabase/migrations/2026_10_03_r1_zoek_chunks_begrensd.sql`, `supabase/rollbacks/…_ROLLBACK.sql`
- `core/lib/retrieval/zoektekst-vlag.ts`, `core/lib/rag.ts` (`maakTekstRpc`), `core/lib/retrieval/fasetijden.ts`
- `tests/cross-tenant/retrieval-r1-zoektekst.test.ts`, `tests/karakterisering/zoekpad-r1-pariteit.mjs`
- `supabase/checks/2026_10_03_r1_zoektekst_{pariteit,performance,releasecheck_productie}.sql`
