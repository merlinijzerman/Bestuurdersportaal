# Vergaderfunctionaliteit V2 — Ontwerpdocument

> **Status**: Revisie 1.2 — na tweede externe reviewronde (2026-05-18)
> **Datum**: 2026-05-18
> **Scope**: agenderen (vergaderingen, agendapunten, voorbereiding) en de raakvlakken met procedures (Decision Object, besluitvastlegging, auditdossier)
> **Doel**: blueprint voor de doorontwikkelslag van de vergaderfunctionaliteit, opgedeeld in twee tranches die los uitleverbaar zijn. Dit document beschrijft de totale scope zodat hij integraal beoordeeld en gereviewed kan worden voordat er één regel code wordt gewijzigd.

---

## Revisielog

**v1.2 (2026-05-18, tweede externe reviewronde)** — vier gerichte correcties:

1. Notificatietypes semantisch opgeschoond. `volmachtstem_uitgebracht` en `stemronde_ingetrokken` zijn nu **aparte types** (niet meer via payload-varianten onder `stemronde_geopend` resp. `stemronde_gesloten`). Daarmee gaat het totaal van vijf naar zeven nieuwe notificatietypes (§2, §11.1).
2. UPDATE-bevoegdheid op `stem_uitbrengingen` gecorrigeerd: een rij mag alleen door `uitgebracht_door = auth.uid()` worden gewijzigd, niet door de stemgerechtigde. Bij volmacht is de uitbrenger de natuurlijke "eigenaar" van die rij. Plus server-side weigering van een eigen stem als er al een volmachtstem voor de gebruiker bestaat (§7.3, §9).
3. DB-constraint op `volmacht_bevestigd` symmetrisch gemaakt — dwingt nu af dát `volmacht_bevestigd=true` is bij volmacht-rijen, niet alleen dat het uit staat bij eigen rijen (§7.2).
4. Tranche-afhankelijkheid preciezer geformuleerd: tranche 2 is *functioneel zelfstandig*, maar *veronderstelt* de tranche-1-uitbreiding van agendapunten voor eigenaar- en wijziglogica (§5).

**v1.1 (2026-05-18, eerste externe reviewronde)** — verwerkt:

1. Stem-model herontworpen voor volmacht — splitsing `uitgebracht_door` / `stemgerechtigde_id` met `unique(stemming_id, stemgerechtigde_id)`. Reviewer had terecht aangewezen dat de v1.0-constraint volmacht-uitbrenging onmogelijk maakte (§7.2).
2. Volmacht-administratie versterkt — expliciete bevestiging, optionele toelichting, notificatie aan volmachtgever (§7.2 + §7.3).
3. Quorum/meerderheid niet meer als binair veld maar als drie status-velden (`niet_ingesteld | gehaald | niet_gehaald`) plus `besluitregistratie_advies`. UI toont waarschuwing bij niet-gehaald quorum/meerderheid; disclaimer over rechtsgeldigheid in stemverslag (§7.2 + §7.6).
4. Dissent-flow beperkt tot default ja/nee/onthouden — custom alternatieven niet automatisch naar dissent (§7.5).
5. Stemronde-startbevoegdheid heroverwogen — niet "geen restricties" maar voorzitter + beheerder + aanmaker van het agendapunt. Consistent met agendapunt-rechten en met de governance-aard van een stemronde (§7.3).
6. `procedure_bewijs.stemming_id` als expliciete nullable FK i.p.v. impliciete koppeling via `documenttype='stemverslag'` (§7.4 + §8).
7. Snapshot-semantiek herformuleerd — gesloten/ingetrokken stemmingen worden opgenomen in `decision_audit_snapshots.snapshot`-payload op het moment van snapshot-vorming (§7.6).
8. `agendapunt_log` blijft expliciet apart (geen centralisatie in `governance_events`) — open vraag §13.2 sluit (§11.2).
9. Verplaatsen agendapunt met open stemming: server-side geblokkeerd; gesloten stemming: verplaatsen helemaal niet toegestaan (§6.3.2 + §13).
10. Route-paden correct als `[id]/route.ts` overal expliciet (§2 + §6.3).
11. "Drie nieuwe notificatie-types" → vijf, klopt nu (§2 + §11.1).
12. Motivering-minimum: 3 → 10 tekens (§6.3.1 + §6.3.3).
13. Vrije-notities-naar-inbreng: bevestigingsdialoog toegevoegd (§6.2).
14. Verwijderde agendapunten zijn voor iedereen op het fonds zichtbaar via de *Toon verwijderde*-toggle, niet via directe URL voor buitenstaanders (§6.3.3).
15. Acceptatiecriterium ronde § 14 bijgewerkt op stem-modelwijziging.

**v1.0 (2026-05-18, eerste opstelling)** — Vier verbeterthema's samengebracht: documenten openen, vrije notities, agendapunt-CRUD, stemmingen.

---

## 1. Doelpositionering

De vergaderfunctionaliteit is op dit moment voldoende voor het *voorbereiden* van een bestuursvergadering — agendapunten met categorie, stukken met AI-samenvatting, inbreng vooraf, en een persoonlijke voorbereiding per agendapunt. Wat ontbreekt is wat er *tijdens en na* een agendapunt nodig is om de besluitvormingscyclus rond te krijgen: bronstukken inkijken zonder context-switch, ruimte voor scherpe eigen aantekeningen die niet in een AI-lens passen, en het formeel kunnen vastleggen van een stemuitslag die direct doorslaat naar de procedure en het auditdossier.

Tegelijk laat de operationele praktijk zien dat agendapunten geen rotsen zijn: titels worden bijgesteld, een punt verschuift naar de volgende vergadering, of moet alsnog van de agenda. Op dit moment kan dat niet — er is alleen een POST-route voor aanmaken — wat in de praktijk leidt tot dubbele agendapunten of "negeer dit punt"-instructies in de inbreng. Dat is een gat dat dichtgepoetst moet worden voordat het portaal serieus voor een echte vergadering ingezet kan worden.

Tranche 1 dicht de operationele gaten in de bestaande structuur. Tranche 2 voegt een nieuwe stemming-laag toe die de brug slaat tussen vergaderen en het Decision Object. Belangrijk om vooraf vast te leggen: het systeem **rapporteert** quorum en meerderheid maar **stelt geen rechtsgeldigheid vast**. Dat is een bewuste keuze omdat fondsreglementen verschillen, en de UI mag dat onderscheid niet vertroebelen.

---

## 2. Wat blijft, wat verandert, wat komt erbij

### Behouden (geen breaking changes)

- `vergaderingen`, `agendapunten`, `agendapunt_inbreng`, `voorbereidingen` blijven met hun bestaande RLS-policies en velden bestaan.
- BOB-categorisering blijft (beeldvorming / oordeelsvorming / besluitvorming / informatie).
- Persoonlijke AI-voorbereiding met lens-keyed `eigen_notities` blijft werken — er komt een veld náást, niet in plaats van.
- De inzage-route `GET /api/documents/[id]/bestand` blijft de single source of truth voor het openen van een document.
- Koppeling agendapunt → procedure-stap via `agendapunten.procedure_stap_id` (uit iteratie 2 april 2026) blijft de centrale brug.
- Decision Object en zijn statusmodel uit `PROCEDURE-MVP1-ONTWERP.md` blijven het procedure-fundament. Stemmingen koppelen aan een Decision Object via dezelfde keten als agendapunten dat al doen.

### Wijzigt

- `agendapunten` krijgt soft-delete-velden, metadata over wie laatst wijzigde, en een `aangemaakt_door`-FK. Bestaande queries moeten standaard filteren op `verwijderd_op is null`.
- `voorbereidingen` krijgt een vrij notitieveld los van de lens-structuur.
- De bestaande `StukKaart` in `AgendapuntKaart.tsx` wordt klikbaar en linkt naar het origineel.
- De bestaande `procedure_bewijs`-tabel krijgt een nullable `stemming_id`-FK voor expliciete koppeling met stemverslagen (tranche 2).
- `app/api/agendapunten/route.ts` blijft voor POST; er komen aparte routes onder `app/api/agendapunten/[id]/route.ts` voor PATCH/DELETE en sub-routes voor herstellen.
- `lib/auditdossier-html.ts` krijgt een nieuwe sectie *Stemverslagen* per Decision Object. `fn_build_decision_dossier` neemt gesloten en ingetrokken stemmingen mee in de snapshot-payload bij snapshot-vorming.

### Nieuw

| Entiteit | Tabel | Functie |
|---|---|---|
| Stemming | `stemmingen` | Stemronde op een agendapunt. 1-op-veel relatie met uitbrengingen, 0-of-1 met `decision_objects`. |
| Stem | `stem_uitbrengingen` | Individuele stem met `uitgebracht_door` (wie klikt) en `stemgerechtigde_id` (van wie de stem is), volmacht-toelichting, motivering. |
| Agendapunt-log | `agendapunt_log` | Append-only mutatie-log voor agendapunten (gewijzigd, verplaatst, verwijderd, hersteld). |
| Stemverslag-bewijs | bestaande `procedure_bewijs` met expliciete `stemming_id`-FK | Automatisch aangemaakt bij sluiten van een stemming op een agendapunt dat aan een procedure-stap hangt. |

**Zeven nieuwe notificatie-types** in het bestaande `notificaties.type`-enum:

- Tranche 1: `agendapunt_gewijzigd`, `agendapunt_verplaatst`, `agendapunt_verwijderd`
- Tranche 2: `stemronde_geopend`, `stemronde_gesloten`, `stemronde_ingetrokken`, `volmachtstem_uitgebracht`

Aparte types in plaats van payload-varianten — duidelijker voor de gebruiker in notificatiehistorie en eenvoudiger te filteren in toekomstige UX.

---

## 3. Huidige stand — agenderen

### 3.1 Datamodel

```
vergaderingen ──< agendapunten ──< agendapunt_inbreng
                          │    └──< voorbereidingen (per gebruiker, privé)
                          └────── documenten (gekoppeld via agendapunt_id)
                          └────── procedure_stappen (via procedure_stap_id)
```

`agendapunten` velden: `id`, `vergadering_id`, `volgorde`, `titel`, `beschrijving`, `categorie`, `tijdsduur_minuten`, `verantwoordelijke` (vrije tekst), `procedure_stap_id` (nullable FK), audit-velden.

`voorbereidingen` velden: `id`, `agendapunt_id`, `gebruiker_id`, `diepte` (snel/grondig), `ai_output jsonb`, `eigen_notities jsonb` (keyed op lens-slug), `bronnen_meta jsonb`, `bijgewerkt_op`.

### 3.2 UI-flow

`/vergaderingen` lijst-view → `/vergaderingen/[id]` detail met `AgendapuntKaart` per punt. Elke kaart bevat: categorie-badge, titel, meta-strook (tijd / verantwoordelijke / aantal stukken / aantal inbrengen), `StukKaart`-lijst, `VoorbereidingsBlok` (privé per gebruiker), inbreng-vak.

### 3.3 Gaten

| Gat | Effect in praktijk |
|---|---|
| Stuk in agenda is niet klikbaar | Bestuurder moet via Bibliotheek-tab terugzoeken om bronstuk te openen |
| Voorbereiding-notities alleen *binnen* een AI-lens | Geen plek voor losse aantekeningen, en geen notitievak als de AI-output nog niet gegenereerd is |
| Geen PATCH/DELETE op agendapunten | Geen herstel van typo's, geen wegnemen, geen verplaatsen naar volgende vergadering |
| Geen formele uitslag-vastlegging | Een besluit kan in `procedure_besluiten` worden geregistreerd, maar zonder onderliggende stem-per-persoon en motiveringen |

---

## 4. Huidige stand — procedures (kort)

Voor de volledigheid sterk beknopt. Voor diepe context zie `PROCEDURE-MVP1-ONTWERP.md` (v2.1), `PROCEDURE-MVP1-AUDIT.md` (de audit-bevindingen op dat ontwerp) en de release-historie in `HANDOVER.md`. Decision Object MVP-1 (subfases 1A t/m 1E) is volledig opgeleverd:

- `decision_objects` als centraal besluitdossier met multi-dimensionele classificatie en een statusmodel van 14 statussen
- 11 nieuwe tabellen rond aannames, risico's, dissent, voorwaarden, acties, evaluaties, AI-interacties, requirements, governance-events en audit-snapshots
- Append-only `governance_events` met sha256-hash per event
- Auditdossier-export via `GET /api/decisions/[id]/auditdossier?versie=…&formaat=…` (HTML/JSON, live/snapshot)
- Procedures iteratie 3 (18 mei 2026): in-app notificaties, procedure-edit, inline edit op dossier-rijen, bibliotheek-picker bij bewijsstukken

De stemming-functionaliteit in dit ontwerp grijpt aan op de keten `agendapunten → procedure_stap_id → procedures → decision_id → decision_objects`. Geen wijziging aan het Decision Object zelf; alleen een nieuwe entiteit (`stemmingen`) die zich op deze keten koppelt en een nieuw expliciet FK-veld (`procedure_bewijs.stemming_id`) voor traceerbaarheid.

---

## 5. Scope V2 — wat verandert

Twee tranches die los uitleverbaar zijn. Tranche 2 is functioneel zelfstandig, maar **veronderstelt de tranche-1-uitbreiding** van `agendapunten` voor eigenaar- en wijziglogica: stemronde-startbevoegdheid leunt op `agendapunten.aangemaakt_door`, en de regels rond verplaatsen/verwijderen bij open of gesloten stemming koppelen direct aan de tranche-1-mutatieroutes. Bouwvolgorde dus: eerst tranche 1, daarna tranche 2.

| Tranche | Inhoud | Globale omvang |
|---|---|---|
| 1 — Vergader-basics | Klikbare documenten, vrij notitieveld, agendapunt-CRUD inclusief verplaatsen, volgorde-pijltjes, drie notificatie-types, `agendapunt_log` | ~2 werkdagen |
| 2 — Stemmingen | Datamodel + RLS, starten/uitbrengen/wijzigen/sluiten/intrekken, volmacht met versterking, uitslag-rapportage met status-velden, dissent-prompt voor default-alternatieven, auto-koppeling met procedure-besluit, vier notificatie-types, auditdossier-uitbreiding | ~5 werkdagen |

---

## 6. Tranche 1 — Vergader-basics

### 6.1 Documenten openen vanuit een agendapunt

**Probleem**. `StukKaart` in `AgendapuntKaart.tsx` toont titel + type-badge + samenvatting, maar de titel is geen link.

**Oplossing**. Hergebruik de bestaande inzage-route `GET /api/documents/[id]/bestand` die al RLS-veilig, deactivatie-aware en audit-loggend is via `document_inzage`. `StukKaart` wordt:

- Header met type-badge + titel klikbaar als `<a href="/api/documents/[id]/bestand" target="_blank">` met dezelfde styling als de bibliotheek-rij
- Documenten zonder `opslag_pad` (pré-mei-2026 uploads) niet-klikbaar met "Origineel niet beschikbaar"-hint
- De bron-lijst onderaan een AI-voorbereiding krijgt dezelfde behandeling

**Geen schema-wijziging**. De inzage-route doet zelf de RLS-check en logt de inzage.

### 6.2 Vrije notitieruimte in de voorbereiding

**Probleem**. `voorbereidingen.eigen_notities jsonb` is keyed op lens-slug. Geen ruimte voor losse gedachten, en geen notitievak vóór generatie van de AI-output.

**Oplossing**. Nieuwe kolom `voorbereidingen.vrije_notities text` (nullable). Rendert als één textarea bovenaan het `VoorbereidingsBlok`, los van de lenzen, beschikbaar zodra de gebruiker de pagina opent.

**Schema-migratie** `supabase/migrations/2026_05_18_vergadering_basics.sql`:

```sql
alter table voorbereidingen
  add column if not exists vrije_notities text;
```

**API-route**. Bestaande `PATCH /api/agendapunten/[id]/voorbereiding/notities/route.ts` uitbreiden — accepteert nu ook `vrije_notities: string`. Validatie: zelfde RLS (alleen eigen voorbereiding).

**UI**. Bovenaan `VoorbereidingsBlok` een nieuw blok *Mijn aantekeningen* met één textarea, debounced PATCH zoals de huidige `eigen_notities`.

**Bevestigingsdialoog bij delen** (nieuw t.o.v. v1.0). De "↓ Gebruik dit als startpunt voor mijn inbreng"-knop opent eerst een dialoog: *"Uw vrije notities worden opgenomen in de concept-inbreng. U kunt deze nog bewerken voordat u deelt."* Met de optie *"Vrije notities meenemen"* aan/uit. Voorkomt dat ruwe of vertrouwelijke notities ongewild in de gedeelde inbreng belanden.

### 6.3 Agendapunten wijzigen, verplaatsen en verwijderen

**Schema-migratie** in dezelfde migratie als 6.2:

```sql
alter table agendapunten
  add column if not exists aangemaakt_door uuid references auth.users(id),
  add column if not exists verwijderd_op timestamptz,
  add column if not exists verwijderd_door uuid references auth.users(id),
  add column if not exists verwijder_reden text,
  add column if not exists gewijzigd_op timestamptz,
  add column if not exists gewijzigd_door uuid references auth.users(id);

create index if not exists idx_agendapunten_actief
  on agendapunten (vergadering_id, volgorde)
  where verwijderd_op is null;

create table if not exists agendapunt_log (
  id uuid primary key default gen_random_uuid(),
  agendapunt_id uuid not null references agendapunten(id) on delete cascade,
  event_type text not null check (event_type in (
    'agendapunt_gewijzigd','agendapunt_verplaatst',
    'agendapunt_verwijderd','agendapunt_hersteld'
  )),
  actor_id uuid not null references auth.users(id),
  payload jsonb not null default '{}',
  aangemaakt timestamptz not null default now()
);
```

Alle bestaande queries op `agendapunten` filteren default op `verwijderd_op is null`. De vergadering-detailpagina krijgt een optionele toggle *Toon verwijderde agendapunten* die uit staat. Verwijderde punten zijn dan zichtbaar voor iedereen op het fonds — niet via een directe URL voor buitenstaanders, want RLS filtert per fonds.

#### 6.3.1 Wijzigen

Nieuwe route `PATCH /api/agendapunten/[id]/route.ts` accepteert een subset van:

- `titel`, `beschrijving`, `categorie`, `tijdsduur_minuten`, `verantwoordelijke`
- `vergadering_id` (verplaatsen — alleen toekomstige vergaderingen; in tranche 2 plus extra restricties bij open/gesloten stemming)
- `volgorde`

**Rechten**: eigenaar (= `aangemaakt_door`), voorzitter, beheerder. Andere bestuurders krijgen 403.

**Motivering**: verplicht zodra er ≥1 inbreng óf ≥1 voorbereiding op het punt staat. Body-validatie: `motivering` minimaal **10 tekens** (niet 3 — voorkomt "ok"/"nvt"). Onder 10: 400 met heldere error.

**Audit**. Diff wordt opgebouwd en geschreven naar `agendapunt_log` met `event_type='agendapunt_gewijzigd'` (of `'agendapunt_verplaatst'` bij `vergadering_id`-wijziging). Payload: `{ velden: ["titel", "categorie"], oud: {...}, nieuw: {...}, motivering: "..." }`.

**Notificatie**. Naar iedere bijdrager: alle gebruikers met inbreng op dit punt + alle gebruikers met een voorbereiding-rij. Type `agendapunt_gewijzigd` of `agendapunt_verplaatst`.

#### 6.3.2 Verplaatsen specifiek

Verplaatsen is een speciaal geval van wijzigen (`vergadering_id`-mutatie). Inbreng, voorbereidingen en gekoppelde stukken reizen automatisch mee.

Validaties server-side:

- Doel-vergadering moet bestaan en behoren tot hetzelfde fonds
- Doel-vergadering moet in de toekomst liggen (`vergaderingen.datum > now()`)
- Niet verplaatsen naar de huidige vergadering (no-op)
- Na verplaatsing wordt `volgorde` opnieuw bepaald (aan het eind van de doel-vergadering)

**Extra restrictie bij stemmingen (tranche 2)**:

- Agendapunt met **open stemming** kan niet worden verplaatst. UI toont melding *"Sluit of trek de open stemming eerst in voordat u dit punt verplaatst"*; server-side hard 400.
- Agendapunt met **gesloten of ingetrokken stemming** kan helemaal niet worden verplaatst. Een gesloten stemming is historisch verbonden met de vergadering waarin hij plaatsvond; verplaatsen zou de bestuurlijke werkelijkheid herschrijven. Wil men het onderwerp opnieuw behandelen, dan moet een nieuw agendapunt in de doel-vergadering worden aangemaakt. Server-side hard 400 met uitleg.

#### 6.3.3 Verwijderen

Nieuwe route `DELETE /api/agendapunten/[id]/route.ts`. Soft-delete: zet `verwijderd_op = now()`, `verwijderd_door = auth.uid()`, `verwijder_reden = <body.reden>`. Validatie: `verwijder_reden` minimaal **10 tekens**. UI-confirmation toont *"3 inbrengen en 2 voorbereidingen blijven bewaard maar dit punt verdwijnt van de agenda"*.

**Rechten**: eigenaar, voorzitter, beheerder — altijd, ook bij bestaand werk van anderen.

**Bij open stemming** (tranche 2): de stemming wordt vóór de soft-delete automatisch ingetrokken met `ingetrokken_reden='Agendapunt verwijderd'`. Stemmers + starter ontvangen een `stemronde_ingetrokken`-notificatie (niet `stemronde_gesloten`, want de stemming is feitelijk niet gesloten maar ingetrokken — semantisch verschil voor de notificatiehistorie). Pas daarna wordt het agendapunt op `verwijderd_op` gezet. Bij gesloten stemming verloopt het verwijderen normaal — de uitslag blijft historisch correct.

**Notificatie**. Type `agendapunt_verwijderd` naar alle bijdragers met motivering in de payload.

**Herstellen**. `POST /api/agendapunten/[id]/herstellen/route.ts` zet `verwijderd_op` op `null` en logt `agendapunt_hersteld`. Alleen voorzitter en beheerder. Notificatie naar bijdragers analoog.

#### 6.3.4 Eigenaar-bepaling

De nieuwe kolom `agendapunten.aangemaakt_door` wordt gevuld vanaf deze release. Voor bestaande rijen blijft het `null` — geen backfill. Voor `null`-eigenaars geldt: alleen voorzitter en beheerder mogen wijzigen of verwijderen. Sluit aan op reviewer-advies (§13.1).

#### 6.3.5 Volgorde aanpassen

Op de `AgendapuntKaart`-header pijltjes ▲▼ (klein, alleen zichtbaar voor eigenaar + voorzitter/beheerder). Klik stuurt `PATCH /api/agendapunten/[id]/route.ts` met nieuw volgorde-getal; server herwerkt de opeenvolgende reeks. Geen drag-and-drop in v1.

### 6.4 Tranche 1 — fasering binnen één deploy

1. Schema-migratie `2026_05_18_vergadering_basics.sql` draaien in Supabase
2. Klikbare `StukKaart` (kleinste wijziging, 30 minuten)
3. Vrij notitieveld in `VoorbereidingsBlok` + bevestigingsdialoog bij delen
4. `PATCH /api/agendapunten/[id]/route.ts` met validatie en motivering-trigger (10 tekens)
5. `DELETE /api/agendapunten/[id]/route.ts` met soft-delete
6. `POST /api/agendapunten/[id]/herstellen/route.ts`
7. Volgorde-pijltjes in `AgendapuntKaart`
8. `AgendapuntEditModal`-component (alle velden + verplaatsen-dropdown + motivering-textarea)
9. Drie notificatie-types activeren
10. `tsc --noEmit` groen + HANDOVER-update + commit

---

## 7. Tranche 2 — Stemmingen

### 7.1 Doel en scope

De **stemronde** is de formele besluitfase binnen een agendapunt met categorie `besluitvorming`. Op dit moment kan een besluit in `procedure_besluiten` worden geregistreerd, maar zonder onderliggende stemming — er is geen vastlegging van wie voor en tegen was, met welke motivering, en of er volmachten zijn gegeven.

**In scope v1**:
- Open stemmingen (uitslag per persoon zichtbaar) binnen een agendapunt
- Default-alternatieven voor / tegen / onthouden, of custom alternatieven (variant A / B / C)
- Volmacht met expliciete bevestiging, optionele toelichting en notificatie aan volmachtgever
- Quorum en meerderheid als drie status-velden plus `besluitregistratie_advies` — niet rechtsgeldig
- Stemmen mogen worden gewijzigd vóór sluiting; elke wijziging wordt gelogd
- Sluiting alleen handmatig door starter of voorzitter/beheerder
- Bij tegen-stem met motivering (alleen bij default-alternatieven): prompt naar `decision_dissent`
- Bij sluiting van een stemming op een agendapunt met procedure-stap-koppeling: stemverslag wordt als bewijs in `procedure_bewijs` opgenomen via expliciete `stemming_id`-FK
- Notificatie bij openen (naar bestuursleden), bij sluiten (naar starter + tegen-stemmers), en bij volmacht-stem (naar volmachtgever)
- Stemverslag-sectie in auditdossier-export; gesloten/ingetrokken stemmingen in snapshot-payload

**Uit scope v1** (uitgesteld naar iteratie 2):
- Geheime stemmingen
- Schriftelijke rondes buiten een vergadering om
- Automatische sluiting op een tijdstip
- Stemming over meerdere besluitpunten tegelijk
- Custom alternatieven met automatische dissent-flow

### 7.2 Datamodel

**`stemmingen`**

| Veld | Type | Beschrijving |
|---|---|---|
| `id` | uuid PK | |
| `fonds_id` | uuid not null FK | RLS-anker |
| `agendapunt_id` | uuid not null FK | Stemming hangt altijd aan een agendapunt |
| `decision_id` | uuid nullable FK | Afgeleid via `agendapunt.procedure_stap_id → procedure.decision_id` bij starten |
| `vraag` | text not null | Pre-fill uit `decision_objects.besluitvraag` indien gekoppeld |
| `alternatieven` | jsonb not null | Default voor/tegen/onthouden; custom toegestaan |
| `vereist_quorum` | int nullable | Optioneel, alleen voor rapportage |
| `vereiste_meerderheid` | text nullable check | `'gewone'`, `'gekwalificeerd_twee_derde'`, `'unaniem'`; alleen rapportage |
| `status` | text not null check | `'open'`, `'gesloten'`, `'ingetrokken'`, default `'open'` |
| `geopend_op` | timestamptz default now() | |
| `geopend_door` | uuid not null FK | |
| `gesloten_op` | timestamptz nullable | |
| `gesloten_door` | uuid nullable FK | |
| `ingetrokken_reden` | text nullable | Bij `status='ingetrokken'` verplicht; minimaal 10 tekens |
| `uitslag` | jsonb nullable | Gevuld bij sluiten — zie §7.6 voor structuur |

Constraint: precies één open stemming per agendapunt (`unique(agendapunt_id) where status='open'`).

**`stem_uitbrengingen`** — herontworpen t.o.v. v1.0 op basis van reviewer-feedback:

| Veld | Type | Beschrijving |
|---|---|---|
| `id` | uuid PK | |
| `stemming_id` | uuid not null FK on delete cascade | |
| `uitgebracht_door` | uuid not null FK auth.users | **Wie klikt en de stem registreert** |
| `stemgerechtigde_id` | uuid not null FK auth.users | **Van wie de stem formeel is** |
| `keuze` | text not null | Moet matchen met `code` uit `stemmingen.alternatieven` |
| `motivering` | text nullable | Vrij tekstveld |
| `is_volmacht` | boolean generated always as (uitgebracht_door != stemgerechtigde_id) stored | Afgeleid, voor query-gemak |
| `volmacht_toelichting` | text nullable | "Mondeling verleend tijdens vergadering" / "Volgens vooraf gedeelde volmacht" |
| `volmacht_bevestigd` | boolean not null default false | Verplicht `true` als `is_volmacht=true` (server-side check) |
| `uitgebracht_op` | timestamptz default now() | Wordt bij wijziging bijgewerkt |

Constraints:
- `unique(stemming_id, stemgerechtigde_id)` — één stem per stemgerechtigde per stemming
- Symmetrische check-constraint (gecorrigeerd in v1.2; eerdere variant dwong alleen aan één kant af):
  ```sql
  check (
    (uitgebracht_door = stemgerechtigde_id and volmacht_bevestigd = false)
    or
    (uitgebracht_door <> stemgerechtigde_id and volmacht_bevestigd = true)
  )
  ```
  Bij eigen stem mag `volmacht_bevestigd` niet `true` zijn; bij volmachtstem **moet** het `true` zijn. De database dwingt dit nu zelf af, niet alleen de API-route.

Effect: bestuurder A die zowel voor zichzelf stemt **en** namens B stemt, krijgt twee rijen — eerste met `uitgebracht_door=A, stemgerechtigde_id=A`, tweede met `uitgebracht_door=A, stemgerechtigde_id=B`. De unique-constraint op `stemgerechtigde_id` voorkomt dubbel-stemmen voor één persoon.

### 7.3 Rechten en flow

| Actie | Toegestaan door |
|---|---|
| Stemronde starten | Voorzitter, beheerder, of aanmaker van het agendapunt — consistent met agendapunt-rechten en met de governance-aard van een stemming. Afwijking van v1.0 ("geen restricties") op basis van reviewer-advies. |
| Eigen stem uitbrengen | Iedere bestuurder van het fonds |
| Stem uitbrengen namens een ander (volmacht) | Iedere bestuurder; met expliciete bevestiging |
| Eigen stem wijzigen | Alleen vóór sluiting |
| Stemming sluiten | Starter, voorzitter, beheerder |
| Stemming intrekken | Starter, voorzitter, beheerder; verplichte motivering ≥10 tekens |

RLS-policies in §9.

**Volmacht-flow** (nieuw t.o.v. v1.0). Bij keuze van *"Stem namens iemand anders"* in het `StemPaneel`:

1. Dropdown van bestuursleden van het fonds (exclusief jezelf, exclusief bestuursleden die al een eigen stem hebben uitgebracht op deze stemming)
2. Expliciete bevestigings-checkbox: *"Ik bevestig dat ik gemachtigd ben om namens [naam] te stemmen"* — verplicht aangevinkt anders disabled submit-knop
3. Optioneel toelichtingsveld: *"Hoe is deze volmacht verleend?"* — voorbeelden als placeholder
4. Bij submit: insert in `stem_uitbrengingen` met `uitgebracht_door=auth.uid()`, `stemgerechtigde_id=<dropdown>`, `volmacht_bevestigd=true`, `volmacht_toelichting=<optioneel>`
5. Notificatie naar de volmachtgever: *"[Naam] heeft namens u een stem uitgebracht op [vraag]"*. Apart type `volmachtstem_uitgebracht` (zie §11.1) — semantisch zuiverder dan dit onder `stemronde_geopend` te scharen.

**Flow open stemming**:

1. Voorzitter/beheerder/aanmaker klikt *Stemronde starten* op een agendapunt met categorie `besluitvorming`
2. Modal: vraag (pre-fill), alternatieven (default-toggle of custom), optioneel quorum, optionele meerderheid-eis
3. Insert in `stemmingen`, `governance_events.stemming_geopend`, notificatie `stemronde_geopend` naar alle bestuurders + voorzitters van het fonds
4. Bestuursleden zien `StemPaneel` met alternatieven, optionele motivering, optionele volmacht-flow
5. Stem-uitbrengen: upsert in `stem_uitbrengingen` met unique constraint. Wijziging vóór sluiting: `stem_gewijzigd`-event
6. Live totalen zichtbaar voor alle bestuursleden — `router.refresh()` na elke stem, geen websockets
7. Sluiten: `uitslag` berekenen, `status='gesloten'`, `stemming_gesloten`-event, `procedure_bewijs`-rij bij procedure-koppeling, notificatie naar starter + tegen-stemmers
8. UI biedt *Registreer als besluit*-knop met waarschuwing als quorum/meerderheid niet gehaald is

### 7.4 Koppeling met Decision Object en procedure_bewijs

De keten:

```
stemmingen.agendapunt_id
  └─ agendapunten.procedure_stap_id
       └─ procedure_stappen.procedure_id
            └─ procedures.decision_id
                 └─ decision_objects.id
```

`stemmingen.decision_id` wordt bij starten afgeleid en opgeslagen — snelle audit-key.

**`procedure_bewijs.stemming_id`** (nieuw, expliciet t.o.v. v1.0). Bij sluiten van een stemming wordt automatisch een `procedure_bewijs`-rij geschreven met:

```sql
insert into procedure_bewijs (
  procedure_id, stap_id, stemming_id, documenttype, titel, beschrijving, aangemaakt_door
) values (
  <derived>, <derived>, <stemming.id>, 'stemverslag',
  'Stemverslag — ' || <stemming.vraag>,
  'Uitslag: ' || <winnend_alternatief> || ' (' || <totalen> || ')',
  <stemming.gesloten_door>
);
```

Migratie tranche 2 voegt toe:

```sql
alter table procedure_bewijs
  add column if not exists stemming_id uuid references stemmingen(id) on delete set null;

create index if not exists idx_procbewijs_stemming on procedure_bewijs(stemming_id)
  where stemming_id is not null;
```

`fn_build_decision_dossier` wordt uitgebreid met een sub-query die alle `stemmingen.decision_id = $1` ophaalt. `DecisionDossierView` krijgt veld `stemverslagen: StemverslagSummary[]`.

### 7.5 Dissent-flow

**Beperkt tot default-alternatieven**. Een **tegen**-stem met motivering — alleen bij `alternatieven` = default-set voor/tegen/onthouden — levert na uitbrengen een prompt:

*"Wilt u dit ook als dissent vastleggen in het besluitdossier?"* met de drie zichtbaarheids-gradaties uit `decision_dissent`:

- **Privé** (default)
- **Gedeelde zorg**
- **Formele dissent**
- **Minderheidsnotitie** — alleen voorzitter/beheerder mag dit vaststellen

Bij keuze schrijft de UI een rij in `decision_dissent` met:
- `decision_id` (afgeleid)
- `auteur_id` = `auth.uid()`
- `standpunt` = motivering
- `zichtbaarheid` = gekozen niveau
- `stemming_id` = referentie naar de stem (nieuw nullable veld; alter op `decision_dissent`)

**Custom alternatieven uitgesloten van automatische dissent** (afwijking van v1.0). Bij een stemming met Variant A/B/C kan dissent nog steeds handmatig worden vastgelegd via de bestaande dissent-functionaliteit in het Decision Object, maar wordt niet automatisch geprompt op basis van de stem. Reden: bij custom alternatieven bestaat geen eenduidig "tegen". Een halfwerkende generieke flow is eerlijker uit te stellen dan vroeg in te bouwen.

### 7.6 Auditdossier-uitbreiding en snapshot-semantiek

**Quorum/meerderheid-rapportage**. `uitslag jsonb`-structuur — niet meer als binaire booleans, maar als status-velden:

```json
{
  "totalen": {"voor": 5, "tegen": 1, "onthouden": 1},
  "totaal_stemmen": 7,
  "totaal_bestuursleden": 8,
  "quorum_drempel": 5,
  "quorum_status": "gehaald",
  "meerderheid_type": "gewone",
  "meerderheid_status": "gehaald",
  "besluitregistratie_advies": "mogelijk",
  "winnend_alternatief": "voor",
  "per_stemgerechtigde": [
    {"stemgerechtigde_id": "...", "naam": "...", "keuze": "voor",
     "uitgebracht_door": "...", "uitgebracht_door_naam": "...",
     "is_volmacht": false, "motivering": null},
    {"stemgerechtigde_id": "...", "naam": "...", "keuze": "voor",
     "uitgebracht_door": "<andere>", "uitgebracht_door_naam": "...",
     "is_volmacht": true, "volmacht_toelichting": "Mondeling verleend",
     "motivering": null}
  ]
}
```

- `quorum_status`: `'niet_ingesteld' | 'gehaald' | 'niet_gehaald'`
- `meerderheid_status`: idem
- `besluitregistratie_advies`: `'mogelijk' | 'waarschuwing' | 'niet_mogelijk'` — `'waarschuwing'` als quorum of meerderheid niet gehaald, `'niet_mogelijk'` als beide niet ingesteld en geen eenduidig winnend alternatief

**UI-effect**. Bij `besluitregistratie_advies = 'waarschuwing'` toont `StemUitslag` een amber-banner: *"Quorum/meerderheid niet gehaald. Registratie als besluit is mogelijk, maar overweeg of dit bestuurlijk verantwoord is."* Bij `'niet_mogelijk'` is de knop *Registreer als besluit* disabled.

**Disclaimer in stemverslag** (auditdossier-export):

> *"Het systeem rapporteert de ingevoerde quorum- en meerderheidstoets op basis van de door de starter ingegeven drempels. Formele rechtsgeldigheid wordt niet zelfstandig vastgesteld; de bestuurlijke beoordeling van de uitslag blijft bij het bestuur."*

**Stemverslag-sectie**. `lib/auditdossier-html.ts` krijgt een nieuwe sectie *Stemverslagen* per Decision Object. Per stemming: vraag + alternatieven, geopend/gesloten metadata, totalen, quorum/meerderheid-status, per-stemgerechtigde-tabel met expliciete volmacht-markering, link naar geformaliseerde dissent.

**Snapshot-semantiek** (herformuleerd t.o.v. v1.0):

Op het moment van snapshot-vorming (trigger op overgang naar `besloten`/`voorwaardelijk_besloten`/`in_evaluatie`/`afgesloten`) bouwt `fn_build_decision_dossier` de dossier-payload op. Daarin worden **alle gesloten of ingetrokken stemmingen** opgenomen die op dat moment aan het Decision Object hangen. Open stemmingen worden uitgesloten van de snapshot (een open stemming heeft geen vastliggende uitslag). Stemmingen die ná snapshot-vorming worden gesloten of toegevoegd, verschijnen alleen in de live-dossier-view, niet in de snapshot-export.

Er komt **geen aparte `stemming_snapshots`-tabel** — stemmingen na sluiting zijn server-side immutable (UPDATE op `keuze`/`motivering` geblokkeerd), dus de waarden in de snapshot-payload zijn de waarden die nu nog in de database staan.

**Bescherming tegen incongruentie**: een Decision Object kan niet naar status `besloten` worden gezet als er nog open stemmingen aan hangen die procedureel relevant zijn. Server-side check in `POST /api/decisions/[id]/status` route — bij overgang naar `besloten`/`voorwaardelijk_besloten` wordt geverifieerd dat geen `stemmingen.status='open'` rijen wijzen naar de actieve procedure-stap. Bij gevonden open stemming: 400 met instructie *"Sluit of trek de open stemming eerst in"*.

### 7.7 Tranche 2 — fasering binnen één deploy

1. Schema-migratie `2026_05_19_stemmingen.sql` draaien in Supabase (twee tabellen, RLS, triggers, alter op `decision_dissent` en `procedure_bewijs`)
2. Server-side helper `lib/stemming.ts` met `berekenUitslag`, `valideerVolmacht`, `mapToProcedureBewijs`, `bouwUitslagStatusVelden`
3. `POST /api/stemmingen/route.ts` — starten (alleen voorzitter/beheerder/aanmaker)
4. `POST /api/stemmingen/[id]/stemmen/route.ts` — uitbrengen + wijzigen (upsert) met volmacht-validatie
5. `POST /api/stemmingen/[id]/sluiten/route.ts` — uitslag berekenen + `procedure_bewijs` schrijven met `stemming_id`-FK
6. `POST /api/stemmingen/[id]/intrekken/route.ts` met verplichte motivering ≥10 tekens
7. UI-componenten: `StemrondeBlok`, `StemStartenModal`, `StemPaneel` (met volmacht-flow), `StemUitslag` (met status-velden + amber-banner)
8. `DissentPromptDialog` — alleen bij default-alternatieven; custom expliciet uitgesloten
9. *Registreer als besluit*-knop met disabled-state bij `besluitregistratie_advies = 'niet_mogelijk'`
10. Vier notificatie-types activeren: `stemronde_geopend`, `volmachtstem_uitgebracht`, `stemronde_gesloten`, `stemronde_ingetrokken`
11. Auditdossier-export uitbreiden in `lib/auditdossier-html.ts` + `fn_build_decision_dossier`
12. Server-side check in `POST /api/decisions/[id]/status` op open stemmingen bij overgang naar `besloten`
13. Server-side guard op `POST /api/stemmingen/route.ts` tegen starten op afgeronde procedure-stap
14. `tsc --noEmit` groen + HANDOVER-update + commit

---

## 8. Datamodel-overzicht (gecombineerd)

```
vergaderingen ──< agendapunten ──< agendapunt_inbreng
                          │    └──< voorbereidingen
                          │           ├── ai_output, eigen_notities, vrije_notities  [TRANCHE 1]
                          │
                          ├── verwijderd_op, verwijderd_door, verwijder_reden          [TRANCHE 1]
                          ├── gewijzigd_op, gewijzigd_door                              [TRANCHE 1]
                          ├── aangemaakt_door                                           [TRANCHE 1]
                          │
                          ├──< agendapunt_log (event_type, actor_id, payload)          [TRANCHE 1]
                          ├──< documenten (gekoppeld via agendapunt_id)
                          ├──< stemmingen                                               [TRANCHE 2]
                          │       └──< stem_uitbrengingen                               [TRANCHE 2]
                          │              ├─ uitgebracht_door → auth.users
                          │              ├─ stemgerechtigde_id → auth.users
                          │              └─ is_volmacht (generated), volmacht_toelichting
                          │
                          └── procedure_stap_id → procedure_stappen
                                                      └── procedures
                                                             └── decision_id → decision_objects
                                                                                    └──< decision_dissent
                                                                                          └─ stemming_id  [TRANCHE 2]

stemmingen.decision_id ──> decision_objects (afgeleid bij starten)
procedure_bewijs.stemming_id ──> stemmingen (expliciete FK)                              [TRANCHE 2]
```

---

## 9. RLS-strategie

Patroon overgenomen van bestaande tabellen: filter per `fonds_id`, plus specifieke beperkingen op user-eigendom waar relevant. Op aanwijzing van de procedure-audit (`PROCEDURE-MVP1-AUDIT.md` §1) worden specifieke policies waar dat geldt **expliciet als `restrictive`** gemarkeerd, zodat ze restrictrueel intersecteren met de generieke fonds-policy in plaats van permissive geunieerd te worden.

| Tabel | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `voorbereidingen.vrije_notities` | Eigen rij (bestaand) | Eigen rij | Eigen rij | Eigen rij |
| `agendapunten` (CRUD) | Eigen fonds, niet-verwijderd default | Bestuurder van het fonds | Eigenaar OR voorzitter/beheerder (restrictive policy) | Soft-delete via UPDATE (geen DELETE-policy) |
| `agendapunt_log` | Eigen fonds | Via trigger op agendapunt-mutatie, geen direct insert | Geen | Geen — append-only |
| `stemmingen` | Eigen fonds | Voorzitter/beheerder/aanmaker (restrictive policy) | Starter, voorzitter, beheerder; alleen status / gesloten_* / ingetrokken_reden / uitslag | Geen — intrekken via UPDATE |
| `stem_uitbrengingen` | Eigen fonds (open stemming) | `uitgebracht_door = auth.uid()` (restrictive) | `uitgebracht_door = auth.uid()`, alleen vóór `stemming.status='open'` | `uitgebracht_door = auth.uid()`, alleen vóór sluiting |

Voor `stem_uitbrengingen` is de SELECT-policy open binnen het fonds bij open stemming — open stemming betekent dat alle bestuursleden elkaars stemmen kunnen zien. Voor geheime stemmingen (iteratie 2) wordt deze policy uitgebreid met een check op `stemmingen.type`.

**Server-side checks** (niet via RLS):

- Volmacht-validatie: `stemgerechtigde_id` is bestuurder van het fonds; `stemgerechtigde_id` heeft niet zelf al gestemd; `volmacht_bevestigd=true` als `is_volmacht=true`.
- Volmacht over jezelf onmogelijk: zie generated column en check-constraint.
- **Eigen stem geweigerd als er al een volmachtstem voor de gebruiker bestaat**: bij een POST `stemmen` met `stemgerechtigde_id = auth.uid()` controleert de route eerst of er al een rij is met dezelfde `stemgerechtigde_id` en `uitgebracht_door != stemgerechtigde_id`. Zo ja: 409 Conflict met instructie *"Er is al een volmachtstem namens u uitgebracht door X. Vraag deze persoon de stem in te trekken voordat u zelf stemt, of vraag de starter of voorzitter de stemming opnieuw open te zetten."* Voorkomt twee tegenstrijdige stemmen voor één stemgerechtigde.
- Stemming-starten alleen door voorzitter/beheerder/aanmaker van het agendapunt: rol-lookup in `profielen` plus `agendapunten.aangemaakt_door = auth.uid()`.
- Stemming-starten op afgeronde procedure-stap weigeren.
- Decision Object kan niet naar `besloten` met open gekoppelde stemming.

---

## 10. UI-componenten

Tranche 1 raakt twee bestaande componenten en voegt één nieuwe modal toe:

| Component | Wijziging |
|---|---|
| `AgendapuntKaart.tsx` | `StukKaart` klikbaar; nieuwe edit-modal-koppeling; volgorde-pijltjes; render-fallback voor verwijderde rij |
| `VoorbereidingsBlok.tsx` | Nieuw blok *Mijn aantekeningen* met textarea + bevestigingsdialoog bij delen naar inbreng |
| `AgendapuntEditModal.tsx` | Nieuw — alle wijzigbare velden + verplaatsen-dropdown + motivering-textarea (verplicht-state op basis van bijdragers-count, minimaal 10 tekens) |
| `vergaderingen/[id]/page.tsx` | Filter `verwijderd_op is null`; toggle *Toon verwijderde* |

Tranche 2 voegt vijf nieuwe componenten toe onder `app/(dashboard)/vergaderingen/_components/`:

| Component | Rol |
|---|---|
| `StemrondeBlok.tsx` | Hoofdcontainer op een agendapunt met categorie `besluitvorming`; drie states (geen stemming / open / gesloten); rendert een van de andere componenten |
| `StemStartenModal.tsx` | Form: vraag (pre-fill), alternatieven (default of custom), optioneel quorum, optionele meerderheid-eis |
| `StemPaneel.tsx` | Stem uitbrengen + wijzigen; optionele motivering; volmacht-flow met expliciete bevestiging + optionele toelichting |
| `StemUitslag.tsx` | Gesloten staat: totaalbalk per alternatief, status-pills (quorum/meerderheid), per-stemgerechtigde-tabel met volmacht-markering, amber-banner bij `besluitregistratie_advies='waarschuwing'`, *Registreer als besluit*-link (disabled bij `'niet_mogelijk'`) |
| `DissentPromptDialog.tsx` | Verschijnt alleen bij tegen-stem op default-alternatieven; afhandelt zichtbaarheids-keuze + schrijft naar `decision_dissent` |

---

## 11. Audit en notificaties

### 11.1 Nieuwe notificatie-types

Zeven nieuwe waarden in het `notificaties.type`-enum (in v1.2 opgesplitst t.o.v. v1.1 om semantisch zuiver te zijn):

| Type | Trigger | Ontvanger(s) | Payload kern |
|---|---|---|---|
| `agendapunt_gewijzigd` | PATCH op agendapunt met motivering-trigger | Iedere bijdrager (inbreng + voorbereiding) | velden_gewijzigd, oud, nieuw, motivering |
| `agendapunt_verplaatst` | PATCH met wijziging op `vergadering_id` | Iedere bijdrager | oude_vergadering, nieuwe_vergadering, motivering |
| `agendapunt_verwijderd` | DELETE | Iedere bijdrager | motivering |
| `stemronde_geopend` | POST stemming | Alle bestuurders + voorzitters van het fonds (zonder pure-beheerders) | agendapunt, vraag |
| `volmachtstem_uitgebracht` | INSERT in `stem_uitbrengingen` met `is_volmacht=true` | De volmachtgever (= `stemgerechtigde_id`) | agendapunt, vraag, uitgebracht_door_naam, keuze, volmacht_toelichting |
| `stemronde_gesloten` | POST sluiten | Starter + iedereen die tegen heeft gestemd | agendapunt, winnend_alternatief, uitslag-samenvatting, quorum_status, meerderheid_status |
| `stemronde_ingetrokken` | POST intrekken + automatische intrekking bij verwijderen agendapunt | Starter + alle stemmers | agendapunt, ingetrokken_reden |

Idempotentie, self-notify-skip en soft-fail uit de bestaande `notifyUser`-helper blijven gelden. `volmachtstem_uitgebracht` is een apart type omdat het inhoudelijk een andere mededeling is dan "er is een stemronde geopend" — de volmachtgever wordt geïnformeerd dat er namens hem is gestemd.

### 11.2 Audit-events

Stemming-mutaties leveren `governance_events` met sha256-hash:

| Event-type | Wanneer |
|---|---|
| `stemming_geopend` | POST nieuwe stemming |
| `stem_uitgebracht` | Eerste keer stem uitbrengen |
| `stem_gewijzigd` | Bestaande stem aangepast vóór sluiting |
| `stemming_gesloten` | POST sluiten |
| `stemming_ingetrokken` | POST intrekken |
| `volmacht_uitgebracht` | Bij stem met `is_volmacht=true` (los event naast `stem_uitgebracht` voor auditgemak) |

**Agendapunt-mutaties blijven expliciet apart** in `agendapunt_log`, niet in `governance_events`. Reden: een agendapunt-mutatie heeft niet altijd een `decision_id` (informatieve agendapunten, beeldvorming-categorie zonder gekoppelde procedure). De `governance_events`-tabel is besluitgericht; centralisatie zou een nullable `decision_id` plus aparte RLS-architectuur vergen, en dat is een aparte refactor — geen bijvangst van deze feature. Sluit aan op reviewer-advies (§13.2).

---

## 12. Compatibiliteit en migratiestrategie

### Backwards compatibility

- Bestaande agendapunten zonder `aangemaakt_door` blijven werken; alleen voorzitter/beheerder mag ze wijzigen/verwijderen
- Bestaande voorbereidingen zonder `vrije_notities` tonen een leeg notitievak
- Geen wijzigingen aan bestaande RLS-policies — alleen toevoegingen plus restrictive-markering op nieuwe specifieke policies
- Stemming-tabellen zijn additief, geen impact op procedures of decision_objects
- `procedure_bewijs.stemming_id` is nullable; bestaande rijen blijven null

### Migratievolgorde

Volgnummering aansluitend op `HANDOVER.md` §Migratie-bestanden in volgorde:

14. `2026_05_18_vergadering_basics.sql` — `voorbereidingen.vrije_notities`, `agendapunten` soft-delete + metadata + `aangemaakt_door`, `agendapunt_log`-tabel, drie notificatie-types in enum
15. `2026_05_19_stemmingen.sql` — `stemmingen`, `stem_uitbrengingen`, RLS (restrictive), triggers naar `governance_events`, `decision_dissent.stemming_id` kolom, `procedure_bewijs.stemming_id` kolom, vier notificatie-types in enum (`stemronde_geopend`, `volmachtstem_uitgebracht`, `stemronde_gesloten`, `stemronde_ingetrokken`)

Beide migraties zijn idempotent.

### Rollback

Tranche 1: geen rollback-script — terugzetten van UI is non-destructief.
Tranche 2: `2026_05_19_stemmingen_ROLLBACK.sql` analoog aan Phase 1A — drop tables, drop nieuwe kolommen, drop enum-uitbreidingen.

---

## 13. Open vragen — integraal verwerkt uit reviewfeedback

In v1.1 zijn de 13 open vragen uit v1.0 §13 allemaal beantwoord op basis van expliciete reviewer-adviezen. Voor de volledigheid hier samengevat — geen openstaande beslissingen meer:

1. Eigenaar-bepaling agendapunten: nieuwe kolom `aangemaakt_door`, geen backfill. Voor bestaande rijen alleen voorzitter/beheerder. *Verwerkt in §6.3.4.*
2. Audit-log agendapunten: apart `agendapunt_log`, niet centralisatie. *Verwerkt in §6.3 en §11.2.*
3. `stemronde_geopend`-notificatie: bestuurders + voorzitters, niet pure beheerders. *Verwerkt in §11.1.*
4. Volmacht-administratie: geen aparte tabel, wel versterkt — bevestiging + optionele toelichting + notificatie aan volmachtgever. *Verwerkt in §7.3.*
5. Default quorum/meerderheid: leeg per stemming, geen fondsbrede defaults. *Verwerkt in §7.6.*
6. Open stemming + agendapunt verwijderen: automatisch intrekken vóór soft-delete. *Verwerkt in §6.3.3.*
7. Open stemming + verplaatsen agendapunt: blokkeren, eerst sluiten/intrekken. *Verwerkt in §6.3.2.*
8. Gesloten stemming + verplaatsen agendapunt: niet toestaan. *Verwerkt in §6.3.2.*
9. Stemming starten op afgeronde procedure-stap: server-side weigeren; bestaande open stemmingen op zo'n stap mogen wel afgesloten of ingetrokken worden. *Verwerkt in §7.7.*
10. Starter eigen stemming intrekken: ja, met motivering ≥10 tekens en notificatie naar stemmers. *Verwerkt in §7.3.*
11. Volmachten meetellen in totalen: ja, één stem per stemgerechtigde — quorum-check rekent op `totaal_stemmen` inclusief volmacht-uitbrengingen. *Verwerkt in §7.6.*
12. Tekstlabels alternatieven: vaste defaults + bewerkbare custom volstaan voor v1. *Verwerkt in §7.1.*
13. Auditdossier en open stemmingen: open stemmingen niet in audit-snapshot. Plus server-side guard tegen status-overgang naar `besloten` met open gekoppelde stemming. *Verwerkt in §7.6.*

---

## 14. Verifieerbaarheid van het ontwerp

Acceptatie-criteria per tranche, bijgewerkt voor v1.1:

**Tranche 1**:
- Document opgeklikt vanuit agendapunt opent in nieuw tabblad en logt `document_inzage`
- Vrije notities aanwezig na refresh zonder gegenereerde AI-voorbereiding; bevestigingsdialoog vóór delen naar inbreng werkt
- Agendapunt met inbreng wijzigen werkt met motivering ≥10 tekens en notificeert bijdragers
- Verwijderd agendapunt uit default lijstweergave, zichtbaar onder *Toon verwijderde*, gekoppelde inbreng/voorbereiding nog opvraagbaar
- `tsc --noEmit --skipLibCheck` exit 0

**Tranche 2**:
- Stemming starten alleen toegelaten voor voorzitter/beheerder/aanmaker; andere gebruikers krijgen 403
- Volmacht-stem werkt: A stemt zelf én namens B, beide rijen aanwezig met juiste `uitgebracht_door`/`stemgerechtigde_id`
- Volmacht zonder bevestiging-checkbox geweigerd (server-side 400)
- Volmachtgever ontvangt notificatie *"X heeft namens u gestemd"*
- Stem wijzigen vóór sluiting werkt en logt `stem_gewijzigd`
- Quorum/meerderheid-rapportage toont juiste status-velden in `uitslag`; UI toont amber-banner bij waarschuwing
- *Registreer als besluit*-knop disabled bij `besluitregistratie_advies = 'niet_mogelijk'`
- Dissent-prompt verschijnt bij tegen-stem op default-alternatieven; bij custom alternatieven niet
- Gesloten stemming met procedure-koppeling resulteert in `procedure_bewijs`-rij met expliciete `stemming_id`-FK
- Verplaatsen geblokkeerd bij open stemming; helemaal niet toegestaan bij gesloten stemming (server-side 400)
- Stemming starten op afgeronde procedure-stap geweigerd
- Decision Object overgang naar `besloten` geweigerd zolang open stemming op actieve procedure-stap bestaat
- Auditdossier-HTML toont *Stemverslagen*-sectie met disclaimer over rechtsgeldigheid
- Snapshot bevat gesloten stemmingen op moment van trigger
- `tsc --noEmit --skipLibCheck` exit 0

---

## 15. Wat dit ontwerp bewust niet doet

- **Geheime stemmingen.** Uitgesteld; randgeval en vergt aparte RLS plus geheim-zicht. Iteratie 2.
- **Schriftelijke ronde tussen vergaderingen.** Alle stemmingen hangen aan een agendapunt.
- **Automatische sluiting op tijdstip.** Alleen handmatig sluiten in v1.
- **Drag-and-drop voor volgorde.** Pijltjes ▲▼ volstaan.
- **Aparte volmachten-tabel met geldigheid en ondertekening.** Per-stem aangegeven met bevestiging + optionele toelichting is voldoende voor v1; aparte module pas als er vraag naar komt.
- **Custom alternatieven met automatische dissent-flow.** Pas in iteratie 2 als de semantiek scherp is.
- **View-logging op het Decision Object zelf.** Past niet in deze scope (en sluit aan op procedure-audit-bevinding §3: claim "wie heeft gezien" wordt versmald in `PROCEDURE-MVP1-ONTWERP.md`).
- **Eigenaars-FK voor `agendapunten.verantwoordelijke`, `procedure_eigenaars.gebruiker_naam`, `risicos.eigenaar_naam`.** Blijft uitgesteld naar iteratie 4.
- **Wijzigingen aan stemming na sluiting.** Niet mogelijk; immutable.
- **Multi-stap stemmingen.** Niet in v1.

---

*Einde document v1.1. Reviewverzoek: lees per sectie en bevestig dat de verwerkte reviewer-adviezen accuraat zijn weergegeven. Daarna kan tranche 1 in een sessie worden gebouwd; tranche 2 daarna in een vervolgsessie.*
