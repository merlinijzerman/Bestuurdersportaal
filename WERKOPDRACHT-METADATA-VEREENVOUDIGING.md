# Werkopdracht: metadata-vereenvoudiging documenten (gefaseerd)

> Overdracht van plansessie (Cowork) naar Claude Code. Sjabloon: `WERKOPDRACHT-TEMPLATE.md`. Begin per fase in **Plan-modus**; wijzig pas na expliciet akkoord. Deze opdracht is samengevoegd uit de eerdere rapportage-/Optie-B-werkopdracht (concept, niet in de repo) en de status-as-vereenvoudiging.

---

## Doel & context

De documentmetadata is over meerdere increments complex geworden. Deze opdracht vereenvoudigt haar in drie fasen, van reversibel naar structureel, mét behoud van de RAG-correctheid, governance en auditbaarheid. Tegelijk repareren we een **regressie** (0140: nieuw bewijsbestand uploaden in een processtap faalt op ontbrekend `documenttype`) en voeren we documenttype **`rapportage`** in.

## Goedgekeurde besluiten & ontwerp (leidend)

- `IMPACTANALYSE-metadata-simplificatie` (v0.2) — spoor A (reversibel) vóór spoor B (structureel).
- `DOELMODEL-status-as` (v0.2) — documentstatus 8→5, bronstatus → `rag_uitgesloten`, statusprofiel = `mag_van_kracht`.
- Besluiten **0152** (reviewworkflow eruit), **0153** (bronstatus → `rag_uitgesloten`), **0154** (documentstatus 8→5). Achtergrond: 0136 (statusverklaring ingest), 0140 (classificatie ingest), 0091, 0013/0027.

## Overkoepelende scope

**Wel:** documenttype `rapportage`; Optie B (twee aparte velden bij bewijs-upload: readiness-tag + documenttype); regressie-fix; statusprofiel (`mag_van_kracht` + per-type labels); reviewworkflow verwijderen; bronstatus → `rag_uitgesloten`; documentstatus 8→5; afleiden van `context`/`documentdatum`; inerte vrije-tekstvelden uit de invoer.

**Niet:** Optie A/C (type-vocabulaire); bron-tiering/weging van analyses/rapportages als informatieve bron (aparte track); backfill van `documenttype` op bestaande documenten; `van_kracht` schrappen; `vastgesteld` hernoemen.

## Impactklasse per fase

- **Fase 1: data (licht) + UI** — additief/reversibel; één additieve CHECK (`rapportage`); geen destructieve migratie.
- **Fase 2: data + retrieval + security** — destructieve migratie (status-as); documentatiehaak vuurt, structurele gates verplicht, before/after RAG-bereik-diff verplicht.
- **Fase 3: data** — kolom-drops; documentatiehaak vuurt.

---

## FASE 1 — Classificatie & reversibele vereenvoudiging (spoor A)

Additief en terugdraaibaar; levert het grootste deel van de gevoelde eenvoud en fixt de regressie. Geen enum-migratie.

**1.1 Documenttype `rapportage`.** Migratie die `documenten_documenttype_check` vervangt met `rapportage` toegevoegd (na `analyse`); `Documenttype`/`DOCUMENTTYPEN`/`DOCUMENTTYPE_LABEL` in `document-metadata.ts`. Dropdowns die uit `DOCUMENTTYPEN` renderen krijgen het automatisch (verifieer geen hardcodes).

**1.2 Optie B + regressie-fix.** In `StapPaneel.tsx` een **tweede** dropdown "Documenttype" (uit `DOCUMENTTYPEN`), meegegeven aan `uploadDocument`. De readiness-tag (`bewijsDocumenttype`) blijft los naar `/api/procedures/[id]/bewijs`. **Eerst** de 400 reproduceren met een test (nieuw bewijsbestand zonder documenttype), **dan** fixen. Documenttype **verplicht** in de processtroom (client-validatie vóór submit), **optioneel** in de vergaderstroom (0140-uitzondering blijft).

**1.3 Statusprofiel-mechanisme (additief).** Pure helper `mag_van_kracht(documenttype)` + `toegestaneStatussenVoorType`: alle types delen `{concept, vastgesteld, historisch, gearchiveerd}`; alleen de normatieve cluster krijgt `van_kracht`. Per-type **labels** ("Vastgesteld"/"Definitief"/"Van kracht"). Server-side afgedwongen; UI toont alleen toegestane statussen. **Raakt de bestaande transitietabel niet** (extra filter, geen nieuwe transitie).

**1.4 Rapportage-classificatie.** `documentdatum` verplicht bij `documenttype='rapportage'` (nette 400 `documentdatum_ontbreekt`). Reuse `upload → vastgesteld` (0136). *Let op:* de "vorige rapportage → historisch"-retire verhuist naar fase 2 (hij hangt aan de nieuwe `historisch`-semantiek); tot dan blijft de vorige actueel of wordt handmatig afgevoerd — interim-restrisico, zie Openstaande punten.

**1.5 Afleiden i.p.v. vragen.** `context` volledig berekenen uit de FK-koppelingen (procesinstantie → dossier, vergadering → vergadering, anders algemeen); `documentdatum` defaulten op uploaddatum (editeerbaar). Neemt de huidige `context`-incoherentie weg. Kolom `context` blijft nog staan (drop in fase 3).

**1.6 Verbergen.** `bronstatus` uit de standaard-invoer/UI (alleen achter capability/"geavanceerd"); de inerte vrije-tekstvelden (`toepassingsgebied`, `doelgroep`, `statusinterpretatie`, en na gebruikscheck `regelingstype`/`thema`) niet meer tonen bij aanleveren. Kolommen blijven (drop in fase 3).

**1.7 Reviewworkflow-surface weg (0152).** Route `/api/metadata-review/queue`, de review-hub in `BeheerClient`, de `ReviewQueue`-types en de ingest-review-vlag verwijderen. De vier reviewvelden **stoppen met schrijven** (kolom-drop in fase 3). `document_metadata_log` (wijzigings-audit) **blijft**.

**Acceptatie fase 1:**
1. Nieuw bewijsbestand in een processtap uploaden lukt weer, mét verplicht documenttype; zonder → nette blokkade + 400.
2. Vergaderstuk kan nog zonder documenttype (0140-uitzondering).
3. `rapportage` kiesbaar en door de CHECK geaccepteerd; rapportage zonder `documentdatum` geweigerd.
4. `rapportage` biedt geen `van_kracht`; normatief wel.
5. `context` wordt afgeleid; een vergaderstuk levert `context='vergadering'`.
6. Reviewworkflow niet meer bereikbaar; `document_metadata_log`-tests groen. `tsc` schoon; sanity's groen.

---

## FASE 2 — Status-as structureel (spoor B, ná de verificatiequery)

Destructieve migratie; alleen ná de verificatiequery (impactanalyse §8 + doelmodel §8) en op een geklonede database getest. Besluiten 0153 + 0154 **samen** implementeren (gedeelde RPC-poort en transitietabel).

**2.1 Verificatie vooraf.** Draai de populatie-/bereikbaarheidsquery: 0 lezers van `ter_bespreking`/`ter_besluitvorming` op documentniveau; `van_kracht_niet_normatief`; `bronstatus`-onafhankelijkheid. Los mapping-signalen op.

**2.2 Documentstatus 8→5 (0154).** CHECK → `{concept, vastgesteld, van_kracht, historisch, gearchiveerd}`; transitietabel + **DB-trigger-spiegel** herzien; **nieuwe transitie `vastgesteld → historisch`**; "sprong verboden" vervalt; `van_kracht` via `mag_van_kracht`. Mapping: `ter_bespreking`/`ter_besluitvorming → concept`; `vervangen`/`alleen_historisch → historisch` (`vervangen_door` behouden).

**2.3 Bronstatus → `rag_uitgesloten` (0153).** `documenten` krijgt `rag_uitgesloten boolean`; `bronstatus` (+ chunk-denorm) vervalt; bronstatus-transities eruit; nieuwe capability `documents.rag.exclude` (redenplicht + auditregel). Mapping: `uitgesloten → rag_uitgesloten=true`; `historisch → documentstatus historisch`; overige default.

**2.4 RPC-poort herzien.** Onvoorwaardelijk in alle modi: `d.actief = true AND coalesce(rag_uitgesloten,false)=false AND documentstatus <> 'gearchiveerd'`. Actueel-poort: `documentstatus in ('vastgesteld','van_kracht')` + NULL-veilig geldigheidsvenster (ongewijzigd t.o.v. nu). `bronstatus='actief'`-eis eruit. `rag.ts` (`isPubliceerbaar`, `ACTUELE_BRON_STATUSSEN`, `zouActueelZijn`) + `generiek-status.ts` bijwerken.

**2.5 Rapportage-retire.** "Vorige rapportage → `documentstatus historisch`" via de nieuwe transitie (human-in-the-loop: kies de op te volgen rapportage; auditregel).

**Acceptatie fase 2:**
1. **RAG-bereik-diff:** per document + AQLab-testset before/after (actueel/historisch/uitgesloten), elke delta verklaard, **nul onverklaarde verschuivingen**.
2. Een terminaal-vastgesteld type kan naar `historisch` (nieuwe transitie) én naar `gearchiveerd`.
3. `rag_uitgesloten=true` weert een document in **alle** modi.
4. `gearchiveerd` is in geen enkele modus vindbaar (universele poort).
5. Transitietabel en DB-trigger-spiegel 1-op-1; alle status-sanity's groen; SQL-02-regressie opnieuw geijkt.

---

## FASE 3 — Opruiming (spoor B, sluitstuk)

Ná fase 1/2, wanneer de populatie-/gebruikschecks bevestigen dat de velden dood zijn.

**3.1** Drop de reviewvelden (`metadata_te_controleren`, `metadata_review_status`, `metadata_gecontroleerd_door/-op`).
**3.2** Drop de inerte vrije-tekstvelden (`toepassingsgebied`, `doelgroep`, `statusinterpretatie`; `regelingstype`/`thema` alleen na bevestigde gebruikscheck).
**3.3** Drop de `context`-kolom + de twee CHECK-constraints; verifieer eerst de join-tabel `document_procesinstanties` en dat niets buiten `valideerContext` de enum leest. `context` wordt vanaf hier volledig afgeleid.

**Acceptatie fase 3:** kolommen weg, geen dode referenties, `tsc`/sanity's groen, documentatie geactualiseerd.

---

## Guardrails & H/D/M

Alle nieuwe borging is klasse **D** (server-side, deterministisch, getest): documenttype-plicht (proces), `documentdatum`-plicht (rapportage), statusprofiel, `rag_uitgesloten`-filter, de herziene RPC-poort. Klasse **H** blijft: CHECK-constraints, capabilities (`documents.status.change`, `documents.rag.exclude`), RLS. Geen compliance-guardrail verhuist naar uitsluitend **M**.

## In te zetten subagents

`supabase-rls-reviewer` (migraties/RPC/policies), `audit-evidence-reviewer` (append-only `document_metadata_log` intact; nieuwe auditregels), `ai-governance-reviewer` (actueel-definitie/schijnzekerheid niet verzwakt), `code-reviewer` (eindstap), `ontwerp-sync-reviewer` vóór merge.

## Openstaande punten (in `openstaande-punten-en-risicos.md`, mét eigenaar)

1. **Interim-restrisico fase 1:** rapportages stapelen als "actueel" tot de retire-stap in fase 2 landt; mitigatie = handmatige afvoer of fase 2 kort erachteraan.
2. **Bron-tiering** van analyses/rapportages als informatieve bron — aparte track (bewaakt de M-kernregel).
3. **`bestuursvoorstel`-semantiek** als een fonds "vastgesteld" breed wil definiëren.
4. **Onomkeerbaarheid** fase 2/3: kloon-test + herstelpad vóór productie.

## Definition of Done

Volg `CLAUDE.md` §Definition of Done, per fase. Decision-records: 0152, 0153, 0154 (aanwezig). Documentatiehaak bij fase 2/3 (data-impact). Terugkoppeling in het `CLAUDE.md`-antwoordformat.
