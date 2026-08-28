# #183b spoor T — brontabel-inventaris + schrijfvorm (bindt de vorm vóór de sweep)

| | |
|---|---|
| **Type** | Ontwerp/vormbesluit — voorwaarde uit besluit 0192 §5 |
| **Spoor** | W · #183b spoor T (de 12 `ketengebeurtenis_vereist`-handlers) |
| **Volgt op** | [`0192`](decisions/0192-governance-events-tenantketen.md) (tenantketen + fn_govevent_fonds), 0191 §7 |
| **Status** | Ter besluit — twee scopingvragen open (§6) |

> 0192 §5 liet de **vorm** van de write bewust open: "routehelper is niet
> fail-closed → aanbeveling trigger-per-brontabel, maar #183b legt de vorm vast
> vóór de handler-sweep, met de niet-atomiciteit als uitgangspunt." Dit is dat
> vastleggen, op de gemeten inventaris.

---

## 1. De inventaris (gemeten, callee getraceerd)

Per handler: de **bestuurlijke** tabelmutatie (het feit), waar de write leeft, en
of de **oude waarde** in de route beschikbaar is.

| # | Handler | Brontabel · op | Transitie | Write leeft in | Oude waarde in route? |
|---|---|---|---|---|---|
| 1 | POST agendapunten | `agendapunten` · INSERT | create | route | n.v.t. (create) |
| 2 | PATCH documents/[id] | `documenten` · UPDATE | `actief` true↔false | route | **ja** (`actief` vooraf geladen) |
| 3 | DELETE inbreng/[id] | `agendapunt_inbreng` · DELETE | delete | route | **nee** (alleen `gebruiker_id`) |
| 4 | POST inbreng | `agendapunt_inbreng` · INSERT | create | route | n.v.t. |
| 5 | POST notulen/…/bevestig | `notulen_segmenten` · UPDATE | `bevestigd` f→t | **RPC** `fn_notulen_segment_bevestig` (invoker) | in RPC (OLD) |
| 6 | DELETE notulen/segmenten/[id] | `notulen_segmenten` · DELETE | delete | **RPC** `fn_notulen_segment_verwijder` (invoker) | in RPC (OLD) |
| 7 | PUT organisatieprofiel | `organisatie_profielen` · UPSERT | create/update | route | **nee** (niet geladen) |
| 8 | POST stemmingen/[id]/intrekken | `stemmingen` · UPDATE | `status` open→ingetrokken | route | **ja** (`status`) |
| 9 | POST stemmingen/[id]/sluiten | `stemmingen` · UPDATE | `status` open→gesloten (+uitslag) | route | **ja** |
| 10 | POST stemmingen/[id]/stemmen | `stem_uitbrengingen` · INSERT/UPDATE | stem uitgebracht/gewijzigd | route | **nee** bij UPDATE |
| 11 | POST stemmingen | `stemmingen` · INSERT | create → `status=open` | route | n.v.t. |
| 12 | POST vergaderingen | `vergaderingen` · INSERT | create | route | n.v.t. |

**Twee feiten die de vorm bepalen, meteen zichtbaar:**
- Notulen (#5/#6) hebben hun mutatie **al in een atomische, security-invoker RPC**
  die bovendien al fail-closed `document_metadata_log` schrijft. De transactiegrens
  bestaat daar dus al.
- Voor **vier** handlers (#3, #7, #10-update, en deels #6) staat de **oude waarde
  niet in de route**. Alleen een trigger (`OLD`) of de RPC heeft hem. Een
  routehelper zou hem niet eens kunnen bouwen zonder extra reads.

---

## 2. Het beslissende feit — over-capture is correctheid, niet ruis

Een trigger vuurt op **elke** write naar de tabel. Gemeten (verkenner):

| Brontabel | Andere schrijvers? | Over-capture |
|---|---|---|
| `stemmingen` | geen | **schoon** |
| `stem_uitbrengingen` | geen | **schoon** |
| `agendapunt_inbreng` | geen | **schoon** |
| `vergaderingen` | alleen UPDATEs elders (niet de INSERT) | schoon op INSERT |
| `agendapunten` | UPDATEs elders + 1 INSERT (procedurestap→agendapunt) | schoon op INSERT (mits gewenst, §6) |
| `organisatie_profielen` | platform-side upsert (`acties.ts`) | laag (beide zijn profielwijziging) |
| `documenten` | **ingest-pipeline massaal** (`ingest-orchestrator`, generiek-pipeline) | **zeer hoog** |
| `document_chunks` / `document_metadata_log` | ingest + vele routes | **zeer hoog** |
| `procedure_bewijs` | procedures/bewijs-routes + migraties | hoog |

**Waarom dit correctheid raakt, niet alleen volume.** Een *naïeve* tabelbrede
trigger op `documenten` vuurt óók tijdens een **service-role** ingest-write. Zonder
sessie én zonder dat de trigger zelf een fonds zet, zou `fn_govevent_fonds` (0192)
**raisen → de ingest-transactie breekt.** Over-capture is dus niet "een vervuilde
keten" maar potentieel "een gebroken machinepad".

**Twee gescheiden remedies** (0192 §2b (iii)), die niet verward mogen worden:
- **Semantiek** — een herindexering is géén bestuurlijk feit; die hoort niet in de
  keten. Sluit uit met een `WHEN` op de **verandering** (`documenten`:
  `OLD.actief IS DISTINCT FROM NEW.actief`). Poort op wát verandert.
- **Fonds-afleidbaarheid** — laat de **brontrigger zelf `fonds_id` zetten** uit zijn
  eigen rij; de drietrapsregel accepteert dat op het service-role-pad. Dan raist
  niets en valt niets stil weg. **Nooit** een poort op wíé schrijft — dat is een gat.

---

## 3. Waarom niet de routehelper (twee onafhankelijke nagels)

1. **Niet fail-closed** (0192 §5, hard feit): PostgREST-mutatie is al gecommit
   vóór de `governance_events`-insert; een `throw` geeft een 500 terwijl de data
   is gewijzigd en de keten leeg blijft — slechter dan fail-open.
2. **Kan de payload niet eens bouwen**: voor #3/#7/#10-update staat de oude waarde
   niet in de route. Een helper zou extra reads moeten doen die een trigger/RPC
   gratis via `OLD` heeft.

---

## 4. De vorm — een hybride, gedicteerd door §2 en §1 (geen uniforme 8-9 triggers)

**A. Schone/afbakenbare trigger-per-brontabel** (atomisch, dekt directe
PostgREST-writes, `OLD` gratis):

Elke A-trigger **zet zelf `fonds_id`** uit zijn eigen rij (bv. agendapunt →
vergadering → fonds); de drietrapsregel in `fn_govevent_fonds` (0192 §2b) accepteert
dat op het service-role-pad. Zo is de trigger robuust voor élke schrijver zonder
poort op de schrijver.

| Trigger op | Dekt | `event_type`(s) via `TG_OP`/status |
|---|---|---|
| `stemmingen` | #8, #9, #11 | INSERT→`stemming_geopend`; open→ingetrokken→`stemming_ingetrokken`; open→gesloten→`stemming_gesloten` |
| `stem_uitbrengingen` | #10 | INSERT→`stem_uitgebracht`; UPDATE→`stem_gewijzigd` |
| `agendapunt_inbreng` | #3, #4 | INSERT→`inbreng_toegevoegd`; DELETE→`inbreng_ingetrokken` |
| `vergaderingen` (AFTER INSERT) | #12 | `vergadering_aangemaakt` |
| `agendapunten` (AFTER INSERT) | #1 (+ procedurestap-creatie) | `agendapunt_toegevoegd` |
| `organisatie_profielen` (INS/UPD) | #7 | `organisatieprofiel_gewijzigd` |

`agendapunten` staat in A, **niet** achter een sessiepoort. Gemeten (§2/§6b): het
wordt óók service-role geïnsert (CI-fixtures), maar de brontrigger leidt fonds af uit
`vergadering_id → vergaderingen.fonds_id` en `fn_govevent_fonds` accepteert dat
zonder sessie. Die inserts produceren dus gewoon een ketengebeurtenis — dekking, geen
stil gat. Beide user-scoped creatiepaden (route #1 én procedurestap) vallen er
vanzelf onder.

**B. Trigger mét `WHEN`-poort op de toestandsverandering** (sluit niet-feit-mutaties
uit — poort op *wát verandert*, niet op wie schrijft):

| Trigger op | Poort | Dekt | `event_type` |
|---|---|---|---|
| `documenten` | `WHEN (OLD.actief IS DISTINCT FROM NEW.actief)` | #2 | `document_gedeactiveerd` / `document_gereactiveerd` |

`documenten` draagt massale niet-bestuurlijke ingest-churn (status/chunks/
`geindexeerd`, incl. de `geindexeerd`-flip van #5). Alleen de `actief`-flip is het
bestuurlijke feit; de `WHEN` sluit de rest semantisch uit — niet omdat een pipeline
service-role is, maar omdat een herindexering geen bestuurlijk feit is.

**C. Write in de bestaande RPC** (atomische grens bestaat al; tabeltrigger zou
`notulen_segmenten` over-capturen door `segmenteer` + `ontbevestig`-PATCH):

| In RPC | Dekt | `event_type` |
|---|---|---|
| `fn_notulen_segment_bevestig` | #5 | `notulensegment_bevestigd` |
| `fn_notulen_segment_verwijder` | #6 | `notulensegment_verwijderd` |

**Telling:** ~7 triggers (waarvan **1 gepoort**: `documenten` op de `actief`-flip) +
2 RPC-interne inserts — niet 12 routewijzigingen, en niet 8-9 blinde tabeltriggers.
Eén `stemmingen`-trigger dekt drie handlers; alleen `documenten` heeft een semantische
poort nodig. Fonds-afleidbaarheid is generiek opgelost (brontrigger zet fonds), niet
per tabel.

---

## 5. Interacties om niet te vergeten

- **`sluiten` (#9):** de `stemmingen`-trigger levert het `stemming_gesloten`-event
  (de ketengebeurtenis die 0191 §7 bovenop `procedure_log` eiste). De bestaande
  **voorwaardelijke, ongecontroleerde** `procedure_bewijs`-insert (§4b van het
  originele #183b-ticket) blijft een **aparte reparatie** — of registreren bij VEN-2 §5.
- **Elke trigger schrijft via de 0192-keten:** op het user-pad vult
  `fn_govevent_fonds` het fonds uit `auth.uid()`; de `WHEN`-poort en de schone
  tabellen zorgen dat de trigger nooit op een `auth.uid()`-loos pad vuurt (zie §2).
- **`event_type`-register + drift-/collisiepoort** (0192 §5, #183b §4a) leeft waar
  de triggers/RPCs de `event_type` zetten — één bevroren lijst, sanity-gepind.

---

## 6. De twee scopingvragen — BEANTWOORD (2026-08-27)

**(a) Notulen #5/#6 → governance_events-event bovenop. De twaalf blijven twaalf.**
Doorslag: `document_metadata_log` is document-/RAG-gescopet; een notulensegment
bevestigen is besluit-provenance, geen bestandsmetadata — een ander *soort* feit
dan de handeling. Anders dan de 3 `procedure_bewijs`-handlers (waar `procedure_log`
hetzelfde soort feit is). De keten wordt geschreven **in de bestaande atomische
RPC** (`fn_notulen_segment_bevestig`/`_verwijder`), één insert erbij. De algemene
**toetsregel** hierachter is vastgelegd in 0191 §7 (amendement): *een domeinspoor
volstaat alleen als het hetzelfde soort feit vastlegt als de handeling* — de
volgende classificatie is daarmee een toepassing, geen besluit. 0191-telling
**niet** heropend.

**(b) Ja gewenst — gemeten niet schoon, maar géén sessiepoort.** De procedurestap→
agendapunt-insert is óók een agendapuntfeit en hoort in de keten. De meting (§2,
dezelfde tracering als `documenten`) toont dat `agendapunten` óók service-role wordt
geïnsert (CI-fixtures, geen `auth.uid()`). Een sessiepoort zou dat oplossen maar is
een **poort op wie schrijft** — een stil gat voor de volgende service-role-schrijver
(import, backfill). Beter, en generiek: de **brontrigger zet `fonds_id`** uit
`vergaderingen.fonds_id`, en `fn_govevent_fonds` accepteert dat zonder sessie
(drietrapsregel, 0192 §2b). Zo produceren óók de service-role-inserts een
ketengebeurtenis — dekking i.p.v. uitzondering. Breekt een fixture op een rijtelling,
dan is dat een testaanpassing. Geen poort, geen gat. `agendapunten` staat daarmee in
groep **A**, niet B.

---

## 6b. Payload, actor en uitvoervolgorde (besloten 2026-08-27)

**Payload = gecureerde subset per `event_type`, GEEN `to_jsonb(new)`.** `governance_events`
is permanent/onveranderlijk (0191 §1-dataminimalisatie); een volledige rijdump trekt
elke ooit-toegevoegde kolom voorgoed in de keten én verandert stilzwijgend van vorm
bij schemadrift (de hash dekt dan een andere structuur zonder besluit). De
payloadvorm is onderdeel van waarvoor je tekent. **Declaratie:** de veldselectie per
event komt **naast de `event_type` in hetzelfde register** met drift-/collisiepoort —
een kolom toevoegen wordt daarmee een zichtbare, gepoorte handeling, geen stille
ketenwijziging. `oude_waarde` bij UPDATE = **de gewijzigde velden + de identiteit**,
niet de hele vorige rij. Bij `stem_uitbrengingen` is de curatie **inhoudelijk een
per-tabel-besluit**: wie-wat-stemde permanent vastleggen is juist voor
dissentregistratie en fout voor een besloten stemming — geen `to_jsonb`-bijproduct.

**`actor_naam` behouden** als momentopname (niet als live join naar de muteerbare
`profielen` — die zou "iemand" zeggen zodra een profiel verandert), consistent met de
20 bestaande writes. Permanente naamopslag = bewuste PII-opname → **DPIA-delta-2**
in 0191 §8. R-22 (hash dekt actor niet) is een aparte kwestie; `actor_naam` weglaten
repareert dat niet.

**Uitvoervolgorde — eerst één keer echt draaien, dan pas herhalen.** Het
referentiepatroon (fundament `2026_08_27_govevent_tenantketen.sql` +
`2026_08_27_govevent_stemmingen.sql`) is **pas een referentie als het één keer heeft
gedraaid**: op Preview, mét de forward→rollback→forward-drill op een productiegelijke
DB, en een waargenomen `governance_events`-rij die **zichtbaar is voor de tenant**.
Pas daarna het register + de resterende zes triggers/RPC-inserts in dezelfde vorm.
Andersom vermenigvuldigt een systematische fout zich over zeven triggers — en die is
hier, anders dan bij de codemod, niet byte-identiek te betrappen.

## 7. Definition of done van dit vormbesluit

- [x] Scopingvragen §6 beantwoord; payload/actor/volgorde §6b besloten.
- [ ] **Preview-run** van fundament + `stemmingen` (forward→rollback→forward + tenant-zichtbare rij) — vóór replicatie.
- [ ] `event_type`-register + **payload-subset per event** vastgesteld + drift-/collisiepoort (ná de preview-run).
- [ ] Resterende 6 triggers + 2 RPC-inserts in de gevalideerde vorm; `stem_uitbrengingen`-payload als eigen per-tabel-besluit.
- [ ] Vorm per handler bevestigd (A-trigger / B-WHEN-trigger / C-RPC).
- [ ] Dán pas de handler-sweep: triggers + RPC-inserts bouwen, met de cross-tenant
      §15-verificatie uit 0192 §7 en de tests hieronder.
      - **`documenten` (semantische `WHEN`) — beide richtingen:** een ingest-/service-role-
        write die `actief` níét wijzigt maakt **géén** `governance_events`-rij (negatief);
        een write die `actief` wél wijzigt maakt **wél** een rij (positief, de spiegel).
      - **`agendapunten` (groep A, brontrigger zet fonds) — dekking + robuustheid:** zowel
        een user-scoped als een **service-role** insert maakt **wél** een rij en **breekt
        niet** (bewijst dat de drietrapsregel de service-role-fonds accepteert i.p.v. raist).
      Een test die alleen afwezigheid bewijst, slaagt ook op een trigger die nooit vuurt
      (de `g2-evidence.sh`/`fondsleden`-val: aanwezig, aangesloten, nooit gevuurd) — dus
      overal waar een `WHEN`/afbakening zit, hoort de positieve spiegel erbij.
