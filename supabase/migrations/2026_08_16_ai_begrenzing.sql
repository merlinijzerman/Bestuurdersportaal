-- ============================================================================
--  Migratie 2026-08-16 — AI-begrenzing: quota, kill switch en modelallowlist
--
--  WAAROM
--    Preview draait AI zonder ENIGE applicatiegrens op verbruik. De enige rem is
--    de financiële providerlimiet (Anthropic USD 200 hard, Mistral EUR 10
--    prepaid) plus een burstlimiet die op vier kostendragende routes fail-open
--    staat en op twee routes ontbreekt. Zolang dat zo is blijft externe
--    Previewtoegang no-go (security/VERVOLGSTAPPEN-SPRINT-1-2026-08-15.md).
--    Besluit 0180 legt het telcontract en de bevoegdhedenscheiding vast.
--
--  WAT DEZE MIGRATIE LEVERT
--    1. public.ai_config_versie          — één rij; monotone teller die ELKE
--                                          configuratiemutatie ophoogt (CAS-bron)
--    2. public.ai_quota_config           — de vier maandquota als data
--    3. public.ai_model_allowlist        — toegestane modellen + tijdelijk venster
--    4. public.ai_kill_switch            — vier onafhankelijke schakelaars
--    5. public.ai_heractivering_verzoek  — append-only, vier-ogenaanvraag
--    6. public.ai_heractivering_besluit  — append-only, vier-ogenbesluit
--    7. public.ai_actie                  — levenscyclus per logische actie
--                                          (gecontroleerd muteerbaar)
--    8. public.ai_verbruik_log           — STRIKT append-only; de ENIGE telbron
--    + seed van de schakelaars en de modelallowlist.
--
--  WAT DEZE MIGRATIE NIET DOET
--    * Geen RPC's — die komen in 2026_08_16_ai_begrenzing_rpc.sql, ná deze.
--    * GEEN quotumwaarden. `ai_quota_config` blijft LEEG. Dat is opzet: de
--      quota zijn een PER-OMGEVING besluit (Preview 150/500/1.200/1.000 is niet
--      automatisch de productiewaarde). Een lege configuratie laat de preflight
--      fail-closed weigeren — zichtbaar en verklaarbaar — in plaats van stil met
--      een verkeerde grens te draaien. Preview vult ze met
--      2026_08_16_ai_begrenzing_seed_preview.sql; Productie krijgt een eigen
--      seed in een eigen ticket.
--    * Geen providerkeys, tokens of secretwaarden. Die blijven uitsluitend in
--      server-side environment variables.
--    * Geen wijziging aan bestaande tabellen, policies of functies.
--
--  RLS/AUTORISATIE-IMPACT
--    Alle acht tabellen: RLS AAN, BEWUST GEEN POLICY (deny-by-default), plus
--    `revoke all ... from anon, authenticated`. Tenants lezen of schrijven hier
--    nooit rechtstreeks. De tenantroutes bereiken uitsluitend de nauw begrensde
--    SECURITY DEFINER-preflight; de beheer-surface leest en muteert met de
--    service-role achter withPlatform()/withPlatformRead().
--
--  APPEND-ONLY
--    ai_verbruik_log, ai_heractivering_verzoek en ai_heractivering_besluit
--    krijgen de gedeelde fn_log_append_only()-trigger: UPDATE en DELETE zijn
--    geblokkeerd, OOK voor de service-role. ai_actie is bewust NIET append-only
--    (een levenscyclus is per definitie muteerbaar) maar krijgt een
--    kolomvries-trigger die alles behalve status/resultaat_ref/bijgewerkt
--    bevriest en statusovergangen alleen vooruit toestaat.
--
--  GATE-IMPACT (supabase/checks/2026_07_31_r1_structurele_gates.sql)
--    * Gate A1 — ZES tabellen zonder eigen fonds_id (ai_config_versie,
--      ai_quota_config, ai_model_allowlist, ai_kill_switch,
--      ai_heractivering_verzoek, ai_heractivering_besluit) MOETEN in de
--      `globaal`-lijst van de gatefile staan. Die registratie zit in deze
--      tranche; zonder die wijziging faalt gate A1. ai_actie en ai_verbruik_log
--      hebben een eigen fonds_id en worden door A1 overgeslagen.
--    * Gate A2 — n.v.t. (geen register-tabellen, geen policies).
--    * Gate B  — geen policies op deze tabellen; niets om te itereren.
--    * Gate C / C2 / G — n.v.t. (geen policies).
--    * Gate E  — n.v.t. in deze migratie (geen SECURITY DEFINER-functies; de
--      trigger-functie hieronder is INVOKER en raakt geen RLS).
--    * Gate F  — expliciete revokes hieronder houden anon en authenticated
--      volledig buiten deze tabellen.
--    * Gate H  — n.v.t. (geen functie krijgt EXECUTE voor anon).
--    * Gate D  — n.v.t. (anon ziet niets nieuws).
--
--  IDEMPOTENT: create table/index/trigger if not exists, drop trigger if exists
--  vóór create, `on conflict do nothing` op de seed. Meermaals draaien is veilig
--  en verandert geen bestaande rij.
--
--  ROLLBACK: 2026_08_16_ai_begrenzing_ROLLBACK.sql
--
--  Plak dit bestand in Supabase Dashboard → SQL Editor → New query → Run.
--  EERST deze migratie draaien, DAN de RPC-migratie, DAN de seed, DAN pas
--  code-deploy — anders faalt de preflight op een ontbrekend object.
-- ============================================================================

begin;

-- ── 1. ai_config_versie ─────────────────────────────────────────────────────
--  Eén rij, één teller. Elke mutatie-RPC (stop, heractivering, quota,
--  allowlist) hoogt hem op. Het heractiveringsverzoek legt de stand ná zijn
--  eigen ophoging vast; de goedkeuring eist dat die stand ONVERANDERD is
--  (compare-and-swap). Daardoor detecteert de goedkeuring IEDERE tussentijdse
--  configuratiewijziging — niet alleen een nieuwe stop. Dit is de eerste echte
--  CAS in dit schema; elders is de conventie `versie = versie + 1` zonder
--  vergelijking (T8-schrijfconventie).
create table if not exists public.ai_config_versie (
  id         smallint primary key default 1 check (id = 1),
  versie     bigint   not null default 1 check (versie >= 1),
  bijgewerkt timestamptz not null default now()
);

comment on table public.ai_config_versie is
  'GLOBAAL (T3-register: geen fonds_id). Eén rij met een monotone teller die door '
  'ELKE AI-configuratiemutatie wordt opgehoogd. Bron voor de compare-and-swap bij '
  'vier-ogenheractivering (besluit 0180). RLS aan, GEEN policy: alleen service-role '
  'via de mutatie-RPC''s.';

insert into public.ai_config_versie (id, versie) values (1, 1)
on conflict (id) do nothing;

alter table public.ai_config_versie enable row level security;
-- Deny-by-default: bewust GEEN policy.
-- LET OP: ook service_role wordt eerst volledig gerevoked. De default-ACL op
-- schema public kent rechten EXPLICIET toe (zie CLAUDE.md over bevinding H-18);
-- zonder deze revoke zou een tabel rechten dragen die hier nooit zijn gegeven,
-- en zou "append-only" verderop alleen door een trigger en niet door de grants
-- worden gedragen.
revoke all on public.ai_config_versie from anon, authenticated, service_role;
grant select, update on public.ai_config_versie to service_role;

-- ── 2. ai_quota_config ──────────────────────────────────────────────────────
--  Quota ALS DATA: een grens wijzigen is een beheerhandeling, geen deploy.
--  BEWUST LEEG na deze migratie — zie "WAT DEZE MIGRATIE NIET DOET".
create table if not exists public.ai_quota_config (
  sleutel         text primary key
    check (sleutel in ('gebruiker_maand','fonds_maand','globaal_maand','ocr_fonds_maand')),
  waarde          integer not null check (waarde >= 0),
  bijgewerkt      timestamptz not null default now(),
  bijgewerkt_door uuid
);

comment on table public.ai_quota_config is
  'GLOBAAL (T3-register: geen fonds_id). De vier maandquota als data (besluit 0180): '
  'AI-acties per gebruiker, per fonds en platformbreed, plus OCR-pagina''s per fonds. '
  'Een ONTBREKENDE rij betekent GEBLOKKEERD, niet onbeperkt — een niet-geconfigureerde '
  'omgeving hoort dicht te staan. RLS aan, GEEN policy.';
comment on column public.ai_quota_config.waarde is
  'Bovengrens per kalendermaand (UTC). Waarde 0 = volledig dicht, nadrukkelijk NIET onbeperkt.';
comment on column public.ai_quota_config.bijgewerkt_door is
  'platform_identities.id van de beheerder. Geen FK: deze kolom mag een identiteit '
  'die later wordt verwijderd niet blokkeren.';

alter table public.ai_quota_config enable row level security;
revoke all on public.ai_quota_config from anon, authenticated, service_role;
grant select, insert, update on public.ai_quota_config to service_role;

-- ── 3. ai_model_allowlist ───────────────────────────────────────────────────
--  Modelkeuze wordt CENTRAAL gevalideerd vlak vóór de providercall; een route
--  mag de controle niet omzeilen door zelf een modelstring te zetten (FR-4).
--  Een regel met venster is uitsluitend binnen [start, eind) toegestaan en
--  vervalt daarna VANZELF — configuratie-expiratie, geen accountdeactivatie.
create table if not exists public.ai_model_allowlist (
  provider        text not null check (provider in ('anthropic','mistral','openai')),
  model           text not null check (length(btrim(model)) > 0),
  actief          boolean not null default true,
  venster_start   timestamptz,
  venster_eind    timestamptz,
  reden           text,
  bijgewerkt      timestamptz not null default now(),
  bijgewerkt_door uuid,
  primary key (provider, model),
  -- Een venster is heel of niet: half ingevuld is een configuratiefout en de
  -- applicatielaag behandelt dat fail-closed. De CHECK voorkomt dat het
  -- überhaupt ontstaat.
  constraint chk_aml_venster_heel check (
    (venster_start is null and venster_eind is null)
    or (venster_start is not null and venster_eind is not null and venster_eind > venster_start)
  ),
  -- Een tijdelijk venster zonder opgegeven reden is niet auditbaar.
  constraint chk_aml_venster_reden check (
    venster_start is null or length(btrim(coalesce(reden,''))) >= 10
  )
);

comment on table public.ai_model_allowlist is
  'GLOBAAL (T3-register: geen fonds_id). Toegestane provider/model-combinaties '
  '(besluit 0180). Een model dat hier niet ACTIEF staat wordt server-side geweigerd; '
  'er is geen stille fallback naar een ruimer model. Een gevuld venster maakt het '
  'model uitsluitend binnen [venster_start, venster_eind) toegestaan — bedoeld voor '
  'een vooraf gepland intern AQLab-testvenster. RLS aan, GEEN policy.';
comment on column public.ai_model_allowlist.venster_eind is
  'Na dit tijdstip is het model zonder verdere beheerhandeling niet meer toegestaan.';

alter table public.ai_model_allowlist enable row level security;
revoke all on public.ai_model_allowlist from anon, authenticated, service_role;
grant select, insert, update, delete on public.ai_model_allowlist to service_role;

-- Seed: de vastgestelde allowlist (werkopdracht §2.1). Identiek in elke
-- omgeving, dus wél in de basismigratie. `mistral-large-latest` staat er
-- BEWUST NIET in: dat mag alleen via een expliciet, tijdgebonden AQLab-venster.
insert into public.ai_model_allowlist (provider, model, actief) values
  ('anthropic', 'claude-opus-4-8',             true),
  ('anthropic', 'claude-sonnet-4-6',           true),
  ('anthropic', 'claude-sonnet-4-5',           true),
  ('anthropic', 'claude-haiku-4-5-20251001',   true),
  ('mistral',   'mistral-embed',               true),
  ('mistral',   'mistral-ocr-latest',          true)
on conflict (provider, model) do nothing;

-- ── 4. ai_kill_switch ───────────────────────────────────────────────────────
--  Vier onafhankelijk bedienbare schakelaars. Statusmachine:
--
--    actief ──stop──► gestopt ──aanvraag──► heractivering_aangevraagd
--                        ▲                          │
--                        └──afwijzen/intrekken──────┤
--                                                   └──goedkeuren──► actief
--
--  `afgewezen` is GEEN schakelaartoestand maar een besluituitkomst; na afwijzing
--  staat de schakelaar weer gewoon op `gestopt`.
--
--  open_verzoek_id is de STRUCTURELE garantie dat er hooguit één openstaand
--  heractiveringsverzoek per schakelaar bestaat: het is één kolom, dus er kán er
--  maar één zijn. Een partiële unieke index op de verzoektabel zou dit niet
--  kunnen afdwingen — die kan niet over een tweede tabel kijken om te zien of er
--  al een besluit ligt. Elke transitie-RPC vergrendelt deze rij met
--  `select ... for update`.
create table if not exists public.ai_kill_switch (
  sleutel         text primary key check (sleutel in ('globaal','anthropic','mistral','openai')),
  status          text not null default 'actief'
    check (status in ('actief','gestopt','heractivering_aangevraagd')),
  open_verzoek_id uuid,
  reden           text,
  gewijzigd_op    timestamptz not null default now(),
  gewijzigd_door  uuid references public.platform_identities(id) on delete set null,
  -- Een stop zonder opgegeven reden is niet auditbaar (FR-3).
  constraint chk_aks_reden_bij_stop check (
    status = 'actief' or length(btrim(coalesce(reden,''))) >= 10
  ),
  -- Een openstaand verzoek hoort bij precies één toestand.
  constraint chk_aks_open_verzoek_consistent check (
    (status = 'heractivering_aangevraagd' and open_verzoek_id is not null)
    or (status <> 'heractivering_aangevraagd' and open_verzoek_id is null)
  )
);

comment on table public.ai_kill_switch is
  'GLOBAAL (T3-register: geen fonds_id). De vier kill switches voor kostendragende AI '
  '(besluit 0180). Stoppen mag elke bevoegde beheerder zelfstandig; heractiveren vereist '
  'vier ogen. open_verzoek_id dwingt structureel af dat er hooguit één openstaand verzoek '
  'per schakelaar is. RLS aan, GEEN policy.';
comment on column public.ai_kill_switch.open_verzoek_id is
  'Verwijst naar het openstaande heractiveringsverzoek. FK wordt hieronder toegevoegd '
  '(circulaire afhankelijkheid met ai_heractivering_verzoek.sleutel).';

alter table public.ai_kill_switch enable row level security;
revoke all on public.ai_kill_switch from anon, authenticated, service_role;
grant select, insert, update on public.ai_kill_switch to service_role;

-- Seed. Anthropic en Mistral staan aan (Preview draait erop); `openai` en elke
-- latere challenger staan STANDAARD UIT (werkopdracht §2.1). De globale
-- schakelaar staat aan; de quota vormen de eerste grens, niet de stop.
insert into public.ai_kill_switch (sleutel, status, reden) values
  ('globaal',   'actief',  null),
  ('anthropic', 'actief',  null),
  ('mistral',   'actief',  null),
  ('openai',    'gestopt', 'Challengers staan standaard uit (werkopdracht 2026-08-15, besluit 0180).')
on conflict (sleutel) do nothing;

-- ── 5. ai_heractivering_verzoek (append-only) ───────────────────────────────
create table if not exists public.ai_heractivering_verzoek (
  id                        uuid primary key default gen_random_uuid(),
  sleutel                   text not null references public.ai_kill_switch(sleutel),
  aangevraagd_door          uuid not null references public.platform_identities(id),
  aangevraagd_op            timestamptz not null default now(),
  reden                     text not null check (length(btrim(reden)) >= 10),
  config_versie_bij_aanvraag bigint not null,
  -- Maakt de composite-FK vanuit het besluit mogelijk (denorm-lock, besluit 0169).
  constraint uq_ahv_id_aanvrager unique (id, aangevraagd_door)
);

comment on table public.ai_heractivering_verzoek is
  'GLOBAAL (T3-register: geen fonds_id), APPEND-ONLY (fn_log_append_only). Aanvraag tot '
  'heractivering van een kill switch (besluit 0180). config_versie_bij_aanvraag wordt ná '
  'de eigen ophoging binnen dezelfde transactie vastgelegd — anders zou de aanvraag zijn '
  'eigen compare-and-swap onmiddellijk ongeldig maken. RLS aan, GEEN policy.';
comment on column public.ai_heractivering_verzoek.config_versie_bij_aanvraag is
  'Stand van ai_config_versie ná de ophoging door deze aanvraag. Goedkeuring slaagt alleen '
  'als die stand onveranderd is; elke tussentijdse stop, quota- of allowlistwijziging '
  'maakt het verzoek daarmee ongeldig.';

create index if not exists idx_ahv_sleutel_tijd
  on public.ai_heractivering_verzoek (sleutel, aangevraagd_op desc);

alter table public.ai_heractivering_verzoek enable row level security;
-- Append-only ook in de GRANTS: geen update/delete, ook niet voor service_role.
revoke all on public.ai_heractivering_verzoek from anon, authenticated, service_role;
grant select, insert on public.ai_heractivering_verzoek to service_role;

-- Circulaire FK nu beide tabellen bestaan.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_aks_open_verzoek'
  ) then
    alter table public.ai_kill_switch
      add constraint fk_aks_open_verzoek
      foreign key (open_verzoek_id) references public.ai_heractivering_verzoek(id);
  end if;
end $$;

-- ── 6. ai_heractivering_besluit (append-only) ───────────────────────────────
--  ZELFGOEDKEURING IS IN DE DATALAAG ONMOGELIJK, en wel alleen daar waar dat
--  hoort: `chk_ahb_geen_self_approval` verbiedt uitsluitend het GOEDKEUREN van
--  een eigen verzoek. Intrekken van je eigen aanvraag mag wél, en een nieuwe
--  stop mag een openstaand verzoek laten vervallen — dat zijn geen
--  privilege-escalaties.
--
--  De denormalisatie van `aangevraagd_door` kan niet liegen: de composite-FK
--  bindt het paar (verzoek_id, aangevraagd_door) aan de verzoektabel, dus een
--  kwaadwillende INSERT kan geen valse aanvrager verzinnen om de CHECK te
--  omzeilen (denorm-lock, patroon van besluit 0169).
create table if not exists public.ai_heractivering_besluit (
  id               uuid primary key default gen_random_uuid(),
  verzoek_id       uuid not null unique,
  aangevraagd_door uuid not null,
  besluit          text not null check (besluit in ('goedgekeurd','afgewezen','ingetrokken','vervallen')),
  besloten_door    uuid not null references public.platform_identities(id),
  besloten_op      timestamptz not null default now(),
  besluit_reden    text,
  constraint fk_ahb_verzoek_aanvrager
    foreign key (verzoek_id, aangevraagd_door)
    references public.ai_heractivering_verzoek(id, aangevraagd_door),
  constraint chk_ahb_geen_self_approval check (
    besluit <> 'goedgekeurd' or besloten_door <> aangevraagd_door
  )
);

comment on table public.ai_heractivering_besluit is
  'GLOBAAL (T3-register: geen fonds_id), APPEND-ONLY (fn_log_append_only). Uitkomst van een '
  'heractiveringsverzoek (besluit 0180). Eén besluit per verzoek (unique verzoek_id). '
  'chk_ahb_geen_self_approval verbiedt UITSLUITEND zelfgoedkeuring; intrekken door de '
  'aanvrager zelf en vervallen door een nieuwe stop blijven mogelijk. De gedenormaliseerde '
  'aangevraagd_door is via een composite-FK aan het verzoek gebonden en kan dus niet liegen. '
  'RLS aan, GEEN policy.';

create index if not exists idx_ahb_tijd
  on public.ai_heractivering_besluit (besloten_op desc);

alter table public.ai_heractivering_besluit enable row level security;
-- Append-only ook in de GRANTS.
revoke all on public.ai_heractivering_besluit from anon, authenticated, service_role;
grant select, insert on public.ai_heractivering_besluit to service_role;

-- ── 7. ai_actie (gecontroleerd muteerbaar) ──────────────────────────────────
--  De levenscyclus van één logische actie. Bewust GESCHEIDEN van het
--  verbruikslog: verbruik is een onherroepelijk feit en moet onaantastbaar
--  zijn, terwijl een levenscyclus per definitie muteert. Die twee in één tabel
--  zetten zou "append-only" tot een leugen maken.
--
--  LEASE. verloopt_op begrenst hoe lang een actie `in_uitvoering` mag blijven.
--  Crasht het proces halverwege, dan blijft de rij anders eeuwig staan en zou de
--  idempotentiecontrole een nieuwe poging blijven blokkeren. De eerstvolgende
--  preflight verklaart zo'n rij `verlopen` en laat de nieuwe poging door; de
--  reeds geschreven verbruiksregel blijft staan (conservatief tellen).
create table if not exists public.ai_actie (
  id                   uuid primary key default gen_random_uuid(),
  idempotentie_sleutel text not null,
  verzoek_vingerafdruk text not null,
  actietype            text not null,
  fonds_id             uuid,
  gebruiker_id         uuid,
  status               text not null default 'in_uitvoering'
    check (status in ('in_uitvoering','voltooid','mislukt','verlopen')),
  resultaat_ref        text,
  gestart_op           timestamptz not null default now(),
  verloopt_op          timestamptz not null,
  bijgewerkt           timestamptz not null default now(),
  constraint chk_aa_lease_vooruit check (verloopt_op > gestart_op)
);

comment on table public.ai_actie is
  'GLOBAAL met eigen fonds_id. Levenscyclus per logische AI-actie (besluit 0180): '
  'idempotentie, statusovergang en lease. GECONTROLEERD MUTEERBAAR — de trigger '
  'fn_ai_actie_bevries_kolommen laat alleen status, resultaat_ref en bijgewerkt wijzigen, '
  'en status alleen vooruit. Verbruik zelf staat in ai_verbruik_log en is onaantastbaar. '
  'RLS aan, GEEN policy.';
comment on column public.ai_actie.idempotentie_sleutel is
  'Server-side samengesteld uit actietype, gebruiker, fonds en de Idempotency-Key van de '
  'aanroeper. Bij achtergrondwerk: <job_id>:<stap>:<poging>.';
comment on column public.ai_actie.verzoek_vingerafdruk is
  'sha256 van de canonieke payload. Dezelfde sleutel met een ándere vingerafdruk wordt '
  'geweigerd — anders zou een hergebruikte sleutel een quotum-bypass zijn.';
comment on column public.ai_actie.fonds_id is
  'NULL uitsluitend bij een expliciet platformbreed actietype (generiek_curatie, aqlab_*). '
  'Geen FK: een verwijderd fonds mag de reeds vastgelegde actie niet muteren of blokkeren.';
comment on column public.ai_actie.gebruiker_id is
  'NULL bij achtergrondwerk zonder sessie (ingest-worker, cron). Geen FK: idem.';
comment on column public.ai_actie.verloopt_op is
  'Einde van de lease. Daarna verklaart de eerstvolgende preflight deze actie `verlopen`.';

-- Idempotentie: de sleutel is uniek zolang de actie LOOPT of GESLAAGD is. Een
-- `mislukt` of `verlopen` actie GEEFT DE SLEUTEL VRIJ, zodat een legitieme
-- nieuwe poging met dezelfde Idempotency-Key door kan. Een onvoorwaardelijke
-- unique zou precies het omgekeerde doen: na één mislukte call zou de gebruiker
-- diezelfde vraag nooit meer kunnen stellen. Die nieuwe poging schrijft een
-- eigen verbruiksregel — conservatief tellen boven netjes tellen.
create unique index if not exists ux_aa_idempotentie_open
  on public.ai_actie (idempotentie_sleutel)
  where status in ('in_uitvoering','voltooid');

create index if not exists idx_aa_status_verloopt
  on public.ai_actie (status, verloopt_op) where status = 'in_uitvoering';

alter table public.ai_actie enable row level security;
revoke all on public.ai_actie from anon, authenticated, service_role;
-- DELETE bewust wél toegestaan: retentie op de levenscyclustabel moet mogelijk
-- blijven. Het verbruikslog eronder is de onaantastbare laag.
grant select, insert, update, delete on public.ai_actie to service_role;

-- Kolomvries + voorwaartse statusmachine. Anders dan
-- fn_afschrift_bevries_kolommen kent deze trigger GEEN ontsnapping voor de
-- service-role: juist het achtergrondwerk draait met service-role, en dat mag
-- de identiteit van een actie evenmin herschrijven.
create or replace function public.fn_ai_actie_bevries_kolommen()
returns trigger
language plpgsql
as $$
begin
  if (
       new.id                   is distinct from old.id
    or new.idempotentie_sleutel is distinct from old.idempotentie_sleutel
    or new.verzoek_vingerafdruk is distinct from old.verzoek_vingerafdruk
    or new.actietype            is distinct from old.actietype
    or new.fonds_id             is distinct from old.fonds_id
    or new.gebruiker_id         is distinct from old.gebruiker_id
    or new.gestart_op           is distinct from old.gestart_op
    or new.verloopt_op          is distinct from old.verloopt_op
  ) then
    raise exception
      'ai_actie: alleen status, resultaat_ref en bijgewerkt mogen wijzigen'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'in_uitvoering' then
      raise exception
        'ai_actie: status % is een eindtoestand en kan niet naar %', old.status, new.status
        using errcode = '42501';
    end if;
    if new.status not in ('voltooid','mislukt','verlopen') then
      raise exception
        'ai_actie: ongeldige statusovergang % -> %', old.status, new.status
        using errcode = '22023';
    end if;
  end if;

  new.bijgewerkt := now();
  return new;
end;
$$;

comment on function public.fn_ai_actie_bevries_kolommen() is
  'Bevriest de identiteit van een ai_actie-rij en laat de status alleen vooruit lopen '
  '(in_uitvoering -> voltooid/mislukt/verlopen). Geldt OOK voor de service-role.';

-- Gate-H-hygiëne. Een triggerfunctie wordt door Postgres als tabeleigenaar
-- aangeroepen en heeft van NIEMAND een executegrant nodig. Zonder deze revoke
-- staat hij door de default-ACL wél open voor anon — precies het patroon dat de
-- reviews van 12-08 drie keer aantroffen (OP-C5/OP-C13). De revoke hoort bij
-- ELKE functiedefinitie, niet in een latere reparatiemigratie: een
-- `drop`+`create` reset de ACL telkens opnieuw.
revoke all on function public.fn_ai_actie_bevries_kolommen()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_ai_actie_bevries on public.ai_actie;
create trigger trg_ai_actie_bevries
  before update on public.ai_actie
  for each row execute procedure public.fn_ai_actie_bevries_kolommen();

-- DELETE blijft mogelijk voor retentie op deze tabel; het verbruikslog eronder
-- is de onaantastbare laag en heeft geen FK hierheen, juist zodat opschonen van
-- ai_actie later niet onmogelijk wordt.

-- ── 8. ai_verbruik_log (STRIKT append-only) ─────────────────────────────────
--  DE ENIGE TELBRON. Elke quotumcontrole somt over deze tabel. Eén regel per
--  geaccepteerde reservering; bij OCR één regel PER POGING (de provider
--  factureert een retry ook opnieuw, dus onderdrukken zou onderstellen).
--
--  Geen enkele FK naar fondsen, auth.users of ai_actie: een append-only tabel
--  mag niet muteerbaar of blokkerend worden gemaakt door een cascade elders.
--  Dezelfde afweging als bij platform_event_log.
create table if not exists public.ai_verbruik_log (
  id           uuid primary key default gen_random_uuid(),
  maand        date not null,
  actie_id     uuid not null,
  actietype    text not null,
  fonds_id     uuid,
  gebruiker_id uuid,
  provider     text,
  model        text,
  ai_acties    integer not null default 1 check (ai_acties >= 0),
  ocr_paginas  integer not null default 0 check (ocr_paginas >= 0),
  poging       integer not null default 1 check (poging >= 1),
  tijdstip     timestamptz not null default now()
);

comment on table public.ai_verbruik_log is
  'GLOBAAL met eigen fonds_id, STRIKT APPEND-ONLY (fn_log_append_only). De ENIGE telbron '
  'voor de AI-maandquota (besluit 0180). Een reservering blijft meetellen ook als de '
  'providercall daarna faalt — conservatief tellen is het uitgangspunt. Bevat uitsluitend '
  'metadata: nooit prompts, antwoorden of persoonsgegevens. RLS aan, GEEN policy.';
comment on column public.ai_verbruik_log.maand is
  'date_trunc(''month'', now() at time zone ''UTC'')::date op het moment van reserveren. '
  'Server-side bepaald; de client levert nooit een periodegrens aan.';
comment on column public.ai_verbruik_log.ai_acties is
  '1 voor een gewone actie, 0 voor `ocr` — OCR is een eigen grootheid en verbruikt geen AI-actie.';
comment on column public.ai_verbruik_log.poging is
  'Volgnummer binnen dezelfde logische stap. Alleen >1 bij OCR-retries, die apart worden gefactureerd.';

create index if not exists idx_avl_maand_fonds     on public.ai_verbruik_log (maand, fonds_id);
create index if not exists idx_avl_maand_gebruiker on public.ai_verbruik_log (maand, gebruiker_id);
create index if not exists idx_avl_maand           on public.ai_verbruik_log (maand);
create index if not exists idx_avl_actie           on public.ai_verbruik_log (actie_id);

alter table public.ai_verbruik_log enable row level security;
revoke all on public.ai_verbruik_log from anon, authenticated, service_role;
-- Bewust GEEN update/delete voor service_role: append-only is ook een grant-zaak,
-- niet alleen een trigger. Twee sloten op dezelfde deur.
grant select, insert on public.ai_verbruik_log to service_role;

-- ── 9. Append-only-triggers ─────────────────────────────────────────────────
--  Hergebruikt de gedeelde fn_log_append_only() (2026_07_08_t3_append_only_logs).
--  Die functie blijft bij rollback bestaan; hij is van meerdere tabellen.
do $$
declare
  t text;
  logtabellen text[] := array[
    'ai_verbruik_log',
    'ai_heractivering_verzoek',
    'ai_heractivering_besluit'
  ];
begin
  foreach t in array logtabellen loop
    execute format('drop trigger if exists trg_%1$s_no_update on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_no_update before update on public.%1$s '
      'for each row execute procedure public.fn_log_append_only()', t);
    execute format('drop trigger if exists trg_%1$s_no_delete on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_no_delete before delete on public.%1$s '
      'for each row execute procedure public.fn_log_append_only()', t);
  end loop;
end $$;

-- ── 10. Fail-closed verificatie binnen dezelfde transactie ──────────────────
--  "Toets de uitkomst in de database, niet de intentie in de migratie"
--  (CLAUDE.md). Faalt iets, dan rolt de hele migratie terug.
do $$
declare
  tabellen text[] := array[
    'ai_config_versie','ai_quota_config','ai_model_allowlist','ai_kill_switch',
    'ai_heractivering_verzoek','ai_heractivering_besluit','ai_actie','ai_verbruik_log'
  ];
  t          text;
  n_policies int;
  n_rls      int;
  fouten     text := '';
begin
  foreach t in array tabellen loop
    -- Bestaat de tabel?
    if not exists (
      select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      raise exception 'AI-BEGRENZING-MIGRATIE FAALT: tabel % ontbreekt', t;
    end if;

    -- RLS aan?
    select count(*) into n_rls from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = t and c.relrowsecurity;
    if n_rls <> 1 then
      fouten := fouten || format('  - %s heeft RLS niet aanstaan%s', t, chr(10));
    end if;

    -- Deny-by-default: geen enkele policy.
    select count(*) into n_policies from pg_policies
     where schemaname = 'public' and tablename = t;
    if n_policies <> 0 then
      fouten := fouten || format('  - %s draagt %s policy/policies (verwacht 0)%s', t, n_policies, chr(10));
    end if;

    -- anon en authenticated volledig buiten de deur (gate F).
    if has_table_privilege('anon', 'public.' || t, 'SELECT')
       or has_table_privilege('anon', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || t, 'INSERT') then
      fouten := fouten || format('  - anon/authenticated heeft nog rechten op %s%s', t, chr(10));
    end if;

    -- Positieve controle: zonder service_role-leesrecht faalt de beheerweergave stil.
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT') then
      fouten := fouten || format('  - service_role kan %s niet lezen%s', t, chr(10));
    end if;
  end loop;

  -- Append-only moet ECHT afgedwongen zijn, niet alleen bedoeld.
  foreach t in array array['ai_verbruik_log','ai_heractivering_verzoek','ai_heractivering_besluit'] loop
    if not exists (
      select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
       where c.relname = t and tg.tgname = 'trg_' || t || '_no_update' and not tg.tgisinternal
    ) or not exists (
      select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
       where c.relname = t and tg.tgname = 'trg_' || t || '_no_delete' and not tg.tgisinternal
    ) then
      fouten := fouten || format('  - %s mist een append-only-trigger%s', t, chr(10));
    end if;
    -- Ook via grants dicht: service_role mag hier niet muteren.
    if has_table_privilege('service_role', 'public.' || t, 'UPDATE')
       or has_table_privilege('service_role', 'public.' || t, 'DELETE') then
      fouten := fouten || format('  - service_role heeft UPDATE/DELETE op append-only tabel %s%s', t, chr(10));
    end if;
  end loop;

  -- De kolomvries-trigger op ai_actie.
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
     where c.relname = 'ai_actie' and tg.tgname = 'trg_ai_actie_bevries' and not tg.tgisinternal
  ) then
    fouten := fouten || '  - ai_actie mist de kolomvries-trigger' || chr(10);
  end if;

  -- De partiële idempotentie-index. Zonder deze index is er geen enkele
  -- bescherming tegen een dubbele reservering bij een retried request.
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='ux_aa_idempotentie_open') then
    fouten := fouten || '  - ux_aa_idempotentie_open ontbreekt (dubbele reservering niet geblokkeerd)' || chr(10);
  end if;

  -- Gate H op de triggerfunctie van deze migratie.
  if exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'fn_ai_actie_bevries_kolommen'
       and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    fouten := fouten || '  - anon kan fn_ai_actie_bevries_kolommen uitvoeren (gate H)' || chr(10);
  end if;

  -- De vier-ogenwaarborgen.
  if not exists (select 1 from pg_constraint where conname = 'chk_ahb_geen_self_approval') then
    fouten := fouten || '  - chk_ahb_geen_self_approval ontbreekt (zelfgoedkeuring niet geblokkeerd)' || chr(10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_ahb_verzoek_aanvrager') then
    fouten := fouten || '  - fk_ahb_verzoek_aanvrager ontbreekt (denorm-lock niet afgedwongen)' || chr(10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_aks_open_verzoek') then
    fouten := fouten || '  - fk_aks_open_verzoek ontbreekt' || chr(10);
  end if;

  -- Seeds. BEWUST STRUCTUREEL getoetst, niet op exacte waarden: deze migratie
  -- moet ook herdraaibaar zijn nadat een beheerder legitiem een schakelaar of
  -- een modelregel heeft gewijzigd. Een herdraai mag zo'n wijziging melden noch
  -- terugdraaien — de RPC's zijn het beheerpad, niet dit bestand.
  if (select count(*) from public.ai_kill_switch) <> 4 then
    fouten := fouten || '  - ai_kill_switch bevat niet de vier schakelaars' || chr(10);
  end if;
  if (select count(*) from public.ai_model_allowlist) < 6 then
    fouten := fouten || '  - ai_model_allowlist mist geseede modelregels' || chr(10);
  end if;
  -- Mistral Large mag uitsluitend via een tijdelijk, gemotiveerd AQLab-venster
  -- bestaan. Een permanent actieve regel is een beleidsovertreding en geen
  -- legitieme beheerhandeling, dus die toetsen we wél hard.
  if exists (
    select 1 from public.ai_model_allowlist
     where model = 'mistral-large-latest' and actief and venster_start is null
  ) then
    fouten := fouten || '  - mistral-large-latest staat permanent in de allowlist (mag alleen binnen een tijdelijk venster)' || chr(10);
  end if;
  if (select count(*) from public.ai_config_versie) <> 1 then
    fouten := fouten || '  - ai_config_versie bevat niet exact één rij' || chr(10);
  end if;

  if fouten <> '' then
    raise exception E'AI-BEGRENZING-MIGRATIE FAALT:\n%', fouten;
  end if;

  raise notice 'AI-BEGRENZING OK: acht tabellen deny-by-default, append-only afgedwongen, vier-ogenwaarborgen aanwezig.';
  raise notice 'LET OP: ai_quota_config is nog LEEG — zonder quotumrijen weigert de preflight alles (fail-closed). Draai de omgevingsspecifieke seed.';
end $$;

commit;

-- ── Verificatie (handmatig ná de migratie) ──────────────────────────────────
--
-- 1. Deny-by-default per tabel (verwacht: 8 rijen, allemaal rls=t, policies=0):
--    select c.relname, c.relrowsecurity as rls,
--           (select count(*) from pg_policies p
--             where p.schemaname='public' and p.tablename=c.relname) as policies
--      from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
--     where ns.nspname='public' and c.relname like 'ai\_%'
--     order by 1;
--
-- 2. Geen rechten voor anon/authenticated (verwacht: 0 rijen):
--    select grantee, table_name, privilege_type
--      from information_schema.role_table_grants
--     where table_schema='public' and table_name like 'ai\_%'
--       and grantee in ('anon','authenticated');
--
-- 3. Append-only bewijzen (verwacht: beide raise exception):
--    update public.ai_verbruik_log set ai_acties = 0 where true;
--    delete from public.ai_verbruik_log where true;
--
-- 4. Seeds:
--    select sleutel, status from public.ai_kill_switch order by 1;
--    select provider, model, actief from public.ai_model_allowlist order by 1,2;
--
-- 5. Quota (verwacht: 0 rijen tot de omgevingsseed is gedraaid):
--    select * from public.ai_quota_config;
--
-- 6. Structurele gates A–H schoon draaien:
--    supabase/checks/2026_07_31_r1_structurele_gates.sql
--    Let op: de zes tabellen zonder fonds_id staan in de `globaal`-lijst van die
--    file; draai de bijgewerkte versie uit deze tranche.
--
-- 7. Gedragssuite: supabase/checks/2026_08_16_ai_begrenzing.sql
-- ============================================================================
