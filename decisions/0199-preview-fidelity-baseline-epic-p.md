# 0199 — Preview-fidelitybaseline na EPIC P

- **Status:** Geaccepteerd
- **Datum:** 2026-08-31
- **Betrokkenen:** Product, engineering en releasebeheer

## Context

De vaste Preview-fidelitycontrole vergelijkt uitsluitend de catalogus (functies,
policies, RLS, publications en browser-EXECUTE-rechten) met een versieerbare
Preview-baseline. Na de handmatige, gecontroleerde EPIC P-uitrol was de nachtelijke
controle rood: de oude baseline kende de nieuwe procedure-engineobjecten nog niet.

## Besluit

De baseline wordt herijkt op de beoordeelde Preview-momentopname van 31 augustus
2026. De wijziging omvat uitsluitend de beoogde EPIC P-catalogusdelta's (P1–P5),
plus de reeds aanwezige `vector`-extensieversie 0.8.2. Er zijn geen onverwachte
grants, policies of RLS-uitzonderingen toegelaten.

## Overwogen alternatieven

- **De oude hash laten staan** — afgewezen: dan blijft een bewust en beoordeeld
  verschil het operationele signaal verbergen.
- **De vergelijking uitschakelen of verbreden** — afgewezen: de controle blijft
  fail-closed en beperkt tot omgevingsonafhankelijke schema- en securitycategorieën.

## Gevolgen

Een volgende groene nightly-run bewijst dat Preview sindsdien niet verder is
afgedreven. Dit is geen productiepromotie en verandert geen productiegegevens,
migraties, RLS-beleid of applicatiecode. Nieuwe cataloguswijzigingen blijven de
controle opnieuw rood maken totdat zij expliciet zijn beoordeeld.

## Referenties

- `supabase/checks/drift-momentopname-verwacht.txt`
- `supabase/checks/preview-fidelity-verwacht.sha256`
- `scripts/preview-fidelity-readonly.sh`
- Besluit [0195](./0195-vaste-preview-readonly-fidelity.md)
