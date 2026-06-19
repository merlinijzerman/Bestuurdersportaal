# Besluitlog (Decision Records)

Per architectuur-, governance- of productbesluit één kort markdown-bestand met het **waarom** erachter. Dit log vult `HANDOVER.md` aan: de HANDOVER beschrijft *wat* er is en *wat er wanneer veranderde* (release-historie); dit log beschrijft *waarom* een keuze is gemaakt, welke alternatieven zijn overwogen en wat de gevolgen zijn.

## Wanneer een besluit vastleggen

Schrijf een entry bij een besluit dat:

- de architectuur, het datamodel of een RLS-/auditprincipe raakt;
- moeilijk of kostbaar is om later terug te draaien;
- een bewuste afweging tussen alternatieven inhoudt;
- of bewust iets uitstelt of uitsluit ("we doen X bewust níet" is ook een besluit).

Triviale of puur uitvoerende wijzigingen horen in de release-historie van `HANDOVER.md`, niet hier.

## Conventie

- Eén bestand per besluit: `NNNN-korte-titel.md` (oplopend nummer, bv. `0003-...`).
- Kopieer `TEMPLATE.md` als startpunt.
- **Append-only**, net als de governance-events in het product zelf: een geaccepteerd besluit wordt niet herschreven. Een nieuw inzicht is een nieuw besluit dat het oude op `Vervangen door 0NNN` zet.
- Houd het kort: context, besluit, alternatieven, gevolgen.
- Zet in de `CLAUDE.md`-Definition-of-Done al: "bij een besluit een decision-log-entry".

## Index

| Nr | Titel | Status | Datum |
|----|-------|--------|-------|
| [0001](./0001-append-only-audit-geen-harddelete.md) | Append-only audit; Decision Objects niet hard-verwijderbaar | Geaccepteerd | 2026-05-19 |
| [0002](./0002-generieke-proceduremodule-definitie-als-data.md) | Generieke proceduremodule: definitie als data, bouwblok-engine uitgesteld | Geaccepteerd (richting) | 2026-05-22 |
| [0003](./0003-subagent-werkwijze.md) | Laag-A-subagents als ontwikkel-werkwijze (review + ontwerpborging) | Geaccepteerd | 2026-05-22 |
| [0004](./0004-werkverdeling-plannen-vs-uitvoeren.md) | Werkverdeling: plannen in Cowork, uitvoeren in Claude Code | Geaccepteerd | 2026-05-22 |
| [0005](./0005-rate-limiting-en-monitoring-in-stack-mvp.md) | Rate limiting (Postgres) en monitoring (Supabase/Vercel) in-stack voor MVP; geen Upstash/Sentry | Geaccepteerd | 2026-06-07 |
| [0006](./0006-doorontwikkeling-v2-beslispunten-B1-B10.md) | Doorontwikkeling v2: beslispunten B1–B11, O1 multi-fonds, O2 dossierstatus-mapping | Geaccepteerd | 2026-06-18 |
| [0007](./0007-fondsconsistentie-composite-fk-vs-trigger.md) | Fondsconsistentie op koppeltabellen: composite-FK standaard, trigger waar nodig | Geaccepteerd | 2026-06-18 |
| [0008](./0008-documentkoppeling-vooruitgetrokken-naar-increment-b.md) | Documentkoppeling vooruitgetrokken naar Increment B: primaire kolom + trigger nu, join-tabel later | Geaccepteerd | 2026-06-18 |
| [0009](./0009-increment-c-keuzes.md) | Increment C: Engelse routes, simpele capability-set, herindexering log-only, transitievalidatie | Geaccepteerd | 2026-06-18 |
