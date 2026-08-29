# RLS-reikwijdtemeting — capability-bewaakte staat op `for all`-fonds-only tabellen

**Bij:** #214 (RLS-schrijfpoort; door PR-D bewust hierheen belegd). **Verwant:** wrapperspoor #209/#212, PR-C-review 0192, 0193 §P4-aansluiting.
**Aard:** meting, geen tranche — er wordt niets gefixt. **Peildatum:** 2026-08-28.
**Bronnen:** `supabase/baseline/2026_08_14_preview_public.sql` (prod-gelijke pg_dump) + alle migraties erna; PR-C op `epic/proceduremodule-v2` (`2026_08_27_p3c_01/02`). Capabilities uit `app/api/**/route.ts` op de epic-branch.

## Meetvraag

Per tabel met een `for all`-policy die alleen fondsisolatie afdwingt: draagt hij toestand die een route-level capability geacht wordt te bewaken, en is die kolom op DB-niveau beschermd (kolomprivilege, trigger, of niets)? Het aanvalsmodel is één directe PostgREST-mutatie door een **geauthenticeerd fondslid** (geldige JWT, lid van het fonds) dat de route — en dus de capability, de inner rolgate en de RPC — overslaat. PostgREST toetst alleen JWT + RLS, nooit de applicatie-capability.

## Meting

| Tabel | Policyvorm | Bewaakte kolom(men) | Route-capability die hem geacht wordt te bewaken | Feitelijke DB-bescherming | Oordeel |
|---|---|---|---|---|---|
| **procedure_stappen** | `fonds proc stappen` — FOR ALL, **fonds-only** via `procedure_id→procedures.fonds_id` (USING=WITH CHECK); geen kolomconstraint | `status`, `voltooid_op`, `voltooid_door`, `heropend_op`; (epic) `afgerond_met_afwijking`, `afwijking_motivering`, `afwijking_snapshot`, `afwijking_door` | `procedures.manage` (PATCH stap / heropenen) **en** `procedures.afwijking.vastleggen` (voorzitter+bestuurder) via RPC `fn_stap_afronden_met_afwijking` (SECURITY DEFINER, eigen slot + inner rolgate) | **GEEN.** Geen trigger; status-CHECK zónder transitiewacht; motivering-CHECK ≥10 tekens triviaal te voldoen; `authenticated` heeft table-UPDATE, geen kolom-REVOKE. p3c_01 zegt letterlijk: *"GEEN I1-trigger … draagt geen onveranderlijkheidstrigger."* | **VOLLEDIG OPEN — scherpste geval.** Zie hieronder. |
| **procedure_besluiten** | `fonds proc besluiten` — FOR ALL, **fonds-only** via `procedure_id→procedures.fonds_id`; geen kolomconstraint | `formulering`, `motivering`, `datum`, `vastgelegd_door(_naam)`, `decision_id`, `verworpen_alternatieven` | `procedures.manage` (POST besluiten) | **GEEN.** Geen trigger, geen status, geen append-only; `authenticated` heeft UPDATE **én DELETE**, geen kolom-REVOKE | **VOLLEDIG OPEN — zelfde klasse als stappen.** Fondslid kan een besluit invoegen/wijzigen/**verwijderen** (formulering, datum, vastgelegd_door) via directe PostgREST zonder capability. Besluit-verantwoordingsfeit is vervalsbaar én hard te DELETEN (anders dan governance_events). |
| **decision_objects** | `fonds decision_objects` — FOR ALL, **fonds-only** (`fonds_id=profielen.fonds_id`); geen kolomconstraint | `status` (18-staten), `is_primary_decision`, `eigenaar_id`, classificatie-dimensies | `decisions.manage` (POST status) | **Deels.** `trg_decision_status_check` = transitiegraaf-statemachine (weigert *illegale* edges, NIET rol); `trg_decision_snapshot` = append-only hash-snapshot; `trg_decision_touch`. Niet-status-velden: geen guard. `authenticated` UPDATE, geen kolom-REVOKE | **Transitielegaliteit in DB, WIE niet.** Erkend-open referentie (#214). Fondslid kan langs elke *legale* edge de status zetten en `is_primary_decision`/eigenaar/classificatie vrij muteren; alleen illegale sprongen en UPDATE/DELETE van de statushistorie worden geraakt. |
| **procedure_bewijs** | `fonds proc bewijs` — FOR ALL, **fonds-only** via `stap_id→stappen→procedures.fonds_id`; geen kolomconstraint | `requirement_sleutel` (bewijs↔vereiste-binding); herkomst/inhoud (`titel`, `toegevoegd_door`, `stemming_id`); `document_id` | `procedures.manage` (bewijsroute) | **Gedeeltelijk gehard (modelgeval).** `trg_..._validate_binding` (BEFORE INS/UPD): maakt id/stap_id/titel/beschrijving/toegevoegd_op/toegevoegd_door(_naam)/stemming_id immutable **en** valideert `requirement_sleutel` tegen echte vereisten van dezelfde stap/fonds; `trg_..._audit` (AFTER, SECURITY DEFINER) schrijft auditregel in dezelfde transactie — *"óók voor directe PostgREST-writes"* | **WIE nog niet rol-gegate, maar het feit is DB-geborgd.** Geen valse binding en geen ongeaudite mutatie mogelijk. Dít is het patroon dat stappen/besluiten missen (trigger-immutabiliteit + verplichte audit). Restpunt: rol/capability nog niet in DB. |
| **procedure_requirements** | **Niet fonds-only.** Globaal sjabloon: `req read all` (SELECT, ingelogd) + `req write beheerder` (FOR ALL, `profielen.rol='beheerder'` in USING+WITH CHECK) | `verplicht`, `blokkerend`, `requirement_type`, `min_aantal` (sjabloon-bewijslast) | templatebeheer (rol beheerder) | **Rolgate zit in de policy.** Directe PostgREST-write door niet-beheerder faalt op RLS. Geen trigger nodig. Per-fonds maatwerk in `procedure_requirement_instance`: fonds-RLS + rol voorzitter/beheerder in WITH CHECK — óók in-policy | **Niet omzeilbaar.** Eén van de twee tabellen (met `decision_dissent`) waar de rol écht in de policy staat. Bewijst dat het patroon bestaat en simpelweg niet is toegepast op de kern-proceduretabellen. |
| **governance_events** | `fonds governance_events` — FOR ALL, **fonds-only** (WITH CHECK pint `fonds_id`; USING heeft legacy decision_id-OR-tak); geen inhoudsconstraint | de auditketen zelf: `event_type`, `oude_waarde`, `nieuwe_waarde`, `hash`, `actor_id` | n.v.t. — append via brontabel-triggers/RPC's | **Muteren DB-geblokkeerd.** `trg_govevent_no_update` + `trg_govevent_no_delete` (`fn_govevent_immutable` weigert UPDATE/DELETE voor **alle** rollen) + `trg_govevent_hash` (sha256, overschrijft client-hash) + `trg_govevent_fonds` (leidt fonds_id server-side af, anti-spoof) + composite FK `(decision_id,fonds_id)`. UPDATE/DELETE-grant is dood door de triggers | **Muteren + tenant-sleutel DB-beschermd; append-authenticiteit route-only.** Geschiedenis onwijzigbaar en tamper-evident. Restrisico (lichtere klasse): fondslid kan binnen eigen fonds een **nieuwe** valse event INSERT'en — wie mag appenden is route-only — maar niet heimelijk herschrijven. |
| **procedure_vaststelling** | **n.v.t. — tabel bestaat niet** (0 refs in SQL/code) | — | — | — | **Geen object om te meten.** "Vaststelling/vastgesteld" is geen aparte tabel; de toestand leeft als `decision_objects.status` en in `procedure_besluiten`. *Aanbeveling:* wordt vaststelling in P4 een eigen verantwoordingsfeit, ontwerp het mét in-DB bescherming (trigger + rolgate), niet als open fonds-only tabel — anders erft het meteen de procedure_stappen-klasse. |

## Het scherpste geval: procedure_stappen

`procedure_stappen` blijkt **even open als decision_objects — sterker nog, opener**: decision_objects heeft tenminste `trg_decision_status_check` (transitielegaliteit); `procedure_stappen` heeft geen enkele trigger. De status-CHECK somt alleen de toegestane *waarden* op, niet de toegestane *overgangen*.

PR-C's hele constructie leeft in `fn_stap_afronden_met_afwijking` (SECURITY DEFINER, `grant execute … to authenticated`): inner rolgate `rol ∈ {voorzitter, bestuurder}`, fondsgrens, stap-precondition (actief/heropend), motivering ≥10 tekens, kritieke-vereiste-bevestiging, en pas dán de `update … set status='afgerond', afgerond_met_afwijking=…, afwijking_door=…`. Een directe PostgREST-mutatie raakt niets daarvan:

```
PATCH /rest/v1/procedure_stappen?id=eq.<stap>
  { "status":"afgerond", "afgerond_met_afwijking":true,
    "afwijking_motivering":"xxxxxxxxxx", "afwijking_door":"<willekeurige uuid>",
    "voltooid_door":"<willekeurige uuid>", "voltooid_op":"<nu>" }
```

Dit slaagt voor **elk** fondslid met een geldige sessie — óók een rol die de capability `procedures.manage` / `procedures.afwijking.vastleggen` niet heeft (RLS toetst alleen fondslidmaatschap, niet de capability). De capability, de inner rolgate én het RPC-slot worden alle drie omzeild. Het verantwoordingsfeit *"stap afgerond (met afwijking) door X"* is daarmee **vervalsbaar door iedereen in het fonds**.

**Gevolg voor het uitgangspunt.** "De capability-gate is de werkende grens" houdt hier niet: voor `procedure_stappen` en `procedure_besluiten` is de werkende grens de fonds-RLS, en die zegt niets over wie of over legaliteit. Dat ontkracht het uitgangspunt over de volle breedte van de kern-proceduretabellen — precies de familie #209/#212.

## Aansluiting op de tickets

- **#214** is de juiste tranche (PR-D belegde het hier). #214's eigen reikwijdtemeting bevestigt deze meting: van **42** `ALL`-policies dragen er **2** een rolgate (`procedure_requirements`, `decision_dissent`); de overige **40** zijn fonds-only. Deze 7-tabelmeting is de gerichte inzoom op de capability-bewaakte kern.
- **Melden aan het wrapperspoor.** #212 (elke SECURITY DEFINER-functie met `authenticated`-grant moet zelf fonds+rol checken) raakt `fn_stap_afronden_met_afwijking` *niet* — die dóét de checks — maar mist het bredere feit: de functie is irrelevant zolang de onderliggende tabel open is. Voorstel voor een statische gate in dezelfde familie: **een capability-bewaakte kolom op een fonds-only `ALL`-tabel zonder trigger, kolom-REVOKE óf rol-in-policy is ROOD**, tenzij expliciet allowlisted met motivering. Dat maakt de klasse zichtbaar in plaats van stil geslaagd.

## Samengevat oordeel

| Klasse | Tabellen |
|---|---|
| Volledig open — vervalsbaar verantwoordingsfeit | **procedure_stappen, procedure_besluiten** |
| Transitielegaliteit in DB, WIE niet (erkend-open referentie) | decision_objects |
| Feit DB-geborgd (immutabiliteit + audit), WIE nog niet | procedure_bewijs |
| Muteren DB-geblokkeerd (append-only + hash), append route-only | governance_events |
| Rol in de policy — niet omzeilbaar | procedure_requirements |
| Bestaat niet | procedure_vaststelling |

De bewijstabellen laten zien dat álle drie de beschermingsvormen (rol-in-policy, immutabiliteitstrigger, append-only-trigger) elders in ditzelfde schema al bestaan; ze zijn alleen niet toegepast op `procedure_stappen`/`procedure_besluiten`. De fix is dus een tranche onder #214, geen nieuw ontwerp.
