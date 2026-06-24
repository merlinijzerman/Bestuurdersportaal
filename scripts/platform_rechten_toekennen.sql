-- ============================================================================
--  Rechten toekennen — twee gescheiden doelen. Draai in de Supabase SQL-editor.
-- ----------------------------------------------------------------------------
--  Er lopen twee autorisatielagen door elkaar. Kies bewust welke je nodig hebt:
--
--   INTENT A  Platform-identiteit (merlinijzerman+platform@gmail.com) mag de
--             STANDAARDCATALOGUS beheren in de back-office (de P2-module).
--             → platform-capability  platform.config.manage
--             → vult NIET automatisch de profieldropdowns; het maakt alleen de
--               platformbrede standaard beheerbaar.
--
--   INTENT B  Profieldropdowns NU vullen voor een fonds.
--             → vereist een TENANT-account (met profielen-rij) met rol
--               'beheerder' (draagt catalog.manage), dat daarna op /beheer de
--               import draait. Het +platform-account kan dit NIET.
--
--  Voer ALLEEN het blok uit dat bij jouw doel hoort.
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  INTENT A — platform.config.manage voor de platform-identiteit            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- A0. Pre-check: bestaat de platform-identiteit en heeft die de cap al?
select
  (select count(*) from public.platform_identities pi
     join auth.users u on u.id = pi.id
    where u.email = 'merlinijzerman+platform@gmail.com')                       as is_platform_identiteit,
  (select count(*) from public.platform_identity_capabilities c
     join auth.users u on u.id = c.identity_id
    where u.email = 'merlinijzerman+platform@gmail.com'
      and c.capability = 'platform.config.manage'
      and c.ingetrokken_op is null)                                            as heeft_config_manage_al;

-- A1. Bootstrap-granter. De DB-CHECK chk_pic_geen_self_grant verbiedt dat een
--     identiteit zichzelf een capability toekent (toegekend_door <> identity_id).
--     Met één platformbeheerder is er nog geen tweede toekenner, dus maken we een
--     niet-inlogbare systeem-identiteit (actief=false, geen auth.users-koppeling)
--     puur als herkomst-stempel voor deze eenmalige bootstrap-grant.
--     ⚠️ Dit omzeilt bewust de bedoelde vier-ogen/tweede-beheerder-conventie en is
--        alleen voor de allereerste setup. Doe vervolg-grants via de rechten-UI.
insert into public.platform_identities (id, email, naam, actief)
values ('00000000-0000-0000-0000-0000000000b0',
        'systeem-bootstrap@platform.local', 'Systeem (bootstrap)', false)
on conflict (id) do nothing;

-- A2. Grant platform.config.manage (niet-zwaar → vier_ogen_door mag NULL).
--     Idempotent: ux_pic_actief (1 actieve grant per identity+capability).
insert into public.platform_identity_capabilities
  (identity_id, capability, toegekend_door, vier_ogen_door)
select u.id,
       'platform.config.manage',
       '00000000-0000-0000-0000-0000000000b0',
       null
from auth.users u
where u.email = 'merlinijzerman+platform@gmail.com'
  and exists (select 1 from public.platform_identities pi where pi.id = u.id)
on conflict do nothing;

-- A3. Verificatie: 1 actieve grant verwacht.
select c.capability, c.toegekend_op
from public.platform_identity_capabilities c
join auth.users u on u.id = c.identity_id
where u.email = 'merlinijzerman+platform@gmail.com'
  and c.ingetrokken_op is null;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  INTENT B — tenant-account naar rol 'beheerder' (kan daarna importeren)    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--  Vermoedelijk is dit je gewone account ZONDER +platform: merlinijzerman@gmail.com
--  (per de auto-profiel-notitie waarschijnlijk al een profiel met rol=bestuurder).
--  Pas het e-mailadres aan als het tenant-account een ander is.

-- B0. Pre-check: bestaat dit als TENANT-account (heeft het een profielen-rij)?
select u.email, p.rol, p.fonds_id
from auth.users u
left join public.profielen p on p.id = u.id
where u.email = 'merlinijzerman@gmail.com';

-- B1. Promoveer naar beheerder. 'beheerder' is de enige rol die catalog.manage
--     draagt (lib/capabilities.ts) → mag de standaardcatalogus importeren.
--     ⚠️ Brede toekenning: beheerder krijgt óók dossiers-/metadata-/reviewrechten.
update public.profielen
set rol = 'beheerder'
where id = (select id from auth.users where email = 'merlinijzerman@gmail.com');

-- B2. Verificatie: rol moet 'beheerder' zijn.
select u.email, p.rol
from public.profielen p
join auth.users u on u.id = p.id
where u.email = 'merlinijzerman@gmail.com';

-- B3. Daarna in de app: log in als dit tenant-account → /beheer →
--     "Standaardcatalogus importeren" → Importeren. De profieldropdowns
--     (expertise, commissies & gremia, focusgebieden) vullen dan direct.
