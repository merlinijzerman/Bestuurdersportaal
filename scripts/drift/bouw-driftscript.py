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
# De historie: per object ELKE vorm die de keten ooit heeft opgeleverd, met de
# migratie die hem schreef. Daarmee wordt "afwijkend" beantwoordbaar: welke
# vorm draagt het doel dan wél, en sinds welke migratie loopt het achter?
historie = list(csv.DictReader(io.open("supabase/checks/440-historische-vormen.generated.tsv",
                                       encoding="utf-8"), delimiter="\t"))
# Wat migraties VERWIJDEREN en wat na de volledige keten werkelijk weg is.
# Een contractmigratie is daaraan te meten, en aan niets anders.
afwezig = list(csv.DictReader(io.open("supabase/checks/440-afwezig-verwacht.generated.tsv",
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
--  DOEL: {doel}. Deze uitvoer is uitsluitend voor {omgeving}; de SQL
--    weigert de andere omgeving voordat een catalogusmeting begint.
-- ============================================================================

-- ── 0. DOELBEVESTIGING. Eerst, en fail-closed ───────────────────────────────
do $$
begin
  if {doelcontrole}
  then
    raise exception '#440 VERKEERDE DOELOMGEVING: verwacht {omgeving}; geen meting uitgevoerd.';
  end if;
  raise notice '#440 doel bevestigd: {doel}.';
end $$;
"""

# Twee editor-klare bestanden, één meetbody. Een vrij invulbare parameter in de
# SQL Editor zou de doelgrendel tot een afspraak maken; de doelkeuze staat
# daarom vast in de bestandsnaam én in de voorafgaande SQL-controle.
DOELEN = {
    "preview": {
        "doel": "portal_preview",
        "omgeving": "Preview",
        "doelcontrole": """not exists (select 1 from public.tenant_domains
                  where host = 'app.preview.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.bestuurdersportaal.com'
                   and host not like '%.preview.bestuurdersportaal.com')""",
    },
    "productie": {
        "doel": "portal_production",
        "omgeving": "Productie",
        "doelcontrole": """not exists (select 1 from public.tenant_domains
                  where host = 'app.bestuurdersportaal.com' and actief)
     or exists (select 1 from public.tenant_domains
                 where host like '%.preview.bestuurdersportaal.com')""",
    },
}

verwacht_values = ",\n    ".join(
    "({},{},{},{},{})".format(q(r["sectie"]), q(r["sch"]), q(r["obj"]),
                              q(r["vingerafdruk"]), q(r["migratie"] or ""))
    for r in verwacht)

afwezig_values = ",\n    ".join(
    "({},{},{})".format(q(r["soort"]), q(r["object"]), q(r["migratie"])) for r in afwezig)

historie_values = ",\n    ".join(
    "({},{},{},{},{})".format(q(r["sectie"]), q(r["sch"]), q(r["obj"]),
                              q(r["vingerafdruk"]), q(r["migratie"]))
    for r in historie)

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
         a.vingerafdruk as actueel_vp,
         case when a.obj is null then 'ontbreekt'
              when v.obj is null then 'onbekend'
              when v.vingerafdruk is distinct from a.vingerafdruk then 'afwijkend'
              else 'gelijk' end as oordeel
    from verwacht v
    full outer join actueel a
      on a.sectie = v.sectie and a.sch = v.sch and a.obj = v.obj
),
historie(sectie, sch, obj, vingerafdruk, migratie) as (
  values
    {historie_values}
)
select '1. OBJECTVERSCHILLEN' as rapport,
       case when v.sch = 'storage' then 'platform (storage)' else 'applicatie (public)' end as laag,
       v.oordeel, v.sectie, v.sch, v.obj,
       coalesce(nullif(v.migratie, ''), '(baseline of niet toewijsbaar)') as verwacht_uit,
       -- Draagt het doel een OUDERE vorm? Dan zegt dit welke migratie hem
       -- schreef, en dus waar de keten is blijven steken. Herkent de historie
       -- de vorm niet, dan is het geen achterstand maar een handmatige
       -- wijziging op de doelomgeving - een andere bevinding, en een ergere.
       case when v.oordeel <> 'afwijkend' then ''
            when h.migratie is null then 'vorm onbekend in de keten — handmatig gewijzigd?'
            else 'doel draagt nog de vorm van ' || h.migratie end as duiding,
       -- De gemeten vingerafdruk zelf. Bij 'vorm onbekend' is dit het enige
       -- aanknopingspunt om achteraf uit te zoeken WELKE vorm het dan wel is —
       -- bijvoorbeeld een tussenversie van een migratiebestand dat na
       -- toepassing nog is herzien.
       coalesce(v.actueel_vp, '') as gemeten_vingerafdruk
  from vergelijk v
  left join historie h
    on h.sectie = v.sectie and h.sch = v.sch and h.obj = v.obj
   and h.vingerafdruk = v.actueel_vp
 where v.oordeel <> 'gelijk'
 order by case when v.sch = 'storage' then 2 else 1 end,
          case v.oordeel when 'ontbreekt' then 1 when 'afwijkend' then 2 else 3 end,
          v.sectie, v.sch, v.obj;

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
  select coalesce(v.sch, a.sch) as sch, coalesce(v.obj, a.obj) as obj,
         case when a.obj is null then 'ontbreekt'
              when v.obj is null then 'onbekend'
              when v.vingerafdruk is distinct from a.vingerafdruk then 'afwijkend'
              else 'gelijk' end as oordeel
    from verwacht v
    full outer join actueel a
      on a.sectie = v.sectie and a.sch = v.sch and a.obj = v.obj
)
select '3. SAMENVATTING' as rapport,
       case when sch = 'storage' then 'platform (storage)' else 'applicatie (public)' end as laag,
       oordeel, count(*) as objecten
  from vergelijk group by 2, oordeel order by 2, 3;
"""

body += f"""
-- ── 4. Afwezigheidscontrole: wat verwijderd HOORT te zijn ───────────────────
--  Een contractmigratie laat geen nieuw object achter; zij is uitsluitend te
--  meten aan de afwezigheid van wat zij dropt. Staat het er nog, dan is die
--  migratie niet (volledig) toegepast.
with verwacht_afwezig(soort, object, migratie) as (
  values
    {afwezig_values}
)
select '4. AFWEZIGHEIDSCONTROLE' as rapport,
       migratie, soort, object,
       case when soort = 'FUNC' and to_regprocedure(object) is not null then 'NOG AANWEZIG'
            when soort = 'REL'  and to_regclass(object)     is not null then 'NOG AANWEZIG'
            else 'correct afwezig' end as oordeel
  from verwacht_afwezig
 order by 5 desc, 2, 4;
"""

for naam, doel in DOELEN.items():
    pad = ("supabase/checks/2026_09_23_440_driftinventarisatie.generated.sql"
           if naam == "preview" else
           "supabase/checks/2026_09_23_440_driftinventarisatie_productie.generated.sql")
    io.open(pad, "w", encoding="utf-8").write(kop.format(**doel) + body)
    print(f"geschreven: {pad} ({len(verwacht)} objecten, "
          f"{len(zonder)} niet-meetbare migraties, {len(afwezig)} gedropte objecten)")
