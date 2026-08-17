-- ============================================================================
--  WP1-B3 — reconciliatie van bestaande accounts na de app-metadata-grens
--  17-08-2026. UITSLUITEND LEZEN. Dit script wijzigt niets.
-- ----------------------------------------------------------------------------
--  WAAROM DIT SCRIPT NIETS PROMOVEERT.
--
--  De verleiding is om `raw_user_meta_data->>'fonds_id'` naar
--  `raw_app_meta_data` te kopiëren zodat bestaande accounts "kloppen". Dat mag
--  NIET. Precies dat veld is het lek: als een account ooit is ontstaan via
--  zelfregistratie, dan is de waarde erin door de gebruiker zélf gekozen. Hem
--  overzetten naar app-metadata zou die keuze alsnog tot privilege promoveren —
--  het lek dichten aan de voorkant en de opbrengst ervan legaliseren aan de
--  achterkant.
--
--  Hetzelfde geldt voor `profielen.fonds_id`: die kolom is gevuld dóór
--  maak_profiel() op basis van diezelfde user-metadata. Hij is dus geen
--  onafhankelijk bewijs van legitimiteit, hoe gezaghebbend hij verder ook is.
--
--  WAT WEL ONAFHANKELIJK BEWIJS IS: `platform_event_log`. Elk account dat via de
--  back-office is aangemaakt (`gebruikerAanmaken`) heeft daar een twee-fasen-
--  auditspoor, achter capability `platform.tenants.manage` en live AAL2, met het
--  fonds in het effect. Een account zonder zo'n spoor is niet per definitie fout
--  — het kan ouder zijn dan die keten — maar het is wél onbewezen, en onbewezen
--  is in deze context: apart beoordelen, niet automatisch promoveren.
--
--  UITKOMST: een telling per categorie. Op basis daarvan neemt een mens een
--  besluit per categorie; dat besluit wordt apart en expliciet uitgevoerd.
--
--  Draaien: plak in de Supabase SQL-editor van de doelomgeving, of
--    psql "$DB_URL" -f scripts/platform_metadata_reconciliatie.sql
-- ============================================================================

-- ── 1. Categorisering van alle auth-accounts ────────────────────────────────
-- Let op de scope: NIET alleen auth.users. Een auth-userlijst zegt niets over
-- de vraag of een bestaande fondstoewijzing legitiem is; daarvoor moeten
-- profielen en platform_identities ernaast.
with acc as (
  select
    u.id,
    u.email,
    u.created_at,
    (u.raw_app_meta_data ->> 'platform')  = 'true' as app_platform,
    (u.raw_user_meta_data->> 'platform')  = 'true' as user_platform_oud,
    u.raw_app_meta_data  ->> 'fonds_id'             as app_fonds,
    u.raw_user_meta_data ->> 'fonds_id'             as user_fonds_oud,
    p.fonds_id                                      as profiel_fonds,
    (pi.id is not null)                             as heeft_platform_identiteit,
    exists (
      -- Onafhankelijk bewijs: is dit account via de back-officeketen ontstaan?
      -- De koppeling loopt via het effect van gebruikerAanmaken. Alleen een
      -- GESLAAGDE resultaatfase telt — een 'attempt' of een geweigerde poging
      -- bewijst niets over legitimiteit.
      select 1
        from public.platform_event_log pel
       where pel.effect ->> 'aangemaakt_id' = u.id::text
         and pel.fase    = 'result'
         and pel.uitkomst = 'succes'
    )                                               as backoffice_spoor
  from auth.users u
  left join public.profielen p            on p.id  = u.id
  left join public.platform_identities pi on pi.id = u.id
)
select
  case
    when app_platform                       then 'A. platformaccount (app-metadata) — in orde'
    when user_platform_oud and not app_platform
                                            then 'B. platformaccount OUDE conventie — vlag staat in user-metadata'
    when app_fonds is not null              then 'C. tenantaccount (app-metadata) — in orde'
    when backoffice_spoor                   then 'D. tenantaccount zonder app-metadata, WEL back-officespoor — promoveerbaar op basis van het auditevent'
    when profiel_fonds is not null          then 'E. tenantaccount zonder app-metadata en ZONDER back-officespoor — apart beoordelen, NIET promoveren'
    else                                         'F. account zonder profiel en zonder metadata — apart beoordelen'
  end                                        as categorie,
  count(*)                                   as aantal,
  min(created_at)                            as oudste,
  max(created_at)                            as nieuwste
from acc
group by 1
order by 1;

-- ── 2. Categorie D — de enige promoveerbare groep, met de bron erbij ────────
-- Het fonds komt hier UIT HET AUDITEVENT, niet uit de metadata en niet uit
-- profielen. Wijkt het auditfonds af van het profielfonds, dan is dat een
-- bevinding op zichzelf en gaat het account naar de handmatige beoordeling.
-- `doel_fonds_id` is een eersteklas auditkolom en daarmee sterker bewijs dan
-- het jsonb-effect; beide worden getoond zodat onderlinge afwijking opvalt.
select
  u.email,
  u.id,
  p.fonds_id                                        as profiel_fonds,
  pel.doel_fonds_id                                 as audit_doel_fonds,
  (pel.effect ->> 'fonds_id')::uuid                 as audit_effect_fonds,
  (p.fonds_id is distinct from pel.doel_fonds_id)   as wijkt_af,
  pel.tijdstip                                      as aangemaakt_volgens_audit
from auth.users u
join public.profielen p on p.id = u.id
join public.platform_event_log pel
  on  pel.effect ->> 'aangemaakt_id' = u.id::text
  and pel.fase     = 'result'
  and pel.uitkomst = 'succes'
where u.raw_app_meta_data ->> 'fonds_id' is null
  and coalesce((u.raw_app_meta_data ->> 'platform') = 'true', false) is not true
order by wijkt_af desc, u.email;

-- ── 3. Categorie E/F — apart beoordelen ────────────────────────────────────
-- Geen automatische actie, en met nadruk GEEN automatische delete: een account
-- opruimen is een handeling met een eigenaar en een autorisatie, geen bijvangst
-- van een migratie.
select
  u.email,
  u.id,
  u.created_at,
  p.fonds_id                             as profiel_fonds,
  (u.raw_user_meta_data ->> 'fonds_id')  as user_fonds_oud,
  (p.fonds_id::text is distinct from u.raw_user_meta_data ->> 'fonds_id') as profiel_wijkt_af_van_usermeta,
  (pi.id is not null)                    as heeft_platform_identiteit
from auth.users u
left join public.profielen p            on p.id  = u.id
left join public.platform_identities pi on pi.id = u.id
where u.raw_app_meta_data ->> 'fonds_id' is null
  and coalesce((u.raw_app_meta_data ->> 'platform') = 'true', false) is not true
  and not exists (
    select 1 from public.platform_event_log pel
     where pel.effect ->> 'aangemaakt_id' = u.id::text
       and pel.fase     = 'result'
       and pel.uitkomst = 'succes'
  )
order by u.created_at;

-- ── 4. Signaal: profielen zonder auth-user, of andersom ────────────────────
-- Drift tussen de drie bronnen is zelf een bevinding.
select 'profiel zonder auth-user' as signaal, count(*) as aantal
  from public.profielen p
 where not exists (select 1 from auth.users u where u.id = p.id)
union all
select 'platform_identity zonder auth-user', count(*)
  from public.platform_identities pi
 where not exists (select 1 from auth.users u where u.id = pi.id)
union all
select 'platform_identity MET tenantprofiel (hoort niet samen te gaan)', count(*)
  from public.platform_identities pi
 where exists (select 1 from public.profielen p where p.id = pi.id);

-- ============================================================================
--  VERVOLG, per categorie — bewust NIET geautomatiseerd:
--
--   A, C  → niets doen.
--   B     → platform-vlag naar app-metadata tillen. Doe dit via
--           scripts/platform_bootstrap_beheerders.mjs (UITVOEREN=1), dat werkt
--           met een expliciete, in het script opgenomen beheerderslijst — een
--           allowlist, geen afleiding uit de metadata zelf.
--   D     → fonds uit het auditevent naar app-metadata. Alleen voor rijen waar
--           query 2 WIJKT_AF = false geeft. Wijkt het af: naar E.
--   E, F  → handmatige beoordeling met eigenaar en datum. Beleg als openstaand
--           punt; laat ze niet stilzwijgend blijven bestaan.
--
--  Zolang een account niet is gepromoveerd, blijft het gewoon werken: de trigger
--  raakt alleen INSERTs. Er is dus geen tijdsdruk die een haastige promotie
--  rechtvaardigt.
-- ============================================================================
