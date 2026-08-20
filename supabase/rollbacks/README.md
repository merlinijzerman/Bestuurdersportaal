# supabase/rollbacks/

Terugdraai-scripts bij de forward-migraties in `../migrations/`. Eén bestand per
migratie, met dezelfde naam plus `_ROLLBACK`.

**Deze map wordt nooit automatisch uitgevoerd.** Dat is de hele reden dat hij
bestaat. Toen deze bestanden nog in `supabase/migrations/` stonden, zou
`supabase migration up` ze hebben toegepast — elke rollback direct ná zijn eigen
forward-migratie. Zie de ontwerpnotitie migratieproces v2.1, fout F1.

Een rollback draai je met de hand, bewust, en alleen als de bijbehorende
forward-migratie daadwerkelijk is toegepast. Sommige rollbacks falen bewust
gesloten (append-only registers); dat is geen defect maar het ontwerp.

De gate `scripts/check-migratie-mapindeling.sh` bewaakt dat deze map alleen
`*_ROLLBACK.sql` bevat en dat er geen rollback terugsluipt naar `migrations/`.
