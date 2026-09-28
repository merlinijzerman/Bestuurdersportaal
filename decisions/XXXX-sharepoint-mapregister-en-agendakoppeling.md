# XXXX — SharePoint-mapregister en agendapuntkoppeling in het private Microsoft-schema

> **Concept.** Het nummer wordt pas bij het landen toegekend (laatste op `preview` bij het schrijven: 0214). Hernoem het bestand en de kop dan naar het eerstvolgende vrije nummer.

- **Status:** Voorgesteld
- **Datum:** 2026-09-28
- **Betrokkenen:** Merlin IJzerman
- **Scope:** #462 werkpakket B (PR-2); raakt de latere PR's voor contextcontract, gerichte SharePoint-inhoud en de koppel-UI

## Context

#462 vraagt dat een bestuurder een SharePoint-document of -map als AI-context kan gebruiken en aan een agendapunt kan koppelen. Voor documenten bestaat sinds fase 3B (#321) een privaat register: een lokale, fondsgebonden uuid vertaalt naar (bron, drive, item). Voor mappen gaf de lijstrespons alleen **paden** terug. Een pad is geen duurzame sleutel: een rename verandert het, en de browser kan elk pad verzinnen. Het kan dus niet dienen als koppelsleutel of als scope in een gesprek.

Randvoorwaarden: geen Graph-id's naar de browser, geen browsertoegang tot `microsoft_private`, fondsconsistentie volgens [[0007]], geen bestaansorakel voor refs van een ander fonds, en de bestaande documentenlijst mag niet omvallen.

## Besluit

1. **Mapregister** `microsoft_private.sharepoint_mappen`, een spiegel van `sharepoint_documenten`: lokale uuid ↔ (bron, drive, item), met naam, ouder, weergavepad, status en configuratieversie, en `unique (bron_id, item_id)`. Het wordt gevuld tijdens de bestaande enumeratie (`bouwDocumentboom` levert naast `mappen: string[]` nu ook `mapItems`). De lijstrespons krijgt er het veld `mapRefs: { ref, naam, mappad }[]` bij; `mappen` blijft ongewijzigd voor de bibliotheek-UI. Het register is **geen autorisatiebron**. Toegang wordt per beurt live via Graph getoetst.
2. **Koppeltabel** `microsoft_private.agendapunt_sharepoint_koppelingen` (n-op-n): elke rij verwijst naar precies één documentref óf één mapref (xor-CHECK), met `fonds_id NOT NULL`, `agendapunt_id`, `vergadering_id`, maker en tijdstip. Een koppelrij is onveranderlijk. Ontkoppelen verwijdert alleen de rij. Een verwijderd agendapunt cascadeert.
3. **Fondsconsistentie in twee lagen** ([[0007]]):
   - Aan de registerkant declaratief, met een composite-FK `(fonds_id, ref)` → register`(fonds_id, id)`. `sharepoint_documenten` krijgt daarvoor het ontbrekende `unique (fonds_id, id)`.
   - Aan de agendakant via een trigger (de 0007-uitzondering). `public.agendapunten` heeft geen `fonds_id`, en `vergaderingen.fonds_id` is nullable, dus een composite-FK is daar niet mogelijk. De trigger toetst agendapunt ↔ vergadering ↔ fonds, een niet-verwijderd agendapunt, en een actieve en actuele bron (drive en configuratieversie gelijk, status `gezien`).
4. **Smalle RPC's**, alle SECURITY DEFINER met gepind `search_path` en `EXECUTE` alleen voor `microsoft_vault`:
   - `sharepoint_upsert_mappen` (advisory lock per bron);
   - `sharepoint_lees_map` (dezelfde poorten als `sharepoint_lees_document`);
   - `sharepoint_koppel_agendapunt` (idempotent; `vergadering_id` wordt server-side afgeleid);
   - `sharepoint_ontkoppel_agendapunt`;
   - `sharepoint_lees_agendapunt_koppelingen` (lokale refs en weergavemetadata, plus een vlag `beschikbaar`).

   Elke weigering van een ref geeft één uniforme melding. Er is dus geen bestaansorakel.
5. **Capability voor de latere koppelroute:** `documents.metadata.update`, gelijk aan de portaalkoppeling `/api/documents/[id]/agendapunten`. PR-2 voegt zelf geen route toe.

## Overwogen alternatieven

- **Mappad als koppelsleutel.** Verworpen: niet duurzaam bij rename en door de browser te vervalsen.
- **Publieke koppeltabel met RLS**, naast `document_agendapunten`. Verworpen:
  - de koppeling verwijst naar private Graph-identiteit;
  - #462 sluit browser-directe tabellen voor Graph-identiteit expliciet uit;
  - zo'n tabel zou afhangen van de Supabase-Data-API-defaults voor nieuwe publieke tabellen.
- **Alleen een trigger voor fondsconsistentie, ook aan de registerkant.** Verworpen: aan die kant is declaratief mogelijk, en 0007 maakt dat de standaard. De trigger dekt alleen wat een FK niet kan uitdrukken.
- **Een fout in het mapregister laat de documentenlijst falen.** Verworpen: de lijst is een bestaande productieroute. Bij een fout blijft `mapRefs` leeg en meldt de inhoudsarme audit `mapregister: null`. Paden gaan nooit als surrogaatsleutel mee.
- **Onbruikbare koppelingen verbergen in de leesprojectie.** Verworpen: dan kan de gebruiker ze niet meer zien of ontkoppelen. Ze komen daarom terug met `beschikbaar = false`. De contextresolutie moet op die vlag filteren en per beurt opnieuw via `sharepoint_lees_document`/`sharepoint_lees_map` resolven.

## Gevolgen

- **RLS/tenant:** geen nieuw publiek object, dus de V3-grants-gate (public/storage) blijft ongewijzigd. Beide nieuwe tabellen hebben RLS aan zonder policies. Browser- en vaultrol hebben geen tabelrechten. Het gedrag is negatief bewezen in `supabase/checks/2026_09_28_462_sharepoint_mapregister_agendakoppeling.sql`, dat is aangesloten in `scripts/cross-tenant-ci.sh`.
- **Audit:** PR-2 voegt geen nieuwe gebeurtenissen toe. De lijstaudit krijgt het telveld `mapregister`. De koppel- en ontkoppelaudit hoort bij de route (werkpakket G).
- **Datamodel:** migratie `2026_09_28_462_sharepoint_mapregister_agendakoppeling.sql` met rollback. De rollback gooit koppelingen en maprefs weg, maar raakt het documentregister en SharePoint niet.
- **Bewust open:**
  - `sharepoint_markeer_map` (status na een mislukte Graph-resolve) volgt met de gerichte-inhoudlaag (D/E);
  - een lidmaatschapscheck van `p_gebruiker` op het fonds zit niet in de RPC, want de route dwingt de capability af, zoals bij de bestaande vault-RPC's.

## Referenties

- #462; [[0007]] (composite-FK versus trigger); fase 3B: `supabase/migrations/2026_09_04_microsoft_sharepoint_fase3b_documenten.sql`; #413: `2026_09_20_413_*`, `2026_09_21_413_*`.
- Portaalspiegel: `supabase/migrations/2026_08_14_document_agendapunten.sql`.
- Code: `core/lib/microsoft-sharepoint-graph-core.ts` (`bouwDocumentboom`), `core/lib/microsoft-sharepoint.ts` (`sharepointDocumenten`), `core/lib/microsoft-sharepoint-mapregister-core.ts`, `core/lib/microsoft-vault.ts`.
