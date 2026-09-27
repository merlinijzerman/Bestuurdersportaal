-- #428 Fase 2 — uitsluitend synthetische Preview-demo-inhoud voor m365-demo.
-- Vereist dat de gedeelde fondsconfig en de Preview-hostprovisioning al groen zijn.
-- Geen account-, Storage-, Microsoft-, token- of providerhandeling.
begin;

do $$
declare v_fonds uuid;
begin
  if not exists (
    select 1 from public.tenant_domains
    where host = 'app.preview.bestuurdersportaal.com' and actief
  ) or exists (
    select 1 from public.tenant_domains
    where host in ('app.bestuurdersportaal.com', 'app365.bestuurdersportaal.com')
  ) then
    raise exception '#428 fixtures: doelomgeving is niet aantoonbaar Preview';
  end if;

  select id into strict v_fonds from public.fondsen where slug = 'm365-demo';
  if not exists (
    select 1 from public.tenant_domains
    where host = 'app365.preview.bestuurdersportaal.com'
      and fonds_id = v_fonds and actief
  ) then
    raise exception '#428 fixtures: app365 Preview-hostbinding ontbreekt';
  end if;

  update public.fonds_module_manifest
  set actief = true,
      versie = case when actief then versie else versie + 1 end
  where fonds_id = v_fonds
    and module_key in ('ai','bibliotheek','vergaderingen','notulen','procedures','risicomatrix');

  insert into public.vergaderingen
    (id, fonds_id, titel, datum, locatie, status)
  values
    ('42800000-0000-0000-0000-000000000201', v_fonds,
     'SYNTHETISCH — Bestuursvergadering oktober', '2026-10-15T09:00:00Z',
     'Digitale demozaal', 'in_voorbereiding')
  on conflict (id) do update set
    fonds_id = excluded.fonds_id, titel = excluded.titel, datum = excluded.datum,
    locatie = excluded.locatie, status = excluded.status;

  insert into public.agendapunten
    (id, vergadering_id, volgorde, titel, beschrijving, categorie, tijdsduur_minuten)
  values
    ('42800000-0000-0000-0000-000000000211', '42800000-0000-0000-0000-000000000201', 1,
     'SYNTHETISCH — Vaststelling transitieplan v2',
     'Bespreek planning, governance, risico''s en beheersmaatregelen.',
     'besluitvorming', 35),
    ('42800000-0000-0000-0000-000000000212', '42800000-0000-0000-0000-000000000201', 2,
     'SYNTHETISCH — Voortgang datamigratie',
     'Beeldvorming over datakwaliteit en onafhankelijke controle.',
     'beeldvorming', 25)
  on conflict (id) do update set
    vergadering_id = excluded.vergadering_id, volgorde = excluded.volgorde,
    titel = excluded.titel, beschrijving = excluded.beschrijving,
    categorie = excluded.categorie, tijdsduur_minuten = excluded.tijdsduur_minuten;

  insert into public.procedures
    (id, fonds_id, template_code, titel, beschrijving, status, deadline,
     periode_type, periode_start, periode_eind, periode_jaar)
  values
    ('42800000-0000-0000-0000-000000000301', v_fonds, 'app365_demo_transitie',
     'SYNTHETISCH — Besluitvorming transitieplan',
     'Fictief dossier voor de stakeholderdemo; bevat geen klant- of persoonsgegevens.',
     'ter_besluitvorming', '2026-11-30', 'projectperiode', '2026-09-01', '2027-03-31', 2026)
  on conflict (id) do update set
    fonds_id = excluded.fonds_id, template_code = excluded.template_code,
    titel = excluded.titel, beschrijving = excluded.beschrijving,
    status = excluded.status, deadline = excluded.deadline,
    periode_type = excluded.periode_type, periode_start = excluded.periode_start,
    periode_eind = excluded.periode_eind, periode_jaar = excluded.periode_jaar;

  insert into public.risicos
    (id, fonds_id, categorie, titel, toelichting, kans, impact, niveau,
     niveau_handmatig, type_risico, status, eigenaar_naam, volgende_beoordeling)
  values
    ('42800000-0000-0000-0000-000000000401', v_fonds, 'operationeel_datakwaliteit',
     'SYNTHETISCH — Datakwaliteit tijdens migratie',
     'Fictief risico: onvoldoende gevalideerde brongegevens kunnen de overgang vertragen.',
     3, 4, 'hoog', true, 'tijdelijk', 'actief', 'Demo programmamanager', '2026-10-31')
  on conflict (id) do update set
    fonds_id = excluded.fonds_id, categorie = excluded.categorie,
    titel = excluded.titel, toelichting = excluded.toelichting,
    kans = excluded.kans, impact = excluded.impact, niveau = excluded.niveau,
    niveau_handmatig = excluded.niveau_handmatig, type_risico = excluded.type_risico,
    status = excluded.status, eigenaar_naam = excluded.eigenaar_naam,
    volgende_beoordeling = excluded.volgende_beoordeling;

  insert into public.risico_maatregelen
    (id, risico_id, beschrijving, status, verantwoordelijke, volgorde)
  values
    ('42800000-0000-0000-0000-000000000411', '42800000-0000-0000-0000-000000000401',
     'SYNTHETISCH — Wekelijkse datakwaliteitscontrole met onafhankelijke review.',
     'in_voorbereiding', 'Demo risicocommissie', 1)
  on conflict (id) do update set
    risico_id = excluded.risico_id, beschrijving = excluded.beschrijving,
    status = excluded.status, verantwoordelijke = excluded.verantwoordelijke,
    volgorde = excluded.volgorde;

  insert into public.documenten
    (id, fonds_id, bibliotheek, bron, titel, bestandsnaam, paginas, gepubliceerd,
     geindexeerd, context, documenttype, status, bronstatus, documentdatum,
     verwerkingsstatus, bestandstype, opslag_pad, actief,
     vervangt_document_id, vervangen_door_document_id, versie)
  values
    ('42800000-0000-0000-0000-000000000101', v_fonds, 'fonds', 'Intern',
     'SYNTHETISCH — Transitieplan Demo v1', 'app365-demo-transitieplan-v1.pdf', 3,
     '2026-09-15', true, 'algemeen', 'beleid', 'historisch', 'historisch',
     '2026-09-15', 'beschikbaar', 'pdf',
     v_fonds::text || '/app365-demo-transitieplan-v1.pdf', true,
     null, '42800000-0000-0000-0000-000000000102', '1.0'),
    ('42800000-0000-0000-0000-000000000102', v_fonds, 'fonds', 'Intern',
     'SYNTHETISCH — Transitieplan Demo v2', 'app365-demo-transitieplan-v2.pdf', 4,
     '2026-09-24', true, 'algemeen', 'beleid', 'van_kracht', 'actief',
     '2026-09-24', 'beschikbaar', 'pdf',
     v_fonds::text || '/app365-demo-transitieplan-v2.pdf', true,
     '42800000-0000-0000-0000-000000000101', null, '2.0')
  on conflict (id) do update set
    fonds_id = excluded.fonds_id, bibliotheek = excluded.bibliotheek,
    bron = excluded.bron, titel = excluded.titel, bestandsnaam = excluded.bestandsnaam,
    paginas = excluded.paginas, gepubliceerd = excluded.gepubliceerd,
    geindexeerd = excluded.geindexeerd, context = excluded.context,
    documenttype = excluded.documenttype, status = excluded.status,
    bronstatus = excluded.bronstatus, documentdatum = excluded.documentdatum,
    verwerkingsstatus = excluded.verwerkingsstatus, bestandstype = excluded.bestandstype,
    opslag_pad = excluded.opslag_pad, actief = excluded.actief,
    vervangt_document_id = excluded.vervangt_document_id,
    vervangen_door_document_id = excluded.vervangen_door_document_id,
    versie = excluded.versie;

  insert into public.document_chunks
    (id, document_id, chunk_index, tekst, pagina, structuur_type,
     structuur_label, indexering_versie)
  values
    ('42800000-0000-0000-0000-000000000111', '42800000-0000-0000-0000-000000000101', 0,
     'SYNTHETISCH transitieplan versie 1. De planning richt zich op afronding in het vierde kwartaal van 2026. De stuurgroep rapporteert maandelijks. Het belangrijkste risico is afhankelijkheid van één leverancier. De beheersmaatregelen zijn een vierogencontrole en een maandelijkse voortgangsrapportage.',
     1, 'tekst', 'SYNTHETISCH — Samenvatting v1', 'app365-demo-v1'),
    ('42800000-0000-0000-0000-000000000112', '42800000-0000-0000-0000-000000000102', 0,
     'SYNTHETISCH transitieplan versie 2. De planning verschuift naar januari 2027 en bevat tweewekelijkse bestuurlijke rapportage. De centrale risico''s zijn datakwaliteit en vertraging van de migratie. De beheersmaatregelen zijn een wekelijks kwaliteitsdashboard, onafhankelijke review en een expliciet herstelpad.',
     1, 'tekst', 'SYNTHETISCH — Samenvatting v2', 'app365-demo-v1')
  on conflict (id) do update set
    document_id = excluded.document_id, chunk_index = excluded.chunk_index,
    tekst = excluded.tekst, pagina = excluded.pagina,
    structuur_type = excluded.structuur_type,
    structuur_label = excluded.structuur_label,
    indexering_versie = excluded.indexering_versie;

  insert into public.document_agendapunten
    (id, fonds_id, document_id, agendapunt_id, vergadering_id)
  values
    ('42800000-0000-0000-0000-000000000221', v_fonds,
     '42800000-0000-0000-0000-000000000102',
     '42800000-0000-0000-0000-000000000211',
     '42800000-0000-0000-0000-000000000201')
  on conflict (document_id, agendapunt_id) do update set
    fonds_id = excluded.fonds_id, vergadering_id = excluded.vergadering_id;
end $$;

commit;
