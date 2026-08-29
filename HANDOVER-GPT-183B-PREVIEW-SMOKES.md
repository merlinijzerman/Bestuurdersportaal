# Handover GPT — #183b preview-smokes (na merge naar `preview`)

**Doel:** de laatste twee waarnemingen vóór de `preview` → `main`-promotie. De DB-laag
is al bewezen (t3_cross_tenant + directe SQL) en spoor M is end-to-end bewezen
(snapshot-worker, 61 meetrijen). Deze twee smokes bewijzen wat de DB-proef niet dekt:

1. **Spoor M — lege-wachtvariant (negatief):** een worker met een lege wachtrij schrijft
   *niets* naar `platform_event_log` (de uitkomstregel uit 0193 §4).
2. **Spoor T — route-smokes (positief + tenant-isolatie):** de *gedeployede routes* raken
   de triggers/RPC, het event landt met het juiste `fonds_id`, en fonds B ziet het niet.

**Omgeving:** de `preview`-deploy (Vercel, project `bestuurdersportaal`) tegen de
**Preview-Supabase** — dezelfde DB waar je de migraties al plakte en spoor M draaide.
Merge-commit op `preview` = `6bca94a`.

> Alle asserties draaien als SQL tegen de **Preview-Supabase**. Alle `event_type`-waarden
> en kolomnamen hieronder komen letterlijk uit de gemergede migraties.

---

## Smoke 1 — spoor M, lege-wachtvariant (negatief)

**Regel (0193 §4):** een run die niets deed, schrijft niets. Alleen `snapshot` schrijft
altijd (die heeft altijd meetrijen); de andere vier zijn outcome-gescopet.

**Kies een worker met gegarandeerd lege wachtrij** — `afschrift-worker` (`geclaimd > 0`)
of `ingest-worker` (enig resultaatveld > 0). Verifieer eerst dat de wachtrij leeg is,
zodat de uitkomst nul is.

**Stappen:**
1. Noteer de tijd: `select now();` — noem dit `T0`.
2. Roep de workerroute aan met de CRON_SECRET-bearer (zoals bij de snapshot-proef), bv.:
   `POST https://<preview-url>/api/internal/afschrift-worker` met
   `Authorization: Bearer <PREVIEW_CRON_SECRET>`.
3. Verwacht **HTTP 200** met een resultaat waarin het outcome-veld **0** is
   (`geclaimd: 0` resp. alle `IngestWorkerResultaat`-velden 0).

**Assertie (moet leeg zijn):**
```sql
select count(*) as nieuwe_events
from platform_event_log
where handeling in ('afschrift.batch.verwerkt','ingest.batch.verwerkt')
  and gebeurd_op >= '<T0>';
-- verwacht: 0
```
> **Geslaagd** = HTTP 200 én 0 nieuwe rijen. Dit bewijst dat een lege run geen spoor
> achterlaat — precies wat de retentieloze, serialiserende tabel nodig heeft, en het
> sluit de terugkoppellus die 0193 §5 beschrijft (geen `attempt`-events → geen Signaal-14-gat).

---

## Smoke 2 — spoor T, route-smokes (positief + tenant-isolatie)

Draai deze **ingelogd als een test-bestuurder/voorzitter van fonds A** op de preview-app
(de routes vereisen een echte sessie + capability). Noteer het `fonds_id` van fonds A als
`A` en van een tweede fonds als `B`.

### 2a. Document deactiveren → `document_gedeactiveerd`
Route: `PATCH /api/documents/{id}` — body `{ "actie": "deactiveren", "reden": "smoke-test 183b" }`.
Vereist capability `documents.lifecycle.manage` (voorzitter/beheerder mag altijd; een
bestuurder alleen zijn eigen upload < 24 u). Kies een actief document van fonds A.

```sql
-- 1 nieuw ketengebeurtenis-event, met fonds_id = A:
select fonds_id, event_type, object_type, object_id, actor_naam, nieuwe_waarde
from governance_events
where object_type = 'document' and object_id = '<document_id>'
  and event_type = 'document_gedeactiveerd'
order by gebeurd_op desc limit 1;
-- verwacht: fonds_id = A, nieuwe_waarde bevat {"actief": false, "reden": "...", "titel": "..."}

-- de RPC deed óók de inzage-log in dezelfde transactie:
select actie, reden from document_inzage
where document_id = '<document_id>' order by gebeurd_op desc limit 1;
-- verwacht: actie = 'gedeactiveerd'
```
> De atomiciteit is het punt: status-flip + `document_inzage` + `governance_events` in één
> transactie (besluit B). Reactiveren kan als tegenproef: `"actie":"reactiveren"` →
> `document_gereactiveerd` + `document_inzage.actie = 'gereactiveerd'`.

### 2b. Vergadering + agendapunt aanmaken → `vergadering_aangemaakt` + `agendapunt_toegevoegd`
Maak via de app een **vergadering** aan, en daarin een **agendapunt**.

```sql
select event_type, object_type, object_id, actor_naam, nieuwe_waarde, fonds_id
from governance_events
where event_type in ('vergadering_aangemaakt','agendapunt_toegevoegd')
  and fonds_id = '<A>'
order by gebeurd_op desc limit 5;
-- verwacht: één 'vergadering_aangemaakt' (nieuwe_waarde = {titel,datum,status})
--           én één 'agendapunt_toegevoegd' (nieuwe_waarde = {vergadering_id,titel,categorie})
--           beide met fonds_id = A en actor_naam = de ingelogde naam
```

### 2c. Tenant-isolatie — fonds B ziet niets van fonds A
Log in als een gebruiker van **fonds B** (of query onder de `authenticated`-rol met B's
JWT-claim). De zojuist gemaakte events van fonds A mogen **niet zichtbaar** zijn.

```sql
-- onder de sessie/rol van fonds B:
select count(*) from governance_events
where object_id in ('<document_id>','<vergadering_id>','<agendapunt_id>');
-- verwacht: 0  (RLS filtert op fonds_id = B)
```
> Dit is de route-tegenhanger van t3_cross_tenant NEGATIEF #8: fonds B kan A's
> eigen-fonds-event niet lezen, ook niet via de OR-tak van het policy.

---

## Rapportageformat (drie uitkomsten per smoke)

Rapporteer per smoke één van: **groen** (verwachting exact gehaald) /
**afwijking** (met de echte waarde) / **niet uitgevoerd** (met reden). Bij een
`42883`/`23503`/RLS-fout: geef de volledige `sqlstate` + message — dat is de klasse
bug die eerder tweemaal opdook (ongekwalificeerde `digest` onder gepinde `search_path`).

**Zodra alle drie groen zijn** open ik de `preview` → `main`-PR. Let op: die promotie
vereist **Supabase-eerst op Productie** (de migraties eerst op de Productie-DB plakken,
dán de code-merge) en `ENFORCE_AUDIT` blijft **uit** tot de retentiebaan er is.
