# 0007 — Fondsconsistentie op koppeltabellen: composite-FK als standaard, trigger waar cross-tabel-logica nodig is

- **Status:** Geaccepteerd (18-06-2026) — bekrachtigd bij de start van Increment A; `fonds_id` op v2-join-tabellen akkoord; `on delete cascade` per join-FK gekozen
- **Datum:** 2026-06-18
- **Betrokkenen:** Merlin IJzerman
- **Scope:** start-deliverable Increment A (roadmap v1.2 §2, build blocker 5); raakt ook Increment C en F
- **Relatie:** TO v1.2 §2.2 (fondsconsistentie) + §2.4 (secundaire-koppeling-trigger); open technisch punt §9.2

## Context

Doorontwikkeling v2 vervangt `uuid[]`-relaties door join-tabellen en eist **fondsconsistentie op élke koppeltabel**: beide gekoppelde records moeten bij hetzelfde fonds horen. Het TO laat per koppeltabel twee implementaties toe (§2.2) — **composite-FK** (voorkeur) of **trigger** — en parkeert de definitieve keuze als implementatiebeslissing. Deze notitie maakt die keuze expliciet en testbaar vóór Increment A in code gaat.

### Feitelijke as-built situatie (geverifieerd tegen migraties, 18-06-2026)

1. **Bestaande tenant-isolatie**: alleen toptabellen (`procedures`, `decision_objects`) dragen `fonds_id`. Childtabellen (`procedure_stappen`, `decision_assumptions`, …) dragen géén `fonds_id` en isoleren via een **parent-join in de RLS-policy**. Het TO kiest voor v2 bewust om `fonds_id` wél op de join-tabellen te zetten — een afwijking van de huidige conventie, en een **harde voorwaarde** voor composite-FK.
2. **Er bestaat geen enkele `UNIQUE (fonds_id, id)`** op een parenttabel. Composite-FK vereist die als referentiedoel; toevoegen is triviaal (additieve constraint).
3. **Geen precedent voor fondsconsistentie-triggers.** Triggers zijn wel in gebruik (`decision_object`: code-generatie, touch, append-only, hash, status-check, snapshot), dus het patroon is bekend in de codebase.
4. **Globale templates** (`gremia`/`expertises`/`kritische_focusgebieden` met `fonds_id IS NULL`) zijn per TO §2.1-regel 3 nooit rechtstreeks koppelbaar; join-tabellen verwijzen uitsluitend naar fonds-specifieke records.

## Besluit

**Standaard = composite-FK.** Op alle join-tabellen met twee fonds-gebonden parents wordt fondsconsistentie puur declaratief afgedwongen via composite foreign keys. Dit geldt voor Increment A (`procesmodel_gremia`, `procesmodel_expertises`, `procesmodel_focusgebieden`) en Increment F (`profiel_expertises`, `profiel_gremia`, `profiel_focusgebieden`).

**Uitzondering = trigger, uitsluitend waar cross-tabel-logica tóch een trigger vereist.** Voor `document_procesinstanties` (Increment C) is een `BEFORE INSERT/UPDATE`-trigger sowieso nodig voor regels die geen FK kan uitdrukken (secundair ≠ primair; weiger primaire-wijziging die een secundaire koppeling zou dupliceren — TO §2.4 punt 11). De fondsconsistentie-check wordt in diezelfde trigger meegenomen; een aparte composite-FK is daar overbodig.

### Concrete vorm

Parenttabellen krijgen het composite-FK-doel:

```sql
-- elke fonds-gebonden parent (procesmodellen, gremia, expertises, kritische_focusgebieden)
alter table public.procesmodellen
  add constraint uq_procesmodellen_fonds_id unique (fonds_id, id);
-- id is al PK (globaal uniek); deze unieke sleutel dient enkel als FK-doel.
```

Join-tabel met `fonds_id NOT NULL` en twee composite-FK's:

```sql
create table if not exists public.procesmodel_gremia (
  id            uuid primary key default uuid_generate_v4(),
  fonds_id      uuid not null,
  procesmodel_id uuid not null,
  gremium_id    uuid not null,
  aangemaakt    timestamptz default now(),
  unique (procesmodel_id, gremium_id),
  foreign key (fonds_id, procesmodel_id)
    references public.procesmodellen (fonds_id, id) on delete cascade,
  foreign key (fonds_id, gremium_id)
    references public.gremia (fonds_id, id) on delete cascade
);
```

RLS blijft het bestaande, eenvoudige patroon op de eigen kolom:

```sql
alter table public.procesmodel_gremia enable row level security;
create policy "fonds procesmodel_gremia" on public.procesmodel_gremia
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));
```

**Randvoorwaarden bij de keuze:**
- `fonds_id` op join-tabellen is **`NOT NULL`**. Dit voorkomt de MATCH-SIMPLE-valkuil (een composite-FK wordt niet gecontroleerd zodra één kolom NULL is) en sluit verwijzing naar globale templates declaratief uit.
- De globale templates (`fonds_id IS NULL`) blijven daardoor on-koppelbaar zonder extra check — dit borgt TO §2.1-regel 3 als bijvangst.
- `gremia.gekoppeld_van_id` (self-FK naar de template) blijft een gewone single-column FK; daar speelt fondsconsistentie niet.

## Overwogen alternatieven

- **Overal triggers** — consistent één mechanisme, maar zwakker (procedureel i.p.v. declaratief), duurder per write, en kwetsbaar bij bulk-/backfill-paden die triggers omzeilen. Verworpen als standaard.
- **Composite-FK ook voor `document_procesinstanties`** — kan de fondscheck wel, maar niet de "secundair ≠ primair"- en duplicaat-bij-wijziging-regels; die vereisen sowieso een trigger. Twee mechanismen op één tabel is onnodige complexiteit; daarom daar alles in de trigger.
- **Childtabel zonder eigen `fonds_id` (huidige conventie voortzetten), isolatie via parent-join + security-definer** — blijft dichter bij de bestaande stijl, maar maakt composite-FK onmogelijk en verschuift integriteitsbewaking naar applicatie/RLS. Verworpen: de TO-eis is juist hardere, declaratieve integriteit.

## Gevolgen

- **Bewuste afwijking van de bestaande conventie**: v2-join-tabellen dragen `fonds_id`; bestaande v1-childtabellen niet. Dit is consistent binnen v2 en moet als zodanig in HANDOVER/conventies worden vastgelegd, zodat het verschil bewust en niet per ongeluk is.
- **Migraties Increment A**: per catalogustabel een `unique (fonds_id, id)`; per join-tabel `fonds_id NOT NULL` + twee composite-FK's + `unique`-paar + RLS. Additief en omkeerbaar (ROLLBACK = drop join-tabellen + drop unieke sleutels).
- **Increment C**: `document_procesinstanties` krijgt de trigger uit TO §2.4 punt 11, uitgebreid met de fondscheck; geen composite-FK.
- **Increment F**: `profiel_*`-join-tabellen volgen het composite-FK-patroon van A.
- **Regressietests (TO §2.2 punt 6)**: fonds A kan geen catalogus/koppeling van fonds B lezen of schrijven; een insert met inconsistente `fonds_id` faalt op de FK (composite-tabellen) resp. de trigger (`document_procesinstanties`); een poging tot koppeling aan een globale template (`fonds_id NULL`) faalt op de FK.
- **Performance**: composite-FK is goedkoper dan een trigger per write; verwaarloosbaar bij MVP-volume maar netjes.

## Openstaand / te valideren

- ~~Bevestig akkoord op het dragen van `fonds_id` op v2-join-tabellen (afwijking v1-conventie).~~ **Akkoord (18-06-2026)** bij de start van Increment A.
- ~~Definitieve keuze `on delete cascade` vs. `restrict` per FK.~~ **Gekozen: `on delete cascade` op alle join-FK's** (Increment A). Onderbouwing: organen worden niet hard-deleted maar soft-disabled (`actief=false`, koppelingen behouden — FO §4 module 2); de API weigert hard delete van organen, waardoor de organ-side cascade in de praktijk inert is. Verwijderen van een procesmodel ruimt zijn koppelingen op. De koppellog (`catalogus_log`) borgt het auditspoor van (ont)koppelingen.

## Referenties

- TO v1.2 §2.1 (globale templates), §2.2 (fondsconsistentie), §2.4 punt 11 (secundaire-koppeling-trigger), §9.2 (open punt).
- Roadmap v1.2 §2 Increment A (start-deliverable) + §6 build blocker 5.
- As-built: `mvp/supabase/migrations/2026_04_29_procedures.sql`, `2026_05_07_decision_object.sql`, `2026_06_07_fonds_instellingen.sql`.
- `mvp/decisions/0006` (B-besluiten, O1 multi-fonds).
