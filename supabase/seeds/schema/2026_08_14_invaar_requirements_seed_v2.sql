-- ============================================================
--  Migratie 2026-08-14 — Invaarprocedure: requirements-seed v2 (standaardset)
--  Herseedt procedure_requirements voor template_code 'pf_wtp_invaarbesluit'
--  met de bewijslast uit de standaardset (incl. de nieuwe kolom `toelichting`,
--  zie 2026_08_14_procedure_toelichting_kolommen.sql). Vervangt de seed van
--  2026_08_13 (idempotent: delete + insert per template_code). De
--  readiness/evidence-laag leest deze live per template_code, dus de wijziging
--  is meteen zichtbaar voor alle procedures van dit template.
--
--  BRON = definities/pensioenfondsen/pf_wtp_invaarbesluit@2.0.0.json. Het blok
--  tussen de GEGENEREERD-markers is DETERMINISTISCH afgeleid door
--  core/lib/procedure-requirements-seed.ts::genereerRequirementsSeed() en wordt
--  bewaakt door core/lib/procedure-requirements-seed.sanity.ts (drift-check).
--  Bewerk het blok niet met de hand — regenereer uit de definitie.
--
--  Vereist: 2026_08_14_procedure_toelichting_kolommen.sql (de toelichting-kolom).
-- ============================================================

begin;

-- <<GEGENEREERD_UIT_DEFINITIE>>
delete from public.procedure_requirements
 where template_code = 'pf_wtp_invaarbesluit' and template_versie = '2.0.0';

insert into public.procedure_requirements
  (template_code, template_versie, stap_volgorde, requirement_type, label, documenttype,
   veld_pad, verplicht, blokkerend, min_aantal, vereist_validatie_domein,
   toelichting)
values
  ('pf_wtp_invaarbesluit', '2.0.0', 1, 'document', 'Transitieplan', null, null, true, true, 1, null, 'Definitieve, bestuurlijk gebruikte versie inclusief bijlagen en versiehistorie.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 1, 'document', 'Formeel invaarverzoek', null, null, true, true, 1, null, 'Bewaar het verzoek zoals ontvangen, inclusief reikwijdte, datum en eventuele voorwaarden.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 1, 'document', '(Gewijzigde) pensioenovereenkomst/-regeling en compensatieafspraken', null, null, true, false, 1, null, 'Gebruik generieke terminologie; de precieze documentvorm verschilt per fondstype en arbeidsvoorwaardelijke context.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 2, 'document', 'RPO-rapport en besluit risicohouding', null, null, true, false, 1, null, 'Inclusief onderbouwing hoe RPO, deelnemerskenmerken en wetenschappelijke inzichten zijn gewogen.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 2, 'document', 'Bestuurlijk beoordelingskader / evenwichtigheidsraamwerk', null, null, true, true, 1, null, 'Bevat groepen, maatstaven, bandbreedtes, voorrangsregels en materialiteitscriteria.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 2, 'approval', 'Vaststellingsbesluit beoordelingskader', null, null, true, false, 1, null, 'Notulen/besluit waaruit blijkt dat het kader tijdig is vastgesteld.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 3, 'document', 'Implementatieplan', null, null, true, true, 1, null, 'Definitieve bestuursversie plus relevante bijlagen en wijzigingshistorie.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 3, 'risk', 'Integrale transitie-risicoanalyse (bijv. ERB/RSA of vergelijkbaar)', null, null, true, false, 1, null, 'Vorm is fondsspecifiek; de risicoanalyse moet de materiële Wtp-transitierisico''s aantoonbaar afdekken.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 3, 'document', 'RACI/verantwoordelijkheidsmatrix en ketenafspraken', null, null, false, false, 1, null, 'Onderbouwt dat de ketenverantwoordelijkheden niet alleen in projectdocumentatie maar bestuurlijk zijn geborgd.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 3, 'document', 'Teststrategie / QA-plan en acceptatiecriteria', null, null, true, false, 1, null, 'Koppel de criteria aan de latere go/no-go en leg onafhankelijke kwaliteitsborging vast.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 3, 'document', 'Fallback-/uitstelplan', null, null, true, false, 1, null, 'Beschrijft scenario, triggers, besluitbevoegdheid en deelnemers-/toezichtcommunicatie.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 3, 'assumption', 'Materiële aannames uitvoerbaarheid', null, null, false, false, 1, null, 'Geen kunstmatig minimumaantal: registreer alleen aannames die de besluitvorming of readiness materieel beïnvloeden.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 3, 'dissent_review', 'Opinies en afwijkende inzichten sleutelfuncties', null, null, true, false, 1, null, 'Leg zowel de opinie als de bestuurlijke verwerking van kritische punten vast.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 4, 'document', 'Datakwaliteitsbeleid, risicoanalyse en correctie-/herzieningenbeleid', null, null, true, false, 1, null, 'Inclusief kritieke data-elementen, MTA/risicobereidheid en uitgevoerde beheersmaatregelen.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 4, 'document', 'Rapport externe accountant / externe IT-auditor vóór invaren', null, null, true, true, 1, null, 'Minimaal werkzaamheden passend binnen de door DNB beschreven opdrachtvorm; bevindingen en opvolging zijn onderdeel van de fondsbeoordeling.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 4, 'approval', 'Bestuursoordeel datakwaliteit', null, null, true, true, 1, null, 'Expliciete bestuurlijke conclusie dat de data voldoende betrouwbaar zijn voor besluitvorming en invaren.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 4, 'document', 'Modelvalidatie- en plausibiliteitsrapportage', null, null, true, false, 1, null, 'Bevat modelscope, validatie, uitkomsten, gevoeligheden en verklaring van materiële afwijkingen.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 4, 'assumption', 'Gevalideerde kernaannames data/model', null, null, false, false, 1, null, 'Registreer alleen materiële aannames en leg vast hoe wijzigingen worden gemonitord.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 4, 'risk', 'Restrisico datakwaliteit', null, null, true, false, 1, null, 'Inclusief resterende bevindingen, impact, eigenaar, oplosdatum en acceptatie.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 5, 'document', 'Transitie-effect- en evenwichtigheidsrapportage', null, null, true, true, 1, null, 'Integreert effecten, verklaringen, alternatieven, criteria en de bestuurlijke weging.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 5, 'kpi', 'Netto-profijt en pensioenverwachtingen per cohort/groep', null, null, true, false, 1, null, 'Bewaar resultaten op voldoende detailniveau om later te kunnen reproduceren welke uitkomsten aan het bestuur zijn voorgelegd.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 5, 'document', 'Onderbouwing invaarmethodiek en vermogensverdeling', null, null, true, false, 1, null, 'Inclusief berekeningen, gekozen parameters en bestuurlijke argumentatie.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 5, 'document', 'Reserve- en compensatieanalyse', null, null, false, false, 1, null, 'Voor zover solidariteitsreserve, risicodelingsreserve en/of compensatie(depot) onderdeel zijn van de transitie.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 5, 'document', 'Scenario-, alternatief- en gevoeligheidsanalyse', null, null, true, false, 1, null, 'Onderbouwt robuustheid en de afweging van alternatieven.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 5, 'evaluation', 'Evenwichtigheidsoordeel bestuur', null, null, true, true, 1, null, 'Expliciet besluit/oordeel met motivering per materiële deelnemersgroep en over de transitie als geheel.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 6, 'document', 'Communicatieplan en AFM-aanleverformulier', null, null, true, true, 1, null, 'Bewaar ingediende versie, bijlagen en onderbouwing van de gemaakte communicatiekeuzes.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 6, 'document', 'Doelgroep-, boodschap- en kanalenmatrix', null, null, true, false, 1, null, 'Herleidbaar overzicht van doelgroep, boodschap, kanaal, timing en gewenste uitkomst.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 6, 'document', 'Onderbouwing persoonlijke toelichtingen en peildatum', null, null, true, false, 1, null, 'Leg keuze van peildatum en aanpak van persoonlijke verschilverklaringen vast.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 6, 'evaluation', 'Deelnemertesten en effectmeting', null, null, true, false, 1, null, 'Resultaten plus aantoonbare verwerking van bevindingen in communicatie.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 6, 'document', 'Keuzebegeleidingsontwerp en testresultaten', null, null, false, false, 1, null, 'Alleen opnemen waar deelnemers materiële keuzes hebben waarop de wettelijke norm keuzebegeleiding van toepassing is.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 7, 'document', 'Voorgenomen invaarbesluit en integrale beslisnota', null, null, true, true, 1, null, 'Centraal besluitdocument met bronverwijzingen naar onderliggende dossierstukken.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 7, 'approval', 'Voorgenomen opdrachtaanvaarding / opdrachtbevestiging', null, null, true, false, 1, null, 'Terminologie en exacte documentvorm kunnen per fonds verschillen; leg de formele aanvaarding van de uitvoeringsopdracht aantoonbaar vast.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 7, 'document', 'Opinies sleutelfunctiehouders', null, null, true, false, 1, null, 'Inclusief bestuurreactie op materiële bevindingen.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 7, 'dissent_review', 'Afwijkende inzichten / dissent', null, null, false, false, 1, null, 'Leg relevante minderheidsstandpunten of fundamentele twijfels vast, inclusief afweging door het bestuur.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 7, 'mandate_check', 'Bevoegdheid en mandaat voorgenomen besluit', null, null, true, false, 1, null, 'Toets statuten, reglementen en eventuele delegatie/mandatering.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 8, 'approval', 'Goedkeuring BO', null, null, false, false, 1, null, 'Alleen bij een fonds met belanghebbendenorgaan.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 8, 'document', 'Oordeel / rapportage intern toezicht', null, null, true, false, 1, null, 'De vorm verschilt per bestuursmodel; de inhoudelijke aandachtspunten en reactie van het bestuur horen in het dossier.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 8, 'approval', 'Goedkeuring Raad van Toezicht', null, null, false, false, 1, null, 'Alleen indien een Raad van Toezicht aanwezig is.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 8, 'dissent_review', 'Reactie- en wijzigingenmatrix governance', null, null, false, false, 1, null, 'Praktische bewijslast om adviespunten, bestuursreactie en wijzigingen reproduceerbaar te koppelen.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 9, 'external_submission', 'Bevestiging invaarmelding DNB', null, null, true, true, 1, null, 'Bewijs van tijdige en volledige indiening.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 9, 'document', 'Ingevuld invaarsjabloon', null, null, true, true, 1, null, 'Bewaar de ingediende versie plus eventuele latere versies met wijzigingshistorie.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 9, 'external_submission', 'Bevestiging indiening communicatieplan AFM', null, null, true, false, 1, null, 'Inclusief AFM-aanleverformulier en eventuele bijlagen.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 9, 'document', 'Toezichtvragen-, bevindingen- en opvolgingslog', null, null, true, false, 1, null, 'Combineer vraag, antwoord, bron, eigenaar, deadline, wijziging en closure.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 9, 'approval', 'DNB-beschikking (wel/geen verbod) en eventuele voorschriften/toezichtbrief', null, null, true, true, 1, null, 'Gebruik ''beschikking'' in plaats van ''DNB-goedkeuring''. Voor daadwerkelijke invaren is een beschikking zonder verbod vereist.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 9, 'document', 'AFM-terugkoppeling communicatieplan en opvolging', null, null, true, false, 1, null, 'AFM-terugkoppeling is toezichtinput, geen formele goedkeuring.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 10, 'document', 'Prognose-transitieoverzicht (model en representatieve voorbeelden)', null, null, true, false, 1, null, 'Bewaar zowel het generieke ontwerp als voorbeelden van de conditionele/persoonlijke invulling.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 10, 'document', 'Bewijs tijdige verstrekking prognose-transitieoverzicht', null, null, true, true, 1, null, 'Verzend-/publicatielog met dekking van de relevante populatie.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 10, 'evaluation', 'Segmentatie- en productiecontrole communicatie', null, null, true, false, 1, null, 'Controle op populatie, conditionele teksten, bedragen en kanaalconsistentie.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 10, 'document', 'Klantcontact-readiness (FAQ, scripts, training, klachten-/escalatieproces)', null, null, true, false, 1, null, 'Bevat eigenaarschap, escalatieroutes en monitoring van veelvoorkomende vragen en klachten.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 11, 'document', 'Go/no-go-dossier', null, null, true, true, 1, null, 'Integraal overzicht van criteria, bewijs, bevindingen, voorwaarden en conclusie.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 11, 'kpi', 'Readiness-criteria en finale statusrapportage', null, null, true, false, 1, null, 'Minimaal administratie, IT, data, keten, vermogen, communicatie en toezichtvoorwaarden.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 11, 'risk', 'Actuele restrisico''s en fallback-/uitstelplan', null, null, true, false, 1, null, 'Alle geaccepteerde restrisico''s moeten expliciet bij de finale beslissing zijn betrokken.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 11, 'external_submission', 'Bewijs naleving DNB-voorschriften / melding materiële wijzigingen', null, null, false, false, 1, null, 'Alleen voor zover voorschriften of materiële wijzigingen aan de orde zijn.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 11, 'approval', 'Finale go/no-go-besluit', null, null, true, true, 1, null, 'Expliciet bestuursbesluit met datum, voorwaarden en verwijzing naar het go/no-go-dossier.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 11, 'mandate_check', 'Bevoegdheid go/no-go-besluit', null, null, true, false, 1, null, 'Controleer statutaire/reglementaire bevoegdheid en eventuele delegaties.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 12, 'document', 'Post-invaar rapport externe accountant over juistheid en volledigheid van de transitie', null, null, true, false, 1, null, 'Verplichte externe controle na transitie; reikwijdte omvat ten minste de vermogensverdelingsberekeningen.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 12, 'document', 'Reconciliatie- en vermogensverdelingsrapport', null, null, true, false, 1, null, 'Bewijs dat de feitelijke verdeling en administratieve verwerking aansluiten op het invaarbesluit en de gecontroleerde berekeningen.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 12, 'document', 'Definitief transitieoverzicht (model en representatieve voorbeelden)', null, null, true, false, 1, null, 'Bewaar voorbeelden voor verschillende relevante deelnemerssituaties.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 12, 'document', 'Bewijs tijdige verstrekking definitief transitieoverzicht', null, null, true, false, 1, null, 'Verzend-/publicatielog waaruit blijkt dat uiterlijk zes maanden na transitiedatum is verstrekt.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 12, 'document', 'Verschillenanalyse prognose versus definitief', null, null, true, false, 1, null, 'Onderbouw oorzaken van verschillen en koppel deze aan de persoonlijke toelichting.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 12, 'risk', 'Incidenten-, correctie- en herstelregister', null, null, true, false, 1, null, 'Bevat impact, deelnemersgroep, herstelactie, eigenaar, status en eventuele toezichtmelding.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 12, 'kpi', 'Klachten-, klantcontact- en keuzemonitoring', null, null, false, false, 1, null, 'Analyseer volumes, categorieën, doelgroepen en trends en vertaal materiële signalen naar bestuurlijke acties.'),
  ('pf_wtp_invaarbesluit', '2.0.0', 12, 'evaluation', 'Bestuursevaluatie en verbeteracties', null, null, false, false, 1, null, 'Leg lessons learned, openstaande beheersacties en overdracht naar lijnorganisatie vast.');
-- <</GEGENEREERD_UIT_DEFINITIE>>

commit;
