# Doelmodel: de status-as van documenten (documentstatus + bronstatus + statusprofiel)

| | |
|---|---|
| **Status** | v0.2 — ontwerp ter bespreking (plansessie Cowork); externe review verwerkt |
| **Doel** | Eén samenhangend doelmodel voor de drie statuslagen, als onderligger voor besluit 0153 (bronstatus) en een nieuw besluit (documentstatus). |
| **Spoor** | B (structureel) uit `IMPACTANALYSE-metadata-simplificatie` — onomkeerbaar, dus mét migratie + verificatie. |
| **Grondslag** | Geverifieerd tegen de retrieval-RPC (`2026_08_06_..._tiebreaker_efsearch.sql`, regels 117-129), `core/lib/document-status-transities.ts`, `core/lib/rag.ts`, `core/lib/generiek-status.ts`. |

---

## 1. Waarom

De status-as telt nu drie lagen en twaalf waarden (8 documentstatus + 4 bronstatus), maar de code leest daarvan slechts **vier uitkomsten**: *in wording*, *actueel*, *historisch-vindbaar*, *weg*. De rest is besluitvormingsceremonie (die al op de dossier-/procedurestatus leeft) en governance-nuance die geen enkele retrieval- of weergavecode onderscheidt. Dit model brengt de opslag terug tot wat werkelijk gedrag stuurt.

## 2. Het doelmodel in één beeld

```
                 rag_uitgesloten = true  ─────────────►  (hard uit RAG, alle modi; orthogonaal aan status)

  upload ──► concept ──► vastgesteld ──►[normatief]──► van_kracht
                              │                              │
                              └──────────► historisch ◄──────┘
                                              │
   (elke status) ─────────────────────────────┴──► gearchiveerd   (weg uit alle modi)
```

**Documentstatus — 5 waarden (was 8):**

| Status | Betekenis | RAG-gedrag |
|---|---|---|
| `concept` | In wording (absorbeert `ter_bespreking` + `ter_besluitvorming`) | niet actueel; vindbaar in besluitvorming/alles |
| `vastgesteld` | Vastgesteld/geëffectueerd | **actueel** |
| `van_kracht` | Geldende norm — **alleen normatieve types** (statusprofiel) | **actueel** |
| `historisch` | Niet meer actueel (merge van `vervangen` + `alleen_historisch`; `vervangen_door` blijft als optionele opvolger-FK) | niet actueel; vindbaar in historisch/alles |
| `gearchiveerd` | Afgevoerd | uit alle modi |

**Bronstatus — vervalt.** Vervangen door:

| Oud | Doel |
|---|---|
| `uitgesloten` | boolean **`rag_uitgesloten`** (default false) — harde uitsluiting in **álle** modi, onvoorwaardelijk in de RPC (zoals `actief`) |
| `historisch` | documentstatus `historisch` en/of `geldig_tot` (peildatum) |
| `actief_na_vaststelling` | vervalt — de documentstatus-poort dekt dit al |
| `actief` / NULL | default, geen veld |

**Statusprofiel — teruggebracht tot één vlag per documenttype:** `mag_van_kracht`. Alle types delen `{concept, vastgesteld, historisch, gearchiveerd}`; alleen de normatieve cluster krijgt daarnaast `van_kracht`.

### 2.1 Governancebetekenis van de drie "niet-actueel"-vormen

Om te voorkomen dat `gearchiveerd` een generieke "oud document"-knop wordt, leggen we de betekenis expliciet vast:

- **`historisch`** — inhoudelijk niet meer actueel, maar behoort nog tot het bestuurlijke/institutionele geheugen; **vindbaar** als historische context (mens én AI in historisch/alles).
- **`gearchiveerd`** — administratief bewaard, **niet meer beschikbaar** als inhoudelijke context voor gebruiker of AI.
- **`rag_uitgesloten`** (eigenschap, geen status) — mag voor gebruikers zichtbaar blijven, maar **niet als AI-bron** worden gebruikt.

### 2.2 Token versus label — `vastgesteld` blijft de opgeslagen waarde

De opgeslagen statuswaarde is een documenttype-neutrale *token*; het zichtbare *label* komt uit het statusprofiel per type. Zo toont de UI "Vastgesteld" bij een besluit, "Definitief" bij een memo/analyse/rapportage en "Van kracht" bij geldend beleid — zónder de onderliggende waarde te hernoemen. Bewuste keuze: het opgeslagen token blijft `vastgesteld` (kleinere migratiesurface dan een enum-rename; het semantische verschil per type wordt door de labellaag gedragen, niet door de opslag).

## 3. RAG-semantiek in het doelmodel (de nieuwe RPC-poort)

- **Onvoorwaardelijk, alle modi:** `d.actief = true AND coalesce(rag_uitgesloten,false) = false AND documentstatus <> 'gearchiveerd'`. De `gearchiveerd`-clausule staat hier **expliciet** — anders zou een gearchiveerd document onder historisch/alles (waar geen statuspoort geldt) alsnog lekken. Dit sluit tevens het huidige gat waarin `uitgesloten` alléén onder `actueel` hard werd geweerd. *(Verifiëren: zet archiveren vandaag óók `actief=false`? Zo ja is deze clausule belt-and-braces; zo nee is hij dragend.)*
- **Actueel-poort:** `documentstatus in ('vastgesteld','van_kracht')` **én** het NULL-veilige geldigheidsvenster — exact zoals de RPC het nú al doet (regels 125-126): `(geldig_vanaf is null or geldig_vanaf <= peildatum) and (geldig_tot is null or geldig_tot >= peildatum)`. Een vastgesteld document zónder geldigheidsdatums blijft dus actueel. De `bronstatus='actief'`-eis vervalt (die deed niets extra's naast deze poort).
- **Historisch/alles/besluitvorming:** geen statuspoort (alles vindbaar), met uitzondering van de onvoorwaardelijke `rag_uitgesloten`- en `actief`-filters.

Netto: `historisch` valt uit actueel maar blijft vindbaar; `gearchiveerd`/`rag_uitgesloten` vallen overal uit; `van_kracht` en `vastgesteld` zijn gelijkwaardig actueel (het onderscheid is governance/toekomstige tiering, geen retrievalfilter).

## 4. Transitietabel (doel)

| Van | Naar | Capability | Reden | Bijzonder |
|---|---|---|---|---|
| upload | `concept` | upload | nee | default |
| upload | `vastgesteld` | documents.status.change | ja | ingest extern vastgesteld (0136) |
| upload | `van_kracht` | documents.status.change | ja | ingest, **alleen normatief** (profiel) |
| `concept` | `vastgesteld` | documents.status.change | ja | **nieuw toegestaan** — de "sprong verboden"-regel vervalt (geen tussenstaten meer) |
| `vastgesteld` | `van_kracht` | documents.status.change | nee | **alleen normatief** (profiel) |
| `vastgesteld` | `historisch` | documents.status.change | ja | **nieuw** — afvoeren van een niet-normatief stuk; `vervangen_door` optioneel |
| `van_kracht` | `historisch` | documents.status.change | ja | merge van →vervangen/→alleen_historisch; `vervangen_door` optioneel |
| elke status | `gearchiveerd` | documents.status.change | ja | |
| — | `rag_uitgesloten` toggle | documents.rag.exclude *(nieuw)* | ja | orthogonaal aan status |

De **`vastgesteld → historisch`-transitie is cruciaal**: zonder die stap kan een terminaal-vastgesteld type (rapportage, notulen, analyse) alleen `gearchiveerd` (weg) worden en niet `historisch` (vindbaar) — de doodlopende route die we willen vermijden.

## 5. Statusprofiel per documenttype

| Documenttype-cluster | Types | `mag_van_kracht` |
|---|---|---|
| Normatief | `beleid`, `besluit`, `besluitdocument`, `besluitregistratie` | **ja** |
| In besluitvorming | `bestuursvoorstel` | nee — **route `concept → historisch`** (een voorstel wordt *behandeld*, niet vastgesteld; het bíjbehorende besluit wordt vastgesteld). Alleen als het fonds "vastgesteld" breed als "definitieve versie" definieert, geldt `concept → vastgesteld`; dat geeft semantische vervuiling en raden we af. |
| Informatief/vaststaand | `notulen`, `advies`, `memo`, `analyse`, `rapportage`, `bijlage`, `overig` | nee |

Alle types: `{concept, vastgesteld, historisch, gearchiveerd}`. De rapportage-werkopdracht (vorige rapportage → historisch) mapt hiermee op `documentstatus=historisch` i.p.v. de oude `bronstatus=historisch` — consistent met dit model.

## 6. Bereikbaarheidscheck (elke type heeft een historisch-eindstaat)

- **Normatief:** `vastgesteld → van_kracht → historisch` ✓ en `vastgesteld → historisch` ✓
- **Niet-normatief:** `vastgesteld → historisch` ✓ (dankzij de nieuwe transitie)
- **Alle:** `→ gearchiveerd` ✓

Geen enkel type eindigt gedwongen op `gearchiveerd` als het "historisch-vindbaar" hoort te zijn.

## 7. Oud → nieuw mapping (datamigratie)

| Oude documentstatus | Nieuw |
|---|---|
| `concept`, `ter_bespreking`, `ter_besluitvorming` | `concept` |
| `vastgesteld` | `vastgesteld` |
| `van_kracht` | `van_kracht` (indien type niet-normatief blijkt: `vastgesteld` — signaleren) |
| `vervangen`, `alleen_historisch` | `historisch` (`vervangen_door` behouden) |
| `gearchiveerd` | `gearchiveerd` |

| Oude bronstatus | Actie |
|---|---|
| `actief`, `actief_na_vaststelling`, NULL | niets (default) |
| `historisch` | zet documentstatus `historisch` (als de status nu in de actueel-set zit); anders ongemoeid |
| `uitgesloten` | `rag_uitgesloten = true` (documentstatus ongewijzigd) |

## 8. Verificatie vooraf (draai vóór de migratie)

```sql
select
  count(*)                                                         as documenten,
  -- besluitvormingsfase op het document die verloren gaat (moet 0 lezers hebben):
  count(*) filter (where status in ('ter_bespreking','ter_besluitvorming')) as in_tussenstaat,
  -- normatief vs. van_kracht-consistentie (van_kracht bij een niet-normatief type = mapping-signaal):
  count(*) filter (where status = 'van_kracht'
    and documenttype not in ('beleid','besluit','besluitdocument','besluitregistratie'))
                                                                   as van_kracht_niet_normatief,
  count(*) filter (where bronstatus = 'uitgesloten')               as wordt_rag_uitgesloten,
  count(*) filter (where bronstatus = 'historisch')                as bronstatus_historisch,
  count(*) filter (where status in ('vastgesteld','van_kracht') and bronstatus = 'historisch')
                                                                   as actueel_maar_historisch
from public.documenten
group by fonds_id;
```

`van_kracht_niet_normatief > 0` betekent dat er documenten zijn die de nieuwe profiel-regel schenden — die vragen een expliciete mappingkeuze vóór migratie. `in_tussenstaat` toont hoeveel rijen naar `concept` terugvallen.

**Belangrijkste bewijsvoering — RAG-bereik-diff (before/after).** Datamodel-consistentie is niet genoeg; de echte vraag is of de vereenvoudiging de AI-antwoorden stil verandert. Bepaal daarom vóór én ná de migratie, per document (en op de AQLab-testset), in welke bucket het valt — **actueel / historisch-vindbaar / uitgesloten** — en verklaar elke delta. Nul onverklaarde verschuivingen is de acceptatie-eis. Praktisch: draai de retrieval-buckets tegen een gekloonde database met de migratie toegepast en diff tegen productie-peildatum; en draai de AQLab-regressieset op beide en vergelijk bron-selectie + antwoord.

## 9. Blast radius (geraakte onderdelen — verifiëren tegen de code)

- **Datamodel/migratie:** `documenten.status`-CHECK (5 waarden), `documenten` krijgt `rag_uitgesloten boolean`, `documenten.bronstatus` + de chunk-denorm-kolom vervallen; `document_chunks`-denorm bijwerken; het statusprofiel als `mag_van_kracht`-lookup.
- **Retrieval:** de RPC `zoek_chunks_hybride` (de actueel-poort + de nieuwe onvoorwaardelijke `rag_uitgesloten`-filter), `core/lib/rag.ts` (`isPubliceerbaar`, `ACTUELE_BRON_STATUSSEN`, `zouActueelZijn`).
- **Statusmachine:** `core/lib/document-status-transities.ts` (documentstatus- én bronstatus-transities) + de **DB-trigger-spiegel** `fn_document_status_transitie` — dubbel bijwerken.
- **Ingest:** het 0140-pad (`document-ingest-classificatie.ts`, `upload/route.ts`) — de bronstatus-verklaring vervalt, de `rag_uitgesloten`-toggle komt erbij.
- **Weergave:** `core/lib/generiek-status.ts` (status→displaymapping), documentlijst/bibliotheek-UI, metadata-PATCH.
- **Tests:** alle `*status*.sanity.ts` + de RAG-regressie (SQL-02) opnieuw ijken.

## 10. Gefaseerde uitrol & relatie tot de besluiten

1. **Eerst spoor A** (reversibel, al besproken): statusprofiel-UI, bronstatus verbergen, context/documentdatum afleiden, inerte velden uit de invoer. Levert de gevoelde eenvoud zonder migratie.
2. **Verificatiequery (§8)** draaien → bevestigt dat de merges veilig zijn (0 lezers van de tussenstaten; bronstatus-onafhankelijkheid).
3. **Besluit 0153 (bronstatus → `rag_uitgesloten`)** en **een nieuw besluit (documentstatus 8→5)** — samen geïmplementeerd als één migratie, want ze delen de RPC-poort en de transitietabel.
4. **0152 (reviewworkflow)** kan onafhankelijk vooruit.

## 11. Risico's & restrisico's

- **Onomkeerbaar:** documentstatus/bronstatus-migratie vereist een herstelpad; test op een kopie vóór productie.
- **Semantiek `bestuursvoorstel`:** vastgelegd als `concept → historisch` (behandeld, niet vastgesteld). Restpunt alleen als een fonds "vastgesteld" bewust als "definitieve versie" wil gebruiken.
- **Intentieverlies bij afvoeren:** gebruik `status=historisch` + `vervangen_door` voor de bedoeling, `geldig_tot` alleen voor een datum — niet `geldig_tot` als verkapte intrekking (zie 0153-overweging).
- **`van_kracht` behouden — besloten ja.** Blijft als normatief-only status omdat "geldende norm" een natuurlijk bestuurlijk begrip is (en toekomstige tiering voedt). NB: de *timing* van inwerkingtreding (bv. vastgesteld 1 okt, van kracht per 1 jan) wordt in de RAG feitelijk door `geldig_vanaf` afgehandeld, niet door de status — een vastgesteld stuk vóór zijn `geldig_vanaf` valt door het geldigheidsvenster al buiten "actueel". `van_kracht` draagt dus de bestuurlijke betekenis, niet de retrieval-timing.
- **Governance:** `audit-evidence-reviewer` bevestigt dat het append-only wijzigingsspoor (`document_metadata_log`) intact blijft; `ai-governance-reviewer` toetst dat de actueel-definitie (schijnzekerheid) niet verzwakt.
