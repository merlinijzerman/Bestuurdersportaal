# Handover GPT — #183b productie-smoke (na merge naar `main`)

**Context:** #215 is gemerged naar `main`; #183b draait nu op Productie met
**`ENFORCE_AUDIT` UIT** (inert). De migraties stonden al schoon op de Productie-Supabase
en `r1_structurele_gates` + `t3_cross_tenant` draaiden groen tegen Productie.

**Doel:** bevestigen dat de machinerie op Productie leeft en spoor M echt schrijft —
**zonder de auditketen te vervuilen.**

---

## ⚠️ Kernregel: géén UI-testobjecten op Productie aanmaken

`governance_events` is **append-only en immutable** (delete/update geblokkeerd door
trigger). Een vergadering/agendapunt aanmaken of een document deactiveren via de UI
schrijft dus een **permanent testevent in de productie-hashketen** dat je niet kunt
opruimen. Dat is auditvervuiling. **Doe dat niet.** De spoor-T-weg (trigger + RPC + FK +
policy) is al op Productie bewezen doordat `t3_cross_tenant` er groen draaide — die
controle exerceert precies die objecten. Verdere spoor-T-bevestiging op prod is niet nodig.

---

## Smoke 1 — deploy-check
Bevestig dat de `main` → **Production** Vercel-deploy groen bouwde (beide projecten:
`bestuurdersportaal` en `bestuurdersportaal-beheer`). Geen build-/runtime-errors in de logs.

## Smoke 2 — spoor M via échte data (geen pollutie)
De snapshot-cron draait vanzelf (elke 5 min). Bevestig dat er **verse** rijen in
`platform_event_log` staan van de snapshot-worker — dat is echte monitoringdata, geen testruis.

```sql
-- verse machine-events van de snapshot-worker (laatste uur):
select capability, identity_id, fase, handeling, gebeurd_op
from platform_event_log
where capability = 'platform.pipeline.operate'
  and handeling = 'monitoring.snapshot.geschreven'
  and gebeurd_op >= now() - interval '1 hour'
order by gebeurd_op desc limit 5;
-- verwacht: >=1 rij, identity_id = NULL, fase = 'result'
```
> Optioneel positief-trigger: roep `POST /api/platform/monitoring/snapshot` aan met de
> **productie**-`CRON_SECRET`-bearer en herhaal de query. (Snapshot schrijft altijd —
> die heeft meetrijen — dus dit vervuilt niets buiten de normale monitoringstroom.)

## Smoke 3 — spoor M lege-wacht (negatief)
Roep een worker met lege wachtrij aan (`afschrift-worker`/`ingest-worker`) met de
productie-`CRON_SECRET`. Verwacht HTTP 200 met outcome 0 en **geen** nieuw event.

```sql
select count(*) as nieuwe_events
from platform_event_log
where handeling in ('afschrift.batch.verwerkt','ingest.batch.verwerkt')
  and gebeurd_op >= '<T0 vóór de call>';
-- verwacht: 0
```

---

## Rapportage
Per smoke: **groen** / **afwijking (met waarde)** / **niet uitgevoerd (reden)**. Bij een
`42883`/`23503`/RLS-fout: volledige `sqlstate` + message.

**Zodra deze drie groen zijn** is de productie-livegang van #183b (inert) bevestigd.
`ENFORCE_AUDIT` blijft daarna **UIT** tot de retentiebaan er is — dat is het volgende werkblok.

> Kolomnamen ter herinnering: `platform_event_log` → **`gebeurd_op`**;
> `governance_events` → **`tijdstip`** (mocht je die toch willen lezen, alleen-lezen).
