# 0132 — Nulgrens-regressiepoort: smalle dekking + herformuleerd tweeledig slaagcriterium (B-9)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-05
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse & uitvoering)
- **Werkopdracht:** T3, plateau A — `04 Technische inrichting/Bestuurdersportaal - Werkopdracht T3 - Aantoonbaarheid evals assurance en doorwerking v1.0.md`
- **Ontwerp:** `03 Functioneel ontwerp/Bestuurdersportaal - Rol Bestuursbureau ontwerp v0.3.md`, §7.5
- **Bouwt op:** [`0130`](./0130-nulgrens-harde-opleveringsvoorwaarde.md) (nulgrens hard), [`0129`](./0129-t2-bureau-produceren-en-word-export.md) (sha256-diffbewijs)

## Context

Besluit `0130` maakt de nulgrens een harde opleveringsvoorwaarde met de regressiepoort als
bewijslast. B-9 vroeg dit concreet te maken: welke **dekking** heeft die poort en wat is
het **slaagcriterium**? Een volledige, uitputtende gedragsmatrix over alle zeven
antwoordmodi is voor plateau A onevenredig; tegelijk moet de poort het grootste breukvlak
echt afdekken.

## Besluit

De regressiepoort is **smal** — op de bestaande instrumenten en op de prompt-byte-
identiteit — met een **tweeledig** slaagcriterium: **(a) byte-identieke prompts** (de
sha256-pins in `core/lib/generatie-kern.sanity.ts` ongewijzigd, `npm run sanity` groen) **én
(b) gelijkblijvende eval-uitkomsten binnen de bestaande drempels** (de twee bestuurders-
evalsets opnieuw afgetekend: `document-doorgronden-gedrag.md` ≥2/3, `organisatieprofiel-
gedrag.md` 5/5). Beide legs groen = poort groen. Vastgelegd in
[`evals/nulgrens-regressiepoort.md`](../evals/nulgrens-regressiepoort.md).

## Overwogen alternatieven

- **Volledige modus×filter-regressiematrix (alle 7 modi afzonderlijk)** — verworpen voor
  plateau A: onevenredige evallast; de byte-identiteit van de prompts borgt de instructie
  per modus, de bestaande evalsets bemonsteren het gedrag.
- **Token-identieke output-diff** — onmogelijk: temperatuur 1.0 maakt output niet-
  deterministisch. Vandaar gedrag-binnen-drempels i.p.v. exacte output.

## Gevolgen

- **Expliciet wat NIET 1:1 gemeten wordt** (gedocumenteerd in de poort, §3): de zeven
  antwoordmodi worden niet elk afzonderlijk uitputtend gedekt; geen numerieke output-diff;
  de indirecte koppeling via `documents.status.change` blijft (bestond al sinds I-2, geen
  gedragswijziging). Dit is de aanvaarde dekkingskeuze, geen blinde vlek.
- **Herleidbaarheid:** leg (a) machinaal, leg (b) menselijk afgetekend. G23 in het
  guardrailregister (`core/lib/guardrailkader.ts`) verwijst naar besluit `0130` (nulgrens
  hard) en naar de regressiepoort; dit besluit (`0132`) bepaalt de dékking en het
  slaagcriterium van die poort.
- Geen RLS-/datamodel-/migratie-impact.

## Referenties

- Ontwerp §7.5 · [`evals/nulgrens-regressiepoort.md`](../evals/nulgrens-regressiepoort.md)
- `core/lib/generatie-kern.sanity.ts` · [`evals/document-doorgronden-gedrag.md`](../evals/document-doorgronden-gedrag.md) · [`evals/organisatieprofiel-gedrag.md`](../evals/organisatieprofiel-gedrag.md)
- Verwant: [`0130`](./0130-nulgrens-harde-opleveringsvoorwaarde.md), [`0131`](./0131-guardrailmatrix-canoniek-ai-gebruikskader.md)
