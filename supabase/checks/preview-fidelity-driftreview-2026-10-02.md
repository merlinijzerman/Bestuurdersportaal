# Preview-fidelity — driftreview en herijking na #505 (02-10-2026)

Onderbouwing bij `supabase/checks/preview-fidelity-verwacht.sha256`: `2e6b9414…` → `b92f3c34efdf23ed02d265d55284215878cda6d1cc82d042d77fe3d29b45ec24`. Zie ook #334, #505, #518, #519 en #520.

## Methode

- **Momentopname:** dezelfde `supabase/checks/2026_08_19_drift_momentopname.sql` en categoriefilter (`functie|policy|rls|publication|execute`) als `scripts/preview-fidelity-readonly.sh`. Read-only op `portal_preview` (`swviwoytzvaqypieqgji`).
- **Referentie:** een verse lokale database (baseline plus alle migraties) op **Preview-commit `589cffb`**, en dezelfde database nadat de #505-migratie is toegepast (SHA-256 `3d90e931…53ea`).
- **Vergelijking:** regel voor regel per object, niet alleen de eindhash.
- **Productiebaseline bewust ongewijzigd:** `drift-momentopname-verwacht.txt` hoort bij de Productie-driftcontrole (`scripts/drift-vergelijk.sh`, signaal 1). Productie heeft #505 nog niet, dus dat bestand wordt pas bij de productierelease bijgewerkt.

## Uitkomst

| Meting | Uitkomst |
|---|---|
| Preview vóór #505 | `3528b5ec…` (917 regels) |
| Preview na #505 | **`b92f3c34…`** (917 regels) |
| Preview vóór → na | precies **6** regels gewijzigd: uitsluitend de zes #505-policies (sectie 2) |
| Preview na ↔ referentie `589cffb` mét #505 | precies de **66** uitzonderingen uit sectie 1; geen 67e afwijking |
| 66 uitzonderingen vóór ↔ na | exact onveranderd |
| Gates na #505 | R1 A–H incl. D, V3 en #505-tenantpariteit (`na`) groen; geen residu |

## 1. Bestaande, beoordeelde afwijkingen tussen Preview en de repo (66)

Exacte objectnamen, geen wildcards. Samenstelling:
- 62 × `pg_trgm`: versie 1.6, schema `public`, grants ongewijzigd (#518);
- 1 × verklaarde storage-policy;
- 2 × functies die alleen tekstueel afwijken (#519);
- 1 × **functionele** afwijking in `fn_afschrift_bevries_kolommen`: live strenger dan een verse repo-opbouw. Dit is een tijdelijk geaccepteerde drift en niet de canonieke toestand (#519, P1).

| # | categorie | object | verklaring |
|---|---|---|---|
| 1 | execute | `public.gin_extract_query_trgm` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 2 | execute | `public.gin_extract_value_trgm` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 3 | execute | `public.gin_trgm_consistent` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 4 | execute | `public.gin_trgm_triconsistent` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 5 | execute | `public.gtrgm_compress` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 6 | execute | `public.gtrgm_consistent` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 7 | execute | `public.gtrgm_decompress` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 8 | execute | `public.gtrgm_distance` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 9 | execute | `public.gtrgm_in` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 10 | execute | `public.gtrgm_options` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 11 | execute | `public.gtrgm_out` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 12 | execute | `public.gtrgm_penalty` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 13 | execute | `public.gtrgm_picksplit` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 14 | execute | `public.gtrgm_same` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 15 | execute | `public.gtrgm_union` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 16 | execute | `public.set_limit` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 17 | execute | `public.show_limit` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 18 | execute | `public.show_trgm` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 19 | execute | `public.similarity` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 20 | execute | `public.similarity_dist` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 21 | execute | `public.similarity_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 22 | execute | `public.strict_word_similarity` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 23 | execute | `public.strict_word_similarity_commutator_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 24 | execute | `public.strict_word_similarity_dist_commutator_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 25 | execute | `public.strict_word_similarity_dist_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 26 | execute | `public.strict_word_similarity_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 27 | execute | `public.word_similarity` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 28 | execute | `public.word_similarity_commutator_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 29 | execute | `public.word_similarity_dist_commutator_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 30 | execute | `public.word_similarity_dist_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 31 | execute | `public.word_similarity_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 32 | functie | `public.fn_access_token_hook` | #445: alleen tekst (commentaar/lege regels); signatuur, owner, secdef, search_path, config, grants en genormaliseerde body identiek (read-only geverifieerd 02-10) |
| 33 | functie | `public.fn_afschrift_bevries_kolommen` | FUNCTIONEEL: live (Preview én Productie, md5 eff69f3f…) bevriest extra `ai_leeswijzer_tekst`; verse repo-opbouw mist die regel (latere migratie herbouwt uit oudere body, zie #445). Live strenger dan repo — tijdelijk geaccepteerde drift, niet canoniek; P1 in ticket functiedefinities |
| 34 | functie | `public.fn_profiel_fondslock` | #445: alleen tekst (commentaar/lege regels); signatuur, owner, secdef, search_path, config, grants en genormaliseerde body identiek (read-only geverifieerd 02-10) |
| 35 | functie | `public.gin_extract_query_trgm` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 36 | functie | `public.gin_extract_value_trgm` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 37 | functie | `public.gin_trgm_consistent` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 38 | functie | `public.gin_trgm_triconsistent` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 39 | functie | `public.gtrgm_compress` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 40 | functie | `public.gtrgm_consistent` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 41 | functie | `public.gtrgm_decompress` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 42 | functie | `public.gtrgm_distance` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 43 | functie | `public.gtrgm_in` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 44 | functie | `public.gtrgm_options` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 45 | functie | `public.gtrgm_out` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 46 | functie | `public.gtrgm_penalty` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 47 | functie | `public.gtrgm_picksplit` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 48 | functie | `public.gtrgm_same` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 49 | functie | `public.gtrgm_union` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 50 | functie | `public.set_limit` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 51 | functie | `public.show_limit` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 52 | functie | `public.show_trgm` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 53 | functie | `public.similarity` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 54 | functie | `public.similarity_dist` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 55 | functie | `public.similarity_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 56 | functie | `public.strict_word_similarity` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 57 | functie | `public.strict_word_similarity_commutator_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 58 | functie | `public.strict_word_similarity_dist_commutator_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 59 | functie | `public.strict_word_similarity_dist_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 60 | functie | `public.strict_word_similarity_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 61 | functie | `public.word_similarity` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 62 | functie | `public.word_similarity_commutator_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 63 | functie | `public.word_similarity_dist_commutator_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 64 | functie | `public.word_similarity_dist_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 65 | functie | `public.word_similarity_op` | pg_trgm 1.6, schema public, huidige grants ongewijzigd — staat op Preview én Productie, niet door repo aangemaakt; geaccepteerde bestaande afwijking |
| 66 | policy | `storage.buckets.drift_lezer leest bucketdefinities` | scripts/drift-readonly-rol.sql (rol drift_lezer, PR #216 / besluit 0195) — repo-script, geen migratie; verklaard |

## 2. Verwachte wijzigingen door #505 (6)

Alleen de expressievorm verandert: `auth.uid()` wordt `(select auth.uid())`. Naam, cmd, permissive-instelling, rollen, USING en WITH CHECK blijven, na normalisatie, identiek.

- policy `public.document_chunks.chunks select`
- policy `public.document_chunks.chunks write eigen fonds`
- policy `public.documenten.documenten delete eigen fonds`
- policy `public.documenten.documenten insert eigen fonds`
- policy `public.documenten.documenten select`
- policy `public.documenten.documenten update eigen fonds`

## 3. Wijzigingen sinds de vorige pin (`e2cd063`, 01-09) tot vóór #505 (34)

Verschillen tussen de oude pin-momentopname en Preview vóór #505, elk gekoppeld aan de laatste migratie die het object aanraakt. Er zijn geen onbekende objecten. Deze wijzigingen zijn de oorzaak van de rode nightly sinds 04-09.

| categorie | object | soort | migratie |
|---|---|---|---|
| execute | `public.fn_access_token_hook` | nieuw | `2026_09_07_microsoft_login_beleidsmodus.sql` |
| execute | `public.fn_adapterstand_fonds` | nieuw | `2026_09_23_434_adapterstand_fonds.sql` |
| execute | `public.fn_fonds_ai_configuratie_standaard` | nieuw | `2026_09_04_ai_gateway_configuratie.sql` |
| execute | `public.fn_fonds_integratieprofiel_standaard` | nieuw | `2026_09_04_microsoft_fase1_connectorfundament.sql` |
| execute | `public.fn_fonds_microsoft_login_audit` | nieuw | `2026_09_07_microsoft_login_beleidsmodus.sql` |
| execute | `public.fn_fonds_microsoft_login_standaard` | nieuw | `2026_09_07_microsoft_login_beleidsmodus.sql` |
| execute | `public.fn_platform_generiek_document_bijwerken` | nieuw | `2026_09_30_499_generieke_metadatawijziging_timeout.sql` |
| execute | `public.fn_profiel_fondslock` | nieuw | `2026_09_07_microsoft_login_beleidsmodus.sql` |
| execute | `public.fn_schrijf_vergelijking` | gewijzigd | `2026_09_29_493_vergelijk_juridische_rollen.sql` |
| execute | `public.meta_adapters_projectie` | nieuw | `2026_09_23_434_adapterstand_fonds.sql` |
| execute | `public.meta_agendapunt_sharepoint_projectie` | nieuw | `2026_09_28_462_agendapunt_sharepoint_auditprojectie.sql` |
| functie | `public.fn_access_token_hook` | nieuw | `2026_09_07_microsoft_login_beleidsmodus.sql` |
| functie | `public.fn_adapterstand_fonds` | nieuw | `2026_09_23_434_adapterstand_fonds.sql` |
| functie | `public.fn_ai_actietype_spec` | gewijzigd | `2026_09_04_t4_ai_actietype_semantische_extractie.sql` |
| functie | `public.fn_chunk_denorm_refresh` | gewijzigd | `2026_09_30_499_generieke_metadatawijziging_timeout.sql` |
| functie | `public.fn_fonds_ai_configuratie_standaard` | nieuw | `2026_09_04_ai_gateway_configuratie.sql` |
| functie | `public.fn_fonds_integratieprofiel_standaard` | nieuw | `2026_09_04_microsoft_fase1_connectorfundament.sql` |
| functie | `public.fn_fonds_microsoft_login_audit` | nieuw | `2026_09_07_microsoft_login_beleidsmodus.sql` |
| functie | `public.fn_fonds_microsoft_login_standaard` | nieuw | `2026_09_07_microsoft_login_beleidsmodus.sql` |
| functie | `public.fn_platform_generiek_document_bijwerken` | nieuw | `2026_09_30_499_generieke_metadatawijziging_timeout.sql` |
| functie | `public.fn_profiel_fondslock` | nieuw | `2026_09_07_microsoft_login_beleidsmodus.sql` |
| functie | `public.fn_schrijf_vergelijking` | gewijzigd | `2026_09_29_493_vergelijk_juridische_rollen.sql` |
| functie | `public.meta_adapters_projectie` | nieuw | `2026_09_23_434_adapterstand_fonds.sql` |
| functie | `public.meta_agendapunt_sharepoint_projectie` | nieuw | `2026_09_28_462_agendapunt_sharepoint_auditprojectie.sql` |
| functie | `public.meta_basisniveau` | gewijzigd | `2026_09_28_462_agendapunt_sharepoint_auditprojectie.sql` |
| functie | `public.meta_bronniveau` | gewijzigd | `2026_09_28_462_agendapunt_sharepoint_auditprojectie.sql` |
| functie | `public.meta_projectie` | gewijzigd | `2026_09_28_462_agendapunt_sharepoint_auditprojectie.sql` |
| policy | `public.fonds_integratie_profielen.integratieprofiel lezen eigen fonds` | nieuw | `2026_09_04_microsoft_fase1_connectorfundament.sql` |
| policy | `public.fonds_microsoft_login.hook owner leest loginconfig` | nieuw | `2026_09_06_microsoft_login_fase1b.sql` |
| policy | `public.fonds_microsoft_login.microsoft login config lezen eigen fonds` | nieuw | `2026_09_06_microsoft_login_fase1b.sql` |
| policy | `public.profielen.beperkte sessie leest eigen profiel` | nieuw | `2026_09_07_microsoft_login_beleidsmodus.sql` |
| policy | `public.profielen.hook owner leest profiel fonds` | nieuw | `2026_09_06_microsoft_login_fase1b.sql` |
| rls | `fonds_integratie_profielen` | nieuw | `2026_09_22_428_app365_demo_fonds_config.sql` |
| rls | `fonds_microsoft_login` | nieuw | `2026_09_22_428_app365_demo_fonds_config.sql` |
