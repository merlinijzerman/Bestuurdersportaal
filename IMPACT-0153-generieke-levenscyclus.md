# Impact-inventaris 0153: de generieke-content-levenscyclus (T6/T10)

| | |
|---|---|
| **Status** | v0.1 — inventaris ter aftekening vóór de 0153-bouw (Fase 2B) |
| **Aanleiding** | Tijdens de bouw bleek `bronstatus` de generieke-bibliotheek-levenscyclus te dragen; dit stond niet in `DOELMODEL-status-as` §9. Deze inventaris maakt de exacte surface af. |
| **Grondslag** | `core/lib/generiek-status.ts`, migratie `2026_07_10_t10_generiek_transitiepoort.sql`, `2026_07_09_t6_generiek_beheerkenmerken.sql`, `app/(platform)/.../generieke-bibliotheek/`. |

---

## 1. Wat de generieke-levenscyclus vandaag is

De **generieke** (platform-gecureerde) bibliotheek heeft een eigen, **afgeleide** levenscyclus met vier statussen (besluit 0040): `draft` · `published` · `deprecated` · `withdrawn`. Er is géén aparte kolom — de status wordt afgeleid uit `status` + `bronstatus` via `fn_generiek_geldigheidsstatus` (SQL) en zijn 1-op-1 TS-spiegel `generiekGeldigheidsstatus`:

| Generieke status | Afleiding vandaag |
|---|---|
| `published` | `status='van_kracht' AND coalesce(bronstatus,'actief')='actief'` (de 0045-gate) |
| `withdrawn` | `status='gearchiveerd' OR bronstatus='uitgesloten'` |
| `deprecated` | `status='historisch' OR bronstatus='historisch'` |
| `draft` | anders |

Daaromheen (T10, migratie `2026_07_10`):
- **`fn_generiek_transitie(van, naar)`** — de canonieke overgangen tussen de *afgeleide* statussen: `published→deprecated`, `published→withdrawn`, `deprecated→withdrawn`, `deprecated→published` (herpublicatie); `withdrawn` is terminaal. Alle met redenplicht.
- **`trg_generiek_status_overgang`** — BEFORE UPDATE op `documenten`: berekent oude/nieuwe afgeleide status en dwingt een toegestane overgang + reden af. T10 splitst dit van de tenant-trigger (`fn_document_status_overgang_check`): generieke content volgt de generieke poort.
- **Platform-curatie-UI/acties** (`app/(platform)/.../generieke-bibliotheek/acties.ts`, `GeneriekeBibliotheekClient.tsx`, `page.tsx`) — o.a. `curatieIntrekken` (zet `status=alleen_historisch` + `bronstatus`), en detecteert canonieke overgangen via `generiekGeldigheidsstatus` om dezelfde redenplicht toe te passen.

## 2. Waar `bronstatus` precies in zit

Twee van de vier afgeleide statussen leunen op `bronstatus`: `withdrawn` (`bronstatus='uitgesloten'`) en `deprecated` (`bronstatus='historisch'`); en `published` eist `bronstatus='actief'`. `bronstatus` droppen (0153) raakt dus de afleiding direct.

## 3. Doel-herbedrading (1-op-1 mapbaar)

De afleiding wordt herschreven op de nieuwe velden — en dat kan **schoon en betekenisbehoudend**, want de 0153/0154-mapping dekt elke bronstatus-rol:

| Generieke status | Nieuwe afleiding (na 0153 + 0154) |
|---|---|
| `published` | `status='van_kracht' AND rag_uitgesloten=false` |
| `withdrawn` | `status='gearchiveerd' OR rag_uitgesloten=true` |
| `deprecated` | `status='historisch'` (nu een eersteklas documentstatus na 0154) |
| `draft` | anders |

Onderliggende mapping: `bronstatus='uitgesloten' → rag_uitgesloten=true`; `bronstatus='historisch' → documentstatus='historisch'`; `bronstatus='actief'/NULL → default`.

**Wat verandert:** de *signatuur* van `fn_generiek_geldigheidsstatus(status, bronstatus)` → `(status, rag_uitgesloten)` en zijn TS-spiegel `generiekGeldigheidsstatus`; de trigger-call (`old.bronstatus/new.bronstatus → old.rag_uitgesloten/new.rag_uitgesloten`) én de trigger-kolomlijst (moet nu ook op `rag_uitgesloten`-wijzigingen vuren); de platform-acties die de onderliggende velden zetten (`curatieIntrekken` → `rag_uitgesloten=true` i.p.v. `bronstatus=uitgesloten`; "laten vervallen" → `documentstatus=historisch`).

**Wat ONgewijzigd blijft (belangrijk voor het risico):** de vier afgeleide statussen zelf, `fn_generiek_transitie` en de canonieke overgangen (die werken op de *afgeleide* status, niet op de ruwe velden), en het platform-UI-gedrag. Zolang de nieuwe afleiding dezelfde vier statussen uit de nieuwe velden produceert, is de curatie-ervaring identiek.

## 4. Geraakte bestanden

- `core/lib/generiek-status.ts` — `generiekGeldigheidsstatus`/`isPublished`-signatuur + `.sanity.ts`.
- Nieuwe migratie — herdefinieert `fn_generiek_geldigheidsstatus`, `fn_generiek_status_overgang_check` (call + `of ...`-kolomlijst van de trigger). `fn_generiek_transitie` en de canonieke overgangen blijven.
- `app/(platform)/.../generieke-bibliotheek/acties.ts` — `curatieIntrekken` + canonieke-overgangdetectie + veld-reads/writes.
- `GeneriekeBibliotheekClient.tsx` / `page.tsx` — velden die `bronstatus` zetten/tonen → `rag_uitgesloten`/`documentstatus`.
- Controle: `2026_07_09_t6_generiek_beheerkenmerken.sql` verwijst naar de 0045-gate (`status='van_kracht' AND coalesce(bronstatus,'actief')='actief'`) — zorg dat de T6-kenmerken op de nieuwe published-definitie blijven aansluiten.

## 5. Acceptatie (voor Fase 2B)

1. **Generieke displaystatus before/after gelijk:** voor elke generieke documentrij levert de oude `(status,bronstatus)`-afleiding dezelfde `draft/published/deprecated/withdrawn` als de nieuwe `(status,rag_uitgesloten)`-afleiding. Nul verschillen.
2. `trg_generiek_status_overgang` vuurt óók op een `rag_uitgesloten`-toggle (published→withdrawn) en dwingt redenplicht af.
3. `fn_generiek_transitie` + canonieke overgangen ongewijzigd; generiek-status-sanity's groen.
4. Structurele gates schoon; de tenant- en generiek-trigger blijven gescheiden (T10-splitsing intact).

## 6. Restrisico's / open

- De generieke transitiepoort en de tenant-transitietabel (0154) veranderen in dezelfde release van onderliggende velden — verifieer dat de T10-splitsing (twee triggers op `documenten`) intact blijft en elkaar niet in de weg zit.
- `withdrawn` is terminaal in de generieke poort; controleer dat een `rag_uitgesloten`-toggle-terug (uitsluiting opheffen) geen verboden `withdrawn→published`-sprong forceert — mogelijk moet "uitsluiting opheffen" apart van de generieke transitie-semantiek staan (rag_uitgesloten is immers orthogonaal aan de levenscyclus, besluit 0153).
