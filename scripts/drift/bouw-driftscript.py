#!/usr/bin/env python3
"""#440 — bouwt het read-only driftscript voor een doelomgeving.

De verwachte stand komt uit de gegenereerde bestanden; de vergelijkingsquery
komt uit scripts/drift/vingerafdruk.sql, zodat referentie en doel gegarandeerd
DEZELFDE meting doen. Eén bron voor de meetmethode, één bron voor de verwachting.
"""
import io, csv

def q(x: str) -> str:
    return "'" + x.replace("'", "''") + "'"

verwacht = list(csv.DictReader(io.open("supabase/checks/440-verwachte-stand.generated.tsv",
                                       encoding="utf-8"), delimiter="\t"))
zonder = list(csv.DictReader(io.open("supabase/checks/440-migraties-zonder-kenmerk.generated.tsv",
                                     encoding="utf-8"), delimiter="\t"))
meting = io.open("scripts/drift/vingerafdruk.sql", encoding="utf-8").read()
# De kop van de meetquery eruit; alleen het SELECT-deel is herbruikbaar.
meting = meting[meting.index("select sectie, sch, obj"):].rstrip().rstrip(";")

kop = """-- ============================================================================
--  #440 — READ-ONLY driftinventarisatie van een doelomgeving
-- ----------------------------------------------------------------------------
--  GEGENEREERD BESTAND. Niet met de hand bijwerken; draai
--  `bash scripts/drift/genereer.sh` opnieuw tegen een referentie-DB die met
--  scripts/testdb-apply-migrations.sh uit supabase/migrations/ is opgebouwd.
--
--  WAT DIT MEET, EN WAAROM IN TWEE LAGEN
--    Laag 1 — BESTAAN. Welke objecten horen er te zijn (de V3-scope: schema's
--      public en storage) en welke ontbreken.
--    Laag 2 — DEFINITIE. Van elk object een vingerafdruk over de werkelijke
--      definitie: functiebody inclusief volatility en search_path, kolomvorm,
--      viewquery, policypredicaat, RLS-stand, triggerdefinitie, indexdefinitie
--      en check-constraints.
--
--    Laag 2 bestaat omdat laag 1 niet genoeg is. De drift die op Preview
--    werkelijk optrad — de ontbrekende #367/#368-auditprojecties — bestond uit
--    functies die er WEL waren, met de JUISTE rechten, maar met een verouderde
--    body. Een inventarisatie die alleen bestaan en rechten toetst, had die
--    gemist. De V3-grants-gate blijft daarnaast gewoon nodig: zij dekt de
--    rechten, die hier niet worden gemeten.
--
--  OORDEEL PER MIGRATIE
--    aanwezig            — al haar meetbare objecten bestaan en komen overeen
--    ontbreekt           — ten minste één van haar objecten bestaat niet
--    afwijkend           — alle objecten bestaan, maar ten minste één definitie
--                          wijkt af
--    niet vast te stellen— zij laat geen meetbaar catalogusspoor na. MET REDEN,
--                          nooit als kale categorie: een migratie die niet te
--                          meten is, hoort dat expliciet te zeggen in plaats van
--                          als 'aanwezig' door te glippen.
--
--  ONBEKENDE OBJECTEN zijn begrensd tot exact de scope die de V3-allowlist
--  beheert. Buiten die scope is 'onbekend' geen bevinding maar ruis.
--
--  STRIKT READ-ONLY: geen insert, update, delete, DDL, tijdelijke tabel of
--  `set role`. SQL-editorvast: geen psql-metacommando's.
--
--  ROL: database-eigenaar/postgres. Deze inventarisatie meet de STAND van de
--    catalogus, niet het gedrag van één sessie.
-- ============================================================================

-- ── 0. DOELBEVESTIGING. Eerst, en fail-closed ───────────────────────────────
do $$
begin
  if not exists (select 1 from public.tenant_domains
                  where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.bestuurdersportaal.com'
                   and host not like '%.preview.bestuurdersportaal.com')
  then
    raise exception '#440 VERKEERDE DOELOMGEVING: Preview-fingerprint ontbreekt of er staat een productiehost. Deze inventarisatie hoort op portal_preview te draaien; pas de doelcontrole bewust aan vóór een meting op een andere omgeving.';
  end if;
  raise notice '#440 doel bevestigd: Preview.';
end $$;
"""

verwacht_values = ",\n    ".join(
    "({},{},{},{},{})".format(q(r["sectie"]), q(r["sch"]), q(r["obj"]),
                              q(r["vingerafdruk"]), q(r["migratie"] or ""))
    for r in verwacht)

zonder_values = ",\n    ".join(
    "({},{},{})".format(q(r["migratie"]), q(r["categorie"]), q(r["toelichting"]))
    for r in zonder)

body = f"""
-- ── 1. Objectverschillen ────────────────────────────────────────────────────
with verwacht(sectie, sch, obj, vingerafdruk, migratie) as (
  values
    {verwacht_values}
),
actueel as (
{meting}
),
vergelijk as (
  select coalesce(v.sectie, a.sectie) as sectie,
         coalesce(v.sch, a.sch)       as sch,
         coalesce(v.obj, a.obj)       as obj,
         v.migratie,
         case when a.obj is null then 'ontbreekt'
              when v.obj is null then 'onbekend'
              when v.vingerafdruk is distinct from a.vingerafdruk then 'afwijkend'
              else 'gelijk' end as oordeel
    from verwacht v
    full outer join actueel a
      on a.sectie = v.sectie and a.sch = v.sch and a.obj = v.obj
)
select '1. OBJECTVERSCHILLEN' as rapport, oordeel, sectie, sch, obj,
       coalesce(nullif(migratie, ''), '(baseline of niet toewijsbaar)') as migratie
  from vergelijk
 where oordeel <> 'gelijk'
 order by case oordeel when 'ontbreekt' then 1 when 'afwijkend' then 2 else 3 end,
          sectie, sch, obj;

-- ── 2. Oordeel per migratie ─────────────────────────────────────────────────
with verwacht(sectie, sch, obj, vingerafdruk, migratie) as (
  values
    {verwacht_values}
),
actueel as (
{meting}
),
vergelijk as (
  select v.migratie,
         case when a.obj is null then 'ontbreekt'
              when v.vingerafdruk is distinct from a.vingerafdruk then 'afwijkend'
              else 'gelijk' end as oordeel
    from verwacht v
    left join actueel a
      on a.sectie = v.sectie and a.sch = v.sch and a.obj = v.obj
   where v.migratie <> ''
),
per_migratie as (
  select migratie,
         count(*) as objecten,
         count(*) filter (where oordeel = 'ontbreekt') as ontbreekt,
         count(*) filter (where oordeel = 'afwijkend') as afwijkend
    from vergelijk group by migratie
),
zonder_kenmerk(migratie, categorie, toelichting) as (
  values
    {zonder_values}
)
select '2. PER MIGRATIE' as rapport,
       migratie,
       case when ontbreekt > 0 then 'ontbreekt'
            when afwijkend > 0 then 'afwijkend'
            else 'aanwezig' end as oordeel,
       objecten::text || ' object(en); ' || ontbreekt::text || ' ontbrekend, '
         || afwijkend::text || ' afwijkend' as toelichting
  from per_migratie
union all
select '2. PER MIGRATIE', migratie, 'niet vast te stellen',
       categorie || ' — ' || toelichting
  from zonder_kenmerk
 order by 3 desc, 2;

-- ── 3. Samenvatting ─────────────────────────────────────────────────────────
with verwacht(sectie, sch, obj, vingerafdruk, migratie) as (
  values
    {verwacht_values}
),
actueel as (
{meting}
),
vergelijk as (
  select coalesce(v.obj, a.obj) as obj,
         case when a.obj is null then 'ontbreekt'
              when v.obj is null then 'onbekend'
              when v.vingerafdruk is distinct from a.vingerafdruk then 'afwijkend'
              else 'gelijk' end as oordeel
    from verwacht v
    full outer join actueel a
      on a.sectie = v.sectie and a.sch = v.sch and a.obj = v.obj
)
select '3. SAMENVATTING' as rapport, oordeel, count(*) as objecten
  from vergelijk group by oordeel order by 2;
"""

io.open("supabase/checks/2026_09_23_440_driftinventarisatie.generated.sql", "w",
        encoding="utf-8").write(kop + body)
print(f"geschreven: {len(verwacht)} verwachte objecten, {len(zonder)} niet-meetbare migraties")
