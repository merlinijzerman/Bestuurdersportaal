-- ============================================================================
-- Migratie 2026-06-24 — Gremia: categorie-indeling (A/B/C) + reset templates.
-- ----------------------------------------------------------------------------
-- Voegt een NIEUWE dimensie `categorie` toe aan gremia, ORTHOGONAAL aan het
-- bestaande functionele `type` (besluitvormend/adviserend/…). De categorie
-- groepeert organen naar herkomst/rol in de keten:
--   * fondsorgaan        — organen van het fonds zelf (A)
--   * bestuurscommissie  — commissies die het bestuur adviseren (B)
--   * extern_ketenpartner— uitbestede/externe partijen (C)
--
-- "Volledige reset van de standaardtemplates": de globale templateset
-- (fonds_id IS NULL) wordt vervangen door de complete A/B/C-set. Reset gebeurt
-- via UPSERT + soft-deactivatie, NIET via hard delete: fonds-kopieën verwijzen
-- via gekopieerd_van_id (FK, geen cascade) naar templates, dus DELETE zou falen
-- én historie/koppelingen breken. Dit volgt het bestaande principe "organen
-- worden nooit hard-deleted" (FO §4 module 2).
--
-- Doorwerking naar fondsen:
--   1. Bestaande fonds-kopieën krijgen categorie BACKFILLED vanuit hun template
--      (zodat reeds-geïmporteerde fondsen niets extra hoeven te doen).
--   2. Fonds-kopieën waarvan het brontemplate nu inactief is, worden
--      gedeactiveerd (soft). NB: een eventueel in een profiel geselecteerd
--      gremium blijft in de DB bewaard maar verdwijnt uit de actieve keuzelijst.
--   3. NIEUWE templates komen er via de bestaande idempotente import (O1) bij.
--
-- WERKVOORSTEL: te valideren met de bestuurssecretaris vóór livegang
-- (besluit/§17.5). Namen, type- en categorie-toewijzing zijn per fonds
-- aanpasbaar; dit zijn importeerbare startwaarden. De `type`-toewijzing per
-- orgaan is een professionele inschatting (zie inline), geen normstelling.
--
-- Idempotent. Eerst in Supabase draaien, dan code-deploy.
-- ROLLBACK: zie 2026_06_24_gremia_categorie_ROLLBACK.sql.
-- ============================================================================

-- ── 1. Kolom + check-constraint ────────────────────────────────────────────
alter table public.gremia
  add column if not exists categorie text;

alter table public.gremia
  drop constraint if exists gremia_categorie_check;
alter table public.gremia
  add constraint gremia_categorie_check
  check (categorie is null or categorie in
        ('fondsorgaan','bestuurscommissie','extern_ketenpartner'));

create index if not exists idx_gremia_categorie
  on public.gremia (categorie) where categorie is not null;

-- ── 2. Reseed globale templates (fonds_id NULL) — volledige A/B/C-set ───────
-- UPSERT op de partiële template-uniciteit (naam where fonds_id is null). Zo
-- worden bestaande gelijknamige templates (Bestuur, BAC, …) bijgewerkt i.p.v.
-- gedupliceerd, en nieuwe items toegevoegd. sort_order: A=100.., B=200.., C=300..
insert into public.gremia (fonds_id, naam, type, categorie, omschrijving, sort_order, actief) values
  -- A. Fondsorganen ---------------------------------------------------------
  (null, 'Bestuur',                                  'besluitvormend',  'fondsorgaan', 'Het verantwoordelijke bestuursorgaan van het fonds.',                              100, true),
  (null, 'Dagelijks bestuur / uitvoerend bestuur',   'besluitvormend',  'fondsorgaan', 'Dagelijkse/uitvoerende leiding binnen mandaat van het bestuur.',                   110, true),
  (null, 'Verantwoordingsorgaan (VO)',               'toezichthoudend', 'fondsorgaan', 'Beoordeelt het handelen van het bestuur; advies- en verantwoordingsrechten.',      120, true),
  (null, 'Belanghebbendenorgaan (BO)',               'toezichthoudend', 'fondsorgaan', 'Medezeggenschaps-/goedkeuringsorgaan namens belanghebbenden.',                     130, true),
  (null, 'Raad van Toezicht (RvT)',                  'toezichthoudend', 'fondsorgaan', 'Houdt intern toezicht op beleid en algemene gang van zaken.',                      140, true),
  (null, 'Visitatiecommissie',                       'toezichthoudend', 'fondsorgaan', 'Periodieke visitatie/intern toezicht (indien van toepassing).',                    150, true),
  (null, 'Niet-uitvoerende bestuurders',             'toezichthoudend', 'fondsorgaan', 'Niet-uitvoerende bestuursleden (omgekeerd gemengd model).',                        160, true),
  (null, 'Sleutelfunctiehouder risicobeheer',        'toezichthoudend', 'fondsorgaan', 'Sleutelfunctie risicobeheer (IORP II).',                                           170, true),
  (null, 'Sleutelfunctiehouder actuariaat',          'toezichthoudend', 'fondsorgaan', 'Sleutelfunctie actuariële functie (IORP II).',                                     180, true),
  (null, 'Sleutelfunctiehouder interne audit',       'toezichthoudend', 'fondsorgaan', 'Sleutelfunctie interne audit (IORP II).',                                          190, true),
  -- B. Bestuurscommissies ---------------------------------------------------
  (null, 'Beleggingsadviescommissie (BAC)',          'adviserend',      'bestuurscommissie', 'Adviseert het bestuur over beleggingsbeleid en -uitvoering.',                 200, true),
  (null, 'Risicocommissie',                          'adviserend',      'bestuurscommissie', 'Adviseert over risicobeheersing (second line).',                             210, true),
  (null, 'Auditcommissie',                           'adviserend',      'bestuurscommissie', 'Adviseert over verslaggeving, controle en beheersing.',                      220, true),
  (null, 'Communicatiecommissie',                    'adviserend',      'bestuurscommissie', 'Adviseert over deelnemerscommunicatie.',                                     230, true),
  (null, 'Pensioencommissie / reglementscommissie',  'adviserend',      'bestuurscommissie', 'Adviseert over pensioenregeling en reglementen.',                            240, true),
  (null, 'Uitbestedingscommissie / leverancierscommissie', 'adviserend','bestuurscommissie', 'Adviseert over uitbesteding en leveranciersmanagement.',                     250, true),
  (null, 'Governance- of benoemingscommissie',       'adviserend',      'bestuurscommissie', 'Adviseert over governance, geschiktheid en benoemingen.',                    260, true),
  (null, 'IT-, data- en informatiebeveiligingscommissie', 'adviserend', 'bestuurscommissie', 'Adviseert over IT, data en informatiebeveiliging.',                          270, true),
  (null, 'Transitie- of implementatiecommissie',     'adviserend',      'bestuurscommissie', 'Adviseert over transitie/implementatie (o.a. Wtp).',                         280, true),
  -- C. Externe ketenpartners ------------------------------------------------
  (null, 'Pensioenuitvoerder',                       'uitvoerend',      'extern_ketenpartner', 'Voert de pensioenadministratie en -uitvoering uit (uitbesteed).',          300, true),
  (null, 'Vermogensbeheerder',                       'uitvoerend',      'extern_ketenpartner', 'Voert het beleggingsbeleid operationeel uit (uitbesteed).',                310, true),
  (null, 'Fiduciair manager',                        'uitvoerend',      'extern_ketenpartner', 'Coördineert en adviseert integraal vermogensbeheer (uitbesteed).',         320, true),
  (null, 'Custodian / bewaarder',                    'uitvoerend',      'extern_ketenpartner', 'Bewaring en administratie van beleggingen.',                               330, true),
  (null, 'Accountant',                               'uitvoerend',      'extern_ketenpartner', 'Externe (controlerend) accountant.',                                       340, true),
  (null, 'Certificerend actuaris',                   'uitvoerend',      'extern_ketenpartner', 'Certificeert de actuariële opzet (extern).',                               350, true),
  (null, 'Adviserend actuaris',                      'uitvoerend',      'extern_ketenpartner', 'Adviseert over actuariële vraagstukken (extern).',                         360, true),
  (null, 'Compliance officer',                       'uitvoerend',      'extern_ketenpartner', 'Compliancefunctie (intern of uitbesteed).',                                370, true),
  (null, 'Privacy officer / Functionaris Gegevensbescherming', 'uitvoerend', 'extern_ketenpartner', 'Privacy/FG-functie (AVG).',                                          380, true),
  (null, 'IT- of dataleverancier',                   'uitvoerend',      'extern_ketenpartner', 'IT-/dataleverancier (uitbesteed).',                                        390, true),
  (null, 'Communicatiebureau',                       'uitvoerend',      'extern_ketenpartner', 'Extern communicatiebureau.',                                               400, true)
on conflict (naam) where fonds_id is null
do update set
  type        = excluded.type,
  categorie   = excluded.categorie,
  omschrijving= excluded.omschrijving,
  sort_order  = excluded.sort_order,
  actief      = true,
  bijgewerkt  = now();

-- ── 3. Deactiveer obsolete templates ───────────────────────────────────────
-- Templates die NIET in de nieuwe canonieke set zitten (bv. de oude
-- 'Dagelijks bestuur') worden soft-gedeactiveerd. Niet verwijderd: fonds-
-- kopieën verwijzen ernaar via gekopieerd_van_id.
update public.gremia
set actief = false, bijgewerkt = now()
where fonds_id is null
  and actief = true
  and naam not in (
    'Bestuur',
    'Dagelijks bestuur / uitvoerend bestuur',
    'Verantwoordingsorgaan (VO)',
    'Belanghebbendenorgaan (BO)',
    'Raad van Toezicht (RvT)',
    'Visitatiecommissie',
    'Niet-uitvoerende bestuurders',
    'Sleutelfunctiehouder risicobeheer',
    'Sleutelfunctiehouder actuariaat',
    'Sleutelfunctiehouder interne audit',
    'Beleggingsadviescommissie (BAC)',
    'Risicocommissie',
    'Auditcommissie',
    'Communicatiecommissie',
    'Pensioencommissie / reglementscommissie',
    'Uitbestedingscommissie / leverancierscommissie',
    'Governance- of benoemingscommissie',
    'IT-, data- en informatiebeveiligingscommissie',
    'Transitie- of implementatiecommissie',
    'Pensioenuitvoerder',
    'Vermogensbeheerder',
    'Fiduciair manager',
    'Custodian / bewaarder',
    'Accountant',
    'Certificerend actuaris',
    'Adviserend actuaris',
    'Compliance officer',
    'Privacy officer / Functionaris Gegevensbescherming',
    'IT- of dataleverancier',
    'Communicatiebureau'
  );

-- ── 4. Backfill categorie op bestaande fonds-kopieën ───────────────────────
-- Reeds-geïmporteerde fonds-kopieën erven de categorie van hun brontemplate,
-- zodat de profielgroepering direct werkt zonder her-import.
update public.gremia f
set categorie = t.categorie, bijgewerkt = now()
from public.gremia t
where f.fonds_id is not null
  and f.gekopieerd_van_id = t.id
  and t.fonds_id is null
  and t.categorie is not null
  and (f.categorie is distinct from t.categorie);

-- ── 5. Deactiveer obsolete fonds-kopieën ───────────────────────────────────
-- Fonds-kopieën waarvan het brontemplate zojuist is gedeactiveerd (bv. de oude
-- 'Dagelijks bestuur') worden soft-gedeactiveerd. De vervangende template wordt
-- bij de volgende import als nieuw item toegevoegd.
update public.gremia f
set actief = false, bijgewerkt = now()
where f.fonds_id is not null
  and f.actief = true
  and f.gekopieerd_van_id is not null
  and exists (
    select 1 from public.gremia t
    where t.id = f.gekopieerd_van_id
      and t.fonds_id is null
      and t.actief = false
  );
