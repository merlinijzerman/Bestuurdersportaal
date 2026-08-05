# Governance-log — bewaartermijn & retentie (ontwerp + beslispunt)

| | |
|---|---|
| **Status** | Ontwerp ter besluitvorming — GEEN code geïmplementeerd |
| **Datum** | 5 augustus 2026 |
| **Herkomst** | PvA vectorless/hybride retrieval, backlog B-15 |
| **Waarom ontwerp i.p.v. implementatie** | Retentie botst met een niet-onderhandelbare guardrail (append-only audit) én de bewaartermijn is een compliance-/DPO-besluit dat niet in code mag worden "gekozen" |

## 1. Probleem

De AVG vereist dat persoonsgegevens niet langer worden bewaard dan noodzakelijk (opslagbeperking, art. 5 lid 1e). Tegelijk stelt `CLAUDE.md` een **niet-onderhandelbare guardrail**: *"Append-only audit. `governance_events` … en de `*_log`-tabellen worden nooit ge-UPDATE of -DELETE; triggers blokkeren dit."* Een naïeve retentie-/delete-job op `governance_log` zou die guardrail schenden en de auditintegriteit ondermijnen. Retentie en append-only lijken hier in conflict — dat is de kern van dit ontwerp.

## 2. Feiten (geverifieerd in code/docs)

- `governance_log` legt per chatbeurt vast: `gebruiker_id`, `gebruiker_naam`, `fonds_id`, **`vraag` (plain text)**, **`antwoord` (plain text)**, **`bronnen` (jsonb, incl. citaatfragmenten)**, `modus`, `model`, `retrieval_meta` (jsonb), `aangemaakt`. [FEIT-code: `schema.sql` governance_log]
- Append-only wordt als conventie/trigger afgedwongen; hard-delete is principieel uitgesloten. [FEIT-doc: `CLAUDE.md`]
- Er bestaat al een **dataclassificatie-scheiding**: sinds "plateau A" is de inhoudelijke bronset (`sources[]`, META_INHOUD) verplaatst naar een aparte tabel `governance_log_inhoud`; `chunks`/`scope.document_ids` blijven als META_BRON in het append-only spoor. [FEIT-code: `bronset.ts`]
- Bewaartermijnen zijn **niet gedefinieerd** — expliciet openstaand compliance-punt. [FEIT-doc: `mvp-beperkingen.md`]
- **Let op:** ook `retrieval_meta` kan persoonsgegevens bevatten (bv. `zoekvraag`/`gereformuleerd` = de gebruikersvraag). Retentie mag zich dus niet beperken tot alleen `vraag`/`antwoord`/`bronnen`.

## 3. Ontwerpprincipe: scheid het onveranderlijke auditskelet van de inhoudslaag

De oplossing voor het schijnbare conflict is een scheiding die deels al bestaat:

- **Auditskelet (append-only, blijft onaangeroerd):** *wie* (gebruiker/fonds/rol), *wanneer*, *welke modus/model*, *welke retrievalroute/filters/scores/chunk-ids* — de bewijslast dát er iets gebeurde en hoe. Bevat geen persoonsgegevens zodra de vrije-tekstvelden eruit zijn. Dit skelet houdt de auditgarantie intact.
- **Inhoudslaag (retentiegevoelig):** de vrije tekst en citaten die persoonsgegevens/vertrouwelijke passages kunnen bevatten — `vraag`, `antwoord`, `bronnen`-fragmenten, en de vraag-afgeleide velden in `retrieval_meta` (`zoekvraag`, `gereformuleerd`). Hierop past retentie toe.

Retentie wordt dus **op de inhoudslaag** toegepast, niet op het auditskelet. Zo blijft "auditdata is niet manipuleerbaar" overeind, terwijl PII wordt geminimaliseerd. Dit bouwt voort op de bestaande `governance_log_inhoud`-splitsing.

## 4. Opties voor de inhoudslaag (te kiezen)

1. **Time-based purge van de inhoudslaag** — na X maanden worden de vrije-tekstvelden geleegd/verwijderd via een gecontroleerde platform-job (service-role achter `withPlatform` + audit), niet via een publiek recht. Het auditskelet blijft. Eenvoudig; de "verwijdering" is zichtbaar als een geregistreerde, geautoriseerde onderhoudsactie (geen stille mutatie).
2. **Crypto-shredding** — inhoud versleuteld opslaan per periode-sleutel; na de termijn de sleutel vernietigen → inhoud onleesbaar zonder de rij te muteren. Sterkste "append-only-vriendelijke" variant (geen DELETE nodig), maar meer sleutelbeheer.
3. **Anonimiseren** — PII in de vrije tekst redigeren i.p.v. verwijderen. Behoudt analysewaarde, maar redactie is nooit 100% betrouwbaar bij vrije tekst; risicovoller.

## 5. Beslispunten (voor product/DPO/compliance)

1. **Bewaartermijn X** voor de inhoudslaag (bv. 6 / 12 / 24 maanden). *Compliance-/DPO-besluit; niet door engineering in te vullen.*
2. **Techniek:** purge (optie 1), crypto-shredding (optie 2) of anonimiseren (optie 3).
3. **Reikwijdte:** bevestigen dat `retrieval_meta.zoekvraag`/`gereformuleerd` én `bronnen`-fragmenten onder de inhoudslaag vallen, en het auditskelet aantoonbaar PII-vrij is.
4. **Uitvoering & autorisatie:** de retentie-job draait als gecontroleerde platform-actie (service-role achter `withPlatform` + audit + evt. vier-ogen), nooit als recht voor `anon`/`authenticated`.
5. **Verhouding tot de append-only-guardrail:** vastleggen dat retentie op de inhoudslaag een *expliciet geautoriseerde, geregistreerde* uitzondering is, en het auditskelet onder de trigger-bescherming blijft. Dit vraagt om een decision-log-entry.

## 6. Migratie-/implementatieskelet (NIET actief — illustratief)

```sql
-- ILLUSTRATIEF, NIET DRAAIEN zonder besluit (termijn + techniek + DPO-akkoord).
-- Optie 1 (purge inhoudslaag): een gecontroleerde platform-RPC, geen publiek recht.
-- create or replace function platform.governance_inhoud_retentie(p_termijn interval)
--   returns int language sql security definer set search_path = public, pg_temp as $$
--     with weg as (
--       delete from public.governance_log_inhoud
--       where aangemaakt < now() - p_termijn
--       returning 1
--     ) select count(*) from weg;
--   $$;
-- revoke all on function platform.governance_inhoud_retentie(interval) from public, anon, authenticated;
-- -- alleen aanroepbaar via de platform-service-role, achter withPlatform + audit.
-- -- Vergeet de vraag-afgeleide velden in retrieval_meta niet (aparte purge/redactie).
```

## 7. Advies

Kies **optie 1 (purge van de inhoudslaag) of optie 2 (crypto-shredding)**, met een door DPO/compliance vastgestelde termijn, uitgevoerd als geauditeerde platform-job, en leg de uitzondering op de append-only-regel vast in een decision-log-entry. Implementeer pas ná dit besluit. Tot die tijd is dit ontwerp de openstaande actie; de code blijft ongewijzigd.
