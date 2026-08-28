# 0192 — governance_events als tenantketen (DB-gevulde fonds_id, strikte WITH CHECK)

| | |
|---|---|
| **Status** | **Vastgesteld 2026-08-27** |
| **Datum** | 2026-08-27 |
| **Spoor** | W · voorwaarde voor #183b spoor T (de 12 bewijsketen-writes) |
| **Volgt op** | 0190 (audit-doeltabel), 0191 (handelingstabel + auth.uid-schrijfpad) |
| **Raakt** | V3 (grants-gate, C-01) · R-22 (actor-in-hash) — beide buiten scope, zie §6 |

## 1. Context

`governance_events` is de bewijsketen (0190). Zichtbaarheid loopt vandaag
**uitsluitend via `decision_id`**: policy `fonds governance_events` scopet
zowel `USING` als `WITH CHECK` op
`decision_id IN (SELECT decision_objects.id WHERE decision_objects.fonds_id = <mijn fonds>)`.
De tabel heeft **geen `fonds_id`-kolom**.

11 van de 12 #183b-handlers (`agendapunten`, `inbreng`, `notulen`,
`organisatieprofiel`, `vergaderingen`) zijn **niet** besluit-gebonden; alleen
`stemmingen` draagt een `decision_id`. Een ketengebeurtenis met
`decision_id IS NULL` matcht geen policy en is voor elke tenantgebruiker
onzichtbaar. Twaalf inserts toevoegen zonder dit op te lossen levert dus
**write-only rijen** — een keten die het portaal niet kan tonen. Dat is erger
dan geen regel schrijven, want het gat lijkt dan gedicht.

**Nagemeten (tegen `origin/main@9288945`):**
- De bestaande `governance_events`-writes gebruiken `ctx.supabase`, de
  **gebruikersgescopete** client — 37 voorkomens in 25 bestanden. Ze zijn dus
  RLS-onderworpen, inclusief `WITH CHECK`.
- **SQL-kant:** **nul** `insert into governance_events` in `supabase/` — geen
  functie, geen seed, geen migratie. Er is dus geen niet-user-scoped schrijfpad
  dat op de nieuwe trigger (pad 2) stukloopt; pad 2 is puur een defensieve
  fallback.
- De policy is `FOR ALL` met zowel `USING` als `WITH CHECK`. `USING` geldt
  daarmee óók voor UPDATE/DELETE — die zijn door de immutability-triggers
  geblokkeerd, dus zonder effect (en de C-01-grant blijft terecht bij V3).
- `fn_govevent_immutable` doet een **onvoorwaardelijke** `raise exception`;
  `trg_govevent_no_update`/`trg_govevent_no_delete` blokkeren daarmee elke
  UPDATE/DELETE. Een backfill van een nieuwe kolom op bestaande rijen is
  onmogelijk zonder die trigger te slopen.
- `fn_govevent_hash` hasht `event_type | decision_id | object_type | object_id |
  oude_waarde | nieuwe_waarde | tijdstip` — géén `fonds_id`.

## 2. Besluit

`governance_events` wordt een **tenantketen**. We voegen een **nullable**
`fonds_id` toe, laten de **database** hem vullen (niet de 25 aanroepplekken), en
maken de policy **asymmetrisch**.

### 2a. Kolom — nullable, geen backfill
`fonds_id uuid` (nullable) met FK naar `fondsen(id)`. **Geen** data-migratie op
bestaande rijen: de immutable-trigger blokkeert het, en de `USING`-OR-tak
(§2c) houdt de bestaande, sleutelloze rijen zichtbaar. Alleen nieuwe rijen
dragen de sleutel.

### 2b. Vulling door de DB — BEFORE INSERT-trigger, `SECURITY INVOKER`, met consistentie-invariant
Een `BEFORE INSERT`-trigger bepaalt `fonds_id` met **dalende autoriteit** — de
aanroeper is nooit leidend (defense-in-depth). Twee dingen die het naïeve patroon
níét vangt en die hier expliciet in de trigger horen:

**(i) `SECURITY INVOKER`, niet `DEFINER`.** `fn_schrijf_handeling` is `DEFINER`
omdat het een RPC is die `authenticated` mag aanroepen en naar een tabel schrijft
waar de aanroeper niet direct in mag. Een `BEFORE INSERT`-trigger zit al *binnen*
de insert; dat argument geldt hier niet. Wat de functie leest, mag de aanroeper
onder INVOKER gewoon zien: het sessiepad leest de **eigen** `profielen`-rij (policy
`profiel select eigen`, `auth.uid() = id`); de fallback leest `decision_objects`,
dat de gebruiker voor het **eigen** fonds mag zien (policy `fonds decision_objects`).
Er is geen reden voor DEFINER. Context: VEN-4a telde 45 `SECURITY DEFINER`-functies
waarvan 20 nooit geïnventariseerd; er geen 46e bij zetten zonder noodzaak.

**(ii) Consistentie tegen de OR-lek — een composite FK, niet een triggercheck
(I5/§4.5; correctie in §2e).** De asymmetrische policy (§2c) geeft een rij twee
zichtbaarheidsroutes: `fonds_id` én `decision_id`. Zonder extra maatregel zou een
gebruiker in fonds A een event met een `decision_id` uit fonds B kunnen invoegen:
pad 1 vult `fonds_id = A`, de strikte `WITH CHECK` slaagt (eigen fonds), en de rij
is daarna leesbaar voor **beide** tenants — voor A via de `fonds_id`-tak, voor B via
de `decision_id`-tak van `USING`. Een cross-tenant leesbare rij. Dat wordt
**declaratief** gesloten met een **composite foreign key** `(decision_id, fonds_id)
→ decision_objects(id, fonds_id)`: een `decision_id` mag alleen bij het eigen fonds
horen. Eén plek voor de regel, dekt **álle** paden (ook service-role, dat een
`WITH CHECK` niet raakt), en kan niet stil regresseren zoals een triggerfunctie.
`MATCH SIMPLE` (default) slaat de toets over bij `decision_id IS NULL` — precies
gewenst voor niet-besluit-gebonden gebeurtenissen.

De trigger `fn_govevent_fonds` **leidt daarom alleen `fonds_id` af** (dalende
autoriteit); de handhaving zit in de constraint.

```sql
create or replace function public.fn_govevent_fonds()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_fonds uuid;
begin
  -- Bepaal fonds_id met DALENDE AUTORITEIT — de aanroeper is nooit leidend.
  if v_uid is not null then
    select fonds_id into v_fonds from public.profielen where id = v_uid;   -- sessie: overschrijf (anti-spoof)
  elsif new.fonds_id is not null then
    v_fonds := new.fonds_id;                                               -- service-role: brontrigger zette fonds
  elsif new.decision_id is not null then
    select fonds_id into v_fonds from public.decision_objects where id = new.decision_id;
  end if;
  new.fonds_id := v_fonds;
  if new.fonds_id is null then
    raise exception 'governance_events: fonds_id niet af te leiden';
  end if;
  return new;                                 -- consistentie: composite FK, niet hier
end;
$$;

create trigger trg_govevent_fonds
  before insert on public.governance_events
  for each row execute function public.fn_govevent_fonds();

-- Handhaving fonds/decision-consistentie (I5/§4.5) — declaratief, één plek.
alter table public.decision_objects
  add constraint decision_objects_id_fonds_uniek unique (id, fonds_id);   -- FK-doel (id is al PK)
alter table public.governance_events
  add constraint governance_events_decision_zelfde_fonds
  foreign key (decision_id, fonds_id) references public.decision_objects (id, fonds_id);
  -- MATCH SIMPLE: decision_id IS NULL slaat de toets over.
```

**Drie trappen, dalende autoriteit — géén poort op wíé schrijft** (dat zou een stil
gat zijn), maar afleiding uit de best beschikbare autoriteit, en altijd een event:
- **Sessie** (`auth.uid()` gezet): fonds uit het profiel, meegegeven waarde overschreven.
- **Service-role** (geen sessie): fonds = wat de brontabel-trigger uit zijn eigen rij
  zette. Een service-role-schrijver (import, backfill, **CI-fixture**) produceert zo
  gewoon een event — dekking, geen stil gat, geen sessiepoort.
- **Niets afleidbaar**: `raise`.

De **composite FK** valideert in alle gevallen dat een gezet `decision_id` bij het
bepaalde `fonds_id` hoort; op het service-role-pad mét `decision_id` komen beide uit
dezelfde besluit-rij, dus dan is de toets vacuüm. **Trade-off (bewust):** de
handhavingsfout is een FK-schending (SQLSTATE 23503) i.p.v. de generieke `GV001` —
minder schoon qua melding, maar de app-laag geeft cross-tenant-writes toch een
generiek antwoord, en de FK-detail echoot alleen de door de client zélf ingestuurde
sleutel (bevestigt geen bestaan in een ander fonds). Dat weegt niet op tegen: één
plek, alle paden, geen stille regressie.

**Volgorde klopt.** `BEFORE ROW`-triggers draaien vóór de RLS-`WITH CHECK`, dus
de check ziet de gevulde rij. De volgorde t.o.v. `trg_govevent_hash` is
irrelevant — `fonds_id` zit niet in de hashformule (§2d).

### 2b (iii). STAANDE REGEL — twee gescheiden vragen bij elke ketentrigger
Bij elke brontabel-trigger die `governance_events` schrijft, staan twee **losse**
vragen die niet mogen worden verward — een poort op *wíé* schrijft is een stil gat,
een poort op *wát* verandert is een afbakening.

1. **Fonds-afleidbaarheid (correctheid van de rij).** `fn_govevent_fonds` kent maar
   twee eigen bronnen (`auth.uid()`, `decision_id`); een service-role-write die geen
   van beide heeft, zou raisen en de mutatie meesleuren. Dat is **geen reden voor een
   sessiepoort** (die laat de auditregel stilzwijgend weg voor een klasse schrijvers —
   precies het gat dat fail-closed juist wil vermijden). De oplossing is generiek:
   **de brontabel-trigger zet `fonds_id` uit zijn eigen rij** (bv. agendapunt →
   vergadering → fonds), en de drietrapsregel (§2b) accepteert dat op het
   service-role-pad. Zo produceert elk pad een event; niets valt stil weg.

2. **Is dit een bestuurlijk feit (semantische scope).** Een tabel kan mutaties
   dragen die géén ketengebeurtenis zijn (de ingest-churn op `documenten`:
   status/chunks/`geindexeerd`). Die horen niet in de keten — niet omwille van wie
   schrijft, maar omwille van wat verandert. Bak dat af met een **`WHEN` op de
   toestandsverandering** (`documenten`: `WHEN (OLD.actief IS DISTINCT FROM NEW.actief)`),
   nooit op de schrijver.

> Voor elke tabel die een ketentrigger krijgt: (a) laat de brontrigger `fonds_id`
> zetten uit zijn eigen rij, zodat service-role-paden dekking krijgen i.p.v. een
> sessiepoort; (b) bepaal met tracering welke mutaties op die tabel géén bestuurlijk
> feit zijn en sluit die uit met een `WHEN` op de verandering. Neem niet aan dat
> "X aanmaken een gebruikershandeling is" (onjuist gebleken voor `documenten` én
> `agendapunten`) — maar de conclusie daaruit is (a), niet een poort op de schrijver.

### 2c. Policy — asymmetrisch
- **`USING`:** `fonds_id = <mijn fonds> OR decision_id IN (…)` — de OR-tak houdt
  de bestaande, sleutelloze rijen zichtbaar.
- **`WITH CHECK`:** `fonds_id = <mijn fonds>` — **strikt**, zonder OR-tak. Elke
  nieuwe rij draagt de sleutel, zonder uitzondering.

Waar `<mijn fonds>` = `(SELECT profielen.fonds_id FROM profielen WHERE profielen.id = auth.uid())`.

### 2d. `fonds_id` blijft buiten de hash
De **hashformule** van `fn_govevent_hash` wordt **niet** gewijzigd. De kolom zit
niet in de formule; toevoegen zou bestaande hashes onverifieerbaar maken tegen de
nieuwe formule, zonder bewijswinst. (Actor-in-hash is een aparte kwestie — R-22, §6.)

**Wel één gerichte reparatie (AMENDEMENT 2026-08-27, na preview-run).** De
preview-run legde een **latent gebrek** in `fn_govevent_hash` bloot: het riep
`digest()` **ongekwalificeerd** aan. Dat werkte via PostgREST (de `authenticated`-rol
draagt `extensions` in zijn search_path), maar faalt met `42883` zodra de hash-trigger
geneste wordt aangeroepen vanuit een brontabel-trigger die een **gepinde** search_path
zonder `extensions` zet (0182-hardening). Fix: `extensions.digest(…)`, exact zoals
`fn_platform_event_hash` sinds `2026_08_15` al doet. **Zelfde functie ⇒ identieke
hashuitkomst ⇒ geen ketenbreuk**; bestaande hashes blijven verifieerbaar. Migratie
`2026_08_27_govevent_hash_extensions_qualify.sql`. Dit is de hardening die de
brontabel-triggers noodzakelijk maakten, geen formulewijziging.

### 2e. Gate-classificatie (AMENDEMENT 2026-08-27, na preview-run)
De preview-run liet `2026_07_31_r1_structurele_gates.sql` **GATE A2** falen op
`governance_events`: A2 eist dat de `WITH CHECK` de parenttabel (`decision_objects`)
noemt, terwijl 0192 die bewust strikt op `fonds_id` maakt. Dat is geen
policy-fout maar een **verouderde classificatie**: A(1/2) geldt uitsluitend voor
tenanttabellen **zonder eigen fonds_id**, en `governance_events` heeft er nu één.

**Besluit:** `governance_events` verhuist van **GATE A** (parent-afgeleid) naar
**GATE B** (eigen fonds_id) — verwijderd uit het A-register. Gevolg: A1 slaat hem
over (fonds_id-kolom aanwezig), A2 checkt hem niet meer, en Gate B dekt hem
(`WITH CHECK` noemt `fonds_id` → slaagt). Geen verzwakking: Gate B is echte dekking.

**Wat A2 hier statisch borgde en waar het nu zit.** A2's WITH-CHECK-eis
(parent noemen) blokkeerde cross-tenant **decision_id**-injectie: een rij met
`fonds_id = eigen` maar `decision_id` van een ander fonds, die via de `USING`-OR-tak
voor die tweede tenant leesbaar zou worden. Die bescherming zit nu in de
**composite FK** (§2b (ii)) — zie de correctie hieronder.

**CORRECTIE op §2b (append-only, 2026-08-27) — handhaving via composite FK, niet
via een triggercheck.** Een eerdere vorm van §2b legde de fonds/decision-consistentie
in een `raise` binnen `fn_govevent_fonds`. Afgewogen tegen twee alternatieven:
*A — trigger* (dekt alle paden, maar is code: kan stil regresseren bij een `alter`,
en een statische gate ziet hem niet); *B — decision_id terug in de `WITH CHECK`*
(statisch, maar dekt service-role niet, en is een **tweede vorm van dezelfde regel**
die A maskeert). **Gekozen: C — composite FK** `(decision_id, fonds_id) →
decision_objects(id, fonds_id)`, precies de vorm die **I5/§4.5** voorschrijft
("constraint waar het kan"). C dekt álle paden (constraints kennen geen
RLS-bypass), is **declaratief** (kan niet stil regresseren), en is **één** plek voor
de regel. De trigger blijft bestaan voor wat hij écht doet — `fonds_id` afleiden —
de handhaving verhuist naar de constraint. Reden voor deze correctie: een
besluitrecord maakt wijzigingen navolgbaar, niet onmogelijk; I5 schreef de
constraintvorm al voor en is hier voor het eerst van toepassing.

Verificaties die C dragen (beide bevestigd): `decision_objects.fonds_id` is `NOT NULL`
(FK-doel legbaar naast de bestaande PK op `id`); bestaande `governance_events`-rijen
dragen `fonds_id = NULL` (geen backfill) → `MATCH SIMPLE` slaat ze over → `ADD
CONSTRAINT` is schoon.

De **gedragstest (§15) blijft onverkort nodig**, in beide richtingen: fonds/decision-
mismatch → geweigerd (nu een FK-schending, SQLSTATE 23503), plus de positieve spiegel
(eigen-fonds schrijft slaagt en is tenant-zichtbaar). De test bewijst de **uitkomst**,
niet het mechanisme — dat is precies het punt.

## 3. Waarom asymmetrie en niet symmetrie

Een symmetrische policy — `fonds_id = … OR decision_id IN (…)` óók in
`WITH CHECK` — is technisch correct maar **convergeert nooit**: een nieuwe rij
kan via de decision-tak alsnog zonder `fonds_id` binnenkomen. Over een jaar heb
je een tabel waarin sommige nieuwe rijen de tenantsleutel dragen en andere niet,
en niets dat het verschil afdwingt. Dan is de kolom toegevoegd zonder de zwakte
op te lossen.

De strikte `WITH CHECK` dwingt convergentie af; de DB-vulling (§2b) zorgt dat
die striktheid **geen enkel van de 25 bestanden breekt** — de trigger vult
`fonds_id` vóór de check draait. De gebruikersgescopete writes (`auth.uid()`
gezet) vallen altijd in pad 1 en slagen dus.

De prijs van de OR-tak in `USING` — twee onafhankelijke zichtbaarheidsroutes —
wordt betaald door de **composite FK** (§2b (ii)): een `decision_id` dat niet bij
het `fonds_id` hoort, wordt declaratief geweigerd. Zonder die constraint zou de
asymmetrie zelf een cross-tenant-lek introduceren; mét de constraint is de OR
structureel dicht.

## 4. Afgewezen alternatieven

- **A — per event een `decision_id` afleiden.** Voor een agendapunt, vergadering
  of notulensegment bestáát vaak geen besluit; er een verzinnen maakt de keten
  onbetrouwbaar precies waar hij betrouwbaar moet zijn.
- **C — aparte tabel voor niet-besluit-gebonden feiten.** 0190/0191 hebben net
  twee sporen gescheiden (`governance_events` = bewijsketen, `handelingen_log` =
  operationeel). Een derde maakt dat weer troebel.
- **Fonds_id door de 25 aanroepplekken laten meegeven.** Verplaatst de
  vertrouwensgrens naar 25 handgetypte plekken en breekt ze alle 25 tegelijk bij
  het strikt maken. De DB-vulling lost beide op.

## 5. Aanbeveling voor het schrijfpad (bindende vorm: #183b, niet hier)

De convergentie hangt aan de trigger, niet aan een helper — dat haalt de policy-
afhankelijkheid uit spoor T. De **vorm** van de write zelf hoort **niet** in dit
besluit: 0192 gaat over de tenantsleutel op `governance_events`. Hoe twaalf
handlers schrijven — een routehelper versus negen plpgsql-triggers die elk een
`nieuwe_waarde`-payload bouwen in een taal zonder typecontrole, buiten de laag die
het team dagelijks bewerkt — is een keuze waarvan je de kosten pas kent als de
per-tabel-inventaris er ligt. Die vorm hier ratificeren betekent 0192 heropenen
als hij tegenvalt, en een heropend besluit is precies wat je niet wilt op de plek
waar de migratie aan hangt.

**Wat wél vaststaat (hard feit, niet onderhandelbaar):** een app-laag routehelper
die `throw`t is **niet fail-closed**. Bij een PostgREST-write is de mutatie al
gecommit vóór de `governance_events`-insert; faalt die insert en `throw`t de
helper, dan krijgt de client een 500 terwijl de data is gewijzigd en de
ketengebeurtenis ontbreekt — **slechter dan fail-open**. Echte atomiciteit vraagt
dat de write in dezelfde transactie zit als de mutatie, dus een **DB-trigger per
brontabel** (zoals `fn_audit_procedure_bewijs_mutation` voor `procedure_bewijs`);
die dekt bovendien directe PostgREST-writes, wat een routehelper per definitie
niet doet. Prijs: ~8–9 triggers met plpgsql-payloads i.p.v. 12 routewijzigingen —
één precedent-trigger is nog geen negen.

**Aanbeveling:** trigger-per-brontabel. **Verplichting (bindt wél):** #183b legt
de schrijfvorm vast **vóór** de handler-sweep begint, met de niet-atomiciteit als
uitgangspunt. Het `event_type`-labelregister met drift-/collisiepoort (#183b §4a)
blijft waardevol ongeacht de vorm — 37 handgetypte strings zijn 37 driftkansen.

## 6. Buiten scope — expliciet geregistreerd, niet stil meegenomen

- **C-01 (→ V3 grants-gate).** `authenticated` houdt `SELECT,INSERT,DELETE,MAINTAIN,UPDATE`
  op `governance_events` (baseline r.12339); `anon` houdt `SELECT,MAINTAIN`
  (r.12338). Verwijderen van bewijs wordt vandaag alleen tegengehouden door
  `trg_govevent_no_delete` — één laag. Het grant-patroon hoort bij V3.
- **R-22 (actor-in-hash).** `fn_govevent_hash` dekt `actor_id`/`actor_naam` niet;
  het zegel bewijst wát er is vastgelegd, niet wie. Wijzigen van de formule maakt
  bestaande rijen onverifieerbaar — een eigen besluit met versieveld, geen
  bijvangst van dit besluit of van #183b.

## 7. Migratie-checklist (uitvoering in #183b spoor T)

- [x] Migratie `+ ROLLBACK`: `fonds_id uuid` (nullable) + FK; **geen** backfill.
- [x] `fn_govevent_fonds()` + `trg_govevent_fonds` (BEFORE INSERT, **SECURITY
      INVOKER**) — leidt **alleen `fonds_id` af**; de fonds/decision-consistentie is
      de **composite FK** `governance_events_decision_zelfde_fonds` (§2b (ii), 2e).
- [x] Policy `fonds governance_events` herschrijven: `USING` met OR-tak,
      `WITH CHECK` strikt op `fonds_id`.
- [x] Gate-classificatie: `governance_events` uit A-register → GATE B (§2e).
- [ ] Verificatie **in de §15-suite** (niet als losse handmatige controle):
      (a) bestaande user-scoped write slaagt (fonds gevuld);
      (b) insert met `auth.uid()` null, zonder brontrigger-fonds én zonder `decision_id` faalt;
      (c) **cross-tenant:** gebruiker fonds A met `decision_id` uit fonds B faalt
      (composite FK, SQLSTATE 23503) — beide richtingen (positieve spiegel: eigen-fonds slaagt, tenant-zichtbaar).
- [ ] Schrijfvorm door **#183b** vastgelegd vóór de handler-sweep (aanbeveling §5:
      trigger-per-brontabel; niet-atomiciteit als uitgangspunt); `event_type`-register
      met drift-/collisiepoort waar de `event_type` wordt gezet.
- [ ] Previewwaarneming (OMG-1): nieuwe rij is zichtbaar voor de tenantgebruiker,
      en **niet** voor een tweede tenant.
