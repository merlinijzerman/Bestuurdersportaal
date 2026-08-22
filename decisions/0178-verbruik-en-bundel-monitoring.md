# 0178 — Verbruik & bundel: live bron, platformconfig en indicatieve weergave

- **Status:** Geaccepteerd
- **Datum:** 2026-08-15
- **Impact:** data en platformbeheer; geen tenanttoegang

## Context

De platformmonitoring toont AI-verbruik per fonds naast een afgesproken bundel. De
eerste mockup rekende bundel, pro-rata, prognose en signalering client-side op
fictieve gegevens. Voor een productiewaardige weergave waren een reproduceerbare
verbruiksbron, versieerbare commerciële configuratie en een eerlijke dekkingsgrens
nodig.

`platform_signal_snapshots.meta` is geen geschikte cumulatieve bron: het bevat
afgeleide signalen, geen stabiele maandbucket en wordt uitgedund. De append-only
`governance_log.retrieval_meta->tokens` bevat per gemeten modelaanroep input- en
outputtokens met fonds en tijdstip, maar dekt niet ieder AI-pad. Het resultaat is
daarom een aantoonbare ondergrens, geen factureerbaar bedrag.

## Besluit

1. Maandverbruik wordt read-time per fonds afgeleid uit de append-only auditmetadata,
   achter de platform-readgrens en met een harde leeslimiet. Afkapping blijft zichtbaar.
2. Bundel, tarieven, contractstart en `geldig_vanaf` staan in
   `public.fonds_licentie`. De tabel is platform-beheerd, heeft RLS zonder
   tenantpolicy en geen rechten voor `anon` of `authenticated`.
3. Cachetokens blijven binnen de bestaande inputtelling; een aparte prijsas vereist
   eerst een wijziging van het schrijf- en providercontract.
4. De UI noemt bedragen en prognose **indicatief** en presenteert overschrijding als
   signaal, nooit als factuur of automatisch doorbelast bedrag.
5. Previewconfiguratie staat uitsluitend in een omgevingsseed. Productieverbruik wordt
   niet naar Preview gekopieerd en synthetische gebruiksregels vervuilen het
   append-only auditspoor niet.
6. Wijziging van fondslicenties loopt via de bestaande platformcapability en
   twee-fasen-audit; elke nieuwe waarde krijgt een geldigheidsdatum en versie.

## Gevolgen

- De implementatie gebruikt `core/lib/verbruik-bundel-core.ts`,
  `platform/lib/verbruik-bundel-lees.ts` en de platformpagina's voor monitoring en
  licentiebeheer.
- De ontbrekende migratie, rollback en Preview-seed worden als afzonderlijke
  artefacten vastgelegd; productievolgorde blijft migratie vóór code.
- Geen tenantrol kan commerciële licentieconfig of verbruik van een ander fonds lezen.
- Open blijft of licentiewijzigingen vier-ogen-goedkeuring vereisen. Tot dat besluit is
  de bestaande capabilitygrens leidend en blijft iedere wijziging geaudit.

## Alternatieven

- **Signal-snapshots als bron:** verworpen wegens aggregatie, uitdunning en ontbreken
  van een stabiele maand-/in-uitbron.
- **Nieuw verbruikslog per aanroep:** verworpen voor deze fase; dupliceert het
  append-only auditspoor zonder het bestaande dekkingsgat te sluiten.
- **Client-only configuratie:** verworpen; niet versieerbaar, niet auditbaar en niet
  geschikt voor meerdere fondsen.

## Referenties

- [`MONITORING-P5-ONTWERP.md`](../MONITORING-P5-ONTWERP.md)
- [`supabase/migrations/2026_08_15_fonds_licentie.sql`](../supabase/migrations/2026_08_15_fonds_licentie.sql)
- [`core/lib/verbruik-bundel-core.ts`](../core/lib/verbruik-bundel-core.ts)
- [`platform/lib/verbruik-bundel-lees.ts`](../platform/lib/verbruik-bundel-lees.ts)
