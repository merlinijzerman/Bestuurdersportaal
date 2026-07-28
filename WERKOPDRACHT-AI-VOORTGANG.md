## Werkopdracht: AI-assistent — zichtbare voortgang tijdens het wachten

**Doel & context** — Tussen het versturen van een vraag en de eerste letter van het antwoord zit een merkbare stilte. Die stilte valt precies samen met het duurste deel van de verwerking: in `app/api/chat/route.ts` draaien de history-aware reformulatie (een volledige LLM-call op het sterke model), de hybride RAG-zoek, de reranker en de promptopbouw **vóórdat** de `ReadableStream` wordt geopend (rond regel 949). De browser krijgt in die periode niets; de drie stuiterende puntjes zijn een client-side animatie zonder enige relatie tot wat de server doet.

Deze tranche opent de stream eerder en laat de bestaande stappen onderweg melden wat ze doen. Dat levert twee dingen op: het wachten wordt draaglijk, en de bestuurder ziet **vóór** het antwoord al waarop het straks steunt — dezelfde transparantielijn als de bronbasis-melding uit besluit `0071`.

**Goedgekeurd ontwerp/plan** — Visuele referentie en de exacte meldingsteksten: `03 Functioneel ontwerp/Designrichtingen portaal/voortgangsmelding.html` (drie scenario's: volledige vraag, zonder web/reranker, geen fondstreffer). De tabel "Waar de tekst vandaan komt" in dat bestand is leidend voor de koppeling servermoment → melding.

> **Volgordevoorwaarde.** Deze opdracht start pas nadat `WERKOPDRACHT-AI-STARTPUNT-P1` is gemerged. Die opdracht verplaatst de client-component naar `app/(dashboard)/ai/_components/AssistentClient.tsx` (op 28-07-2026 al aangemaakt). Verifieer vóór aanvang de werkelijke bestandsindeling; ga niet uit van `app/(dashboard)/ai/page.tsx` als aangrijpingspunt voor de client-kant.

---

### Uitgangspunt: de helft ligt er al

- `/api/chat` stuurt **nu al** een event `{ type: "progress", fase: "analyse", batch, totaal }` (rond regel 1024), gebruikt voor de map-reduce-batches bij brede documentanalyse.
- De client consumeert dat al via `analyseVoortgang` en rendert "Document wordt geanalyseerd… (deel X van Y)".
- De voorbereidingsroute is per besluit `0071` al omgebouwd naar SSE met dezelfde `meta → delta → done`-vorm. Dat is het precedent voor de ombouw hieronder.

Het eventtype, de consumer en het renderpatroon bestaan dus. Ze moeten **eerder** en **breder** worden ingezet.

---

### Scope

**Wel**

1. **Stream eerder openen in `app/api/chat/route.ts`.** Het retrieval- en promptopbouwblok verhuist naar binnen de `ReadableStream`, zodat er tijdens die stappen events verstuurd kunnen worden. Auth, rate-limiting en tenantcontrole blijven **vóór** de stream (zie guardrails).
2. **Faseveld uitbreiden.** Het bestaande `progress`-event krijgt naast `analyse` de fasen `reformulatie`, `retrieval`, `rerank`, `web` en `generatie`, met per fase een optionele uitkomst (aantallen). Bestaande consumers van `fase: "analyse"` blijven werken.
3. **Client: voortgangsregel.** `analyseVoortgang` wordt gegeneraliseerd naar één voortgangsstaat die (a) de actieve fase als lopende regel toont en (b) afgeronde fasen kort eronder laat staan mét hun uitkomst ("42 fondsdocumenten doorzocht", "18 passages gevonden, 6 relevant bevonden"). Zodra het eerste `delta`-event binnenkomt, verdwijnt de voortgangsregel en begint het antwoord.
4. **Overgeslagen fasen worden niet getoond.** Geen reformulatie bij een eerste vraag, geen `rerank` als de reranker voor dit fonds uit staat, geen `web` als web-retrieval niet actief is, geen `retrieval` in agendapunt-modus zonder doorzoekbare stukken.

**Niet**

- **Geen echte versnelling.** Geen model-tiering, geen wijziging aan het generatiemodel (`0067`), geen wijziging aan de reranker (`0073`) of aan de retrieval-logica zelf. Deze tranche verandert uitsluitend wat de gebruiker ziet.
- **Geen promptwijzigingen.** De AI-toon-systeemprompt blijft onaangeroerd (`CLAUDE.md`).
- **Geen kunstmatige voortgang.** Geen timer-gestuurde tekst, geen geschatte percentages, geen minimale weergaveduur om een stap "zichtbaar te maken". Elke melding volgt een werkelijk bereikt servermoment.
- **Geen nieuwe LLM-call** om voortgang te bepalen of te formuleren. De teksten zijn statisch per fase; alleen de aantallen komen uit de verwerking.
- **Niet de voorbereidingsroute.** `app/api/agendapunten/[id]/voorbereiding/route.ts` heeft hetzelfde patroon nodig, maar volgt als aparte tranche. Ontwerp de eventvorm wél zo dat die route hem ongewijzigd kan overnemen.
- Geen wijziging aan RLS, datamodel, migraties of de inhoud van het auditspoor.

---

### Architectuur- en risicopunten die in Plan-modus beslist moeten worden

**1. Wat blijft vóór de stream staan.** Auth, rate-limiting (`core/lib/rate-limit.ts`, besluit `0005`) en de tenantcontrole moeten vóór het openen van de stream blijven. Zodra de stream open is, is de HTTP-status 200 verzonden; een geweigerd verzoek zou dan als "geslaagd" beginnen. Leg in het plan expliciet vast welke controles vóór en welke ná het openpunt komen.

**2. Het foutcontract verandert.** Fouten die nu een HTTP-foutstatus opleveren (bijvoorbeeld tijdens retrieval) worden na deze wijziging een `{ type: "error" }`-event binnen een 200-respons. Dat raakt het API-contract van `/api/chat`. Beschrijf in het plan welke fouten verschuiven, hoe de client ze toont, en of er consumers zijn die op de statuscode leunen.

**3. Het bestaande vroege-uitgangspad.** Er is al een tweede, synchrone `ReadableStream` (rond regel 536) voor het verduidelijkingspad. Dat pad moet ongewijzigd blijven werken. Benoem hoe de twee paden zich na de ombouw tot elkaar verhouden.

**4. Wat de reformulatie kost.** De comment bij regel 61 stelt dat de history-aware reformulatie *"bewust op het sterke model"* draait, vóór de retrieval. Dat is vermoedelijk het grootste enkele blok stiltetijd. Buiten scope hier, maar rapporteer in de terugkoppeling hoeveel tijd die stap in de praktijk kost — dat onderbouwt of model-tiering (`0067`) de moeite waard is.

---

**Relevante bestanden / modules** — `app/api/chat/route.ts` (stream-openpunt, `progress`-events per fase), `app/(dashboard)/ai/_components/AssistentClient.tsx` (voortgangsconsument; verifieer de actuele bestandsnaam na plateau 1), `core/lib/rate-limit.ts` (alleen verifiëren dat de gate vóór de stream blijft), `app/api/agendapunten/[id]/voorbereiding/route.ts` (alleen lezen: referentie voor de SSE-vorm uit besluit `0071`). Claude Code verifieert tegen de werkelijke code.

**Guardrails (zie `CLAUDE.md`)** — bevestig naleving van: RLS per `fonds_id` (alleen anon-key), append-only audit, human-in-the-loop, migratie-eerst-dan-deploy, snapshot-integriteit, geen schijnzekerheid. Specifiek voor deze opdracht:

- **Geen schijnzekerheid, letterlijk toegepast.** Dit is de kern van deze opdracht. Een voortgangsmelding die suggereert dat er iets gebeurt wat niet gebeurt, is precies de schijnzekerheid die het project uitsluit. Elke fase wordt gestuurd door een bereikt servermoment; een overgeslagen stap wordt weggelaten, niet grijs getoond.
- **Geen inhoud in de voortgang.** De events bevatten uitsluitend fasenamen en aantallen — geen documenttitels, geen passages, geen deelnemersgegevens. De bronvermelding blijft waar hij hoort: in `meta` en het onderbouwingspaneel, ná de bronselectie.
- **Voortgang is geen auditgebeurtenis.** De `progress`-events zijn vluchtige UI-state en worden **niet** naar `governance_log` of `governance_events` geschreven. Het bestaande auditspoor (inclusief `retrieval_meta`) blijft ongewijzigd; controleer dat de ombouw geen logregel verplaatst of dupliceert.
- **`npm run lint:colors` blijft groen** — de voortgangsregel gebruikt uitsluitend bestaande tokens (`text-muted`, `border-line`, `text-ok-ink`).

**In te zetten subagents (zie `SUBAGENTS-ONTWERP.md` §4 trigger-matrix)** — `code-reviewer` (verplicht); `ai-governance-reviewer` (de opdracht raakt het AI-antwoordpad en de uitlegbaarheid richting de gebruiker, ook al verandert de output niet); `audit-evidence-reviewer` (vaststellen dat het auditspoor door de herstructurering ongewijzigd blijft); `ontwerp-sync-reviewer` vóór merge. `supabase-rls-reviewer` niet nodig: geen nieuwe queries, geen datamodelwijziging — stel dat expliciet vast.

**Werkmodus** — begin in **Plan-modus**: lever eerst een implementatieplan met de vier architectuurpunten hierboven, de bestandenlijst, RLS-impact (verwachting: geen), migratie-impact (verwachting: geen), testaanpak en risico's — waaronder expliciet hoe de foutpaden en het verduidelijkingspad na de ombouw worden getest. **Wijzig pas na expliciet akkoord.**

---

### Acceptatiecriteria

1. **Geen stille periode meer.** Binnen ~1 seconde na het versturen van een vraag toont de assistent een inhoudelijke melding over wat er gebeurt. De drie stuiterende puntjes als enige feedback zijn verdwenen.
2. **Melding volgt de werkelijkheid.** Elke getoonde fase correspondeert aantoonbaar met een bereikt punt in de serververwerking. Aantoonbaar te maken door een vraag te stellen met de reranker uit en web-retrieval uit: dan verschijnen die twee fasen niet.
3. **Afgeronde stappen tonen hun uitkomst.** Na de retrieval staat er een concreet aantal doorzochte documenten en gevonden passages. Bij nul relevante treffers is dat expliciet zichtbaar vóór het antwoord begint.
4. **Overgang is schoon.** Zodra het eerste `delta`-event binnenkomt, verdwijnt de voortgangsregel en verschijnt het antwoord. Geen dubbele weergave, geen sprong in de scrollpositie.
5. **Bestaande functionaliteit intact.** Modi, bronselectie, @-mentions, agendapunt-scope, verduidelijkingsvragen, het onderbouwingspaneel, de vervolgvragen en de brede-documentanalyse (`fase: "analyse"`) werken ongewijzigd.
6. **Auth en rate-limiting ongewijzigd.** Een verzoek dat op rate-limiting of autorisatie stukloopt, krijgt nog steeds de juiste HTTP-status en géén 200-respons met een halve stream. Aantoonbaar met een test die de rate-limit overschrijdt.
7. **Foutpaden werken.** Een fout tijdens retrieval bereikt de gebruiker als begrijpelijke melding in de chat, niet als een afgebroken stream of een blijvende spinner.
8. **Auditspoor ongewijzigd.** `governance_log` (inclusief `retrieval_meta`) en `governance_events` bevatten na een vraag exact dezelfde records als vóór deze wijziging. Geen `progress`-event belandt in het auditspoor.
9. **Verificatie groen.** `./node_modules/.bin/tsc --noEmit --skipLibCheck`, `npm run lint:colors`, `npm run lint:boundaries`, `npm run sanity` en `bash scripts/cross-tenant-ci.sh` zijn groen.

---

### Besluitpunten voor `decisions/`

Verifieer het eerstvolgende vrije nummer (laatste bestaande entry is `0083`; let op dat `0082` in de reeks ontbreekt en dat de startpunt-opdracht mogelijk al een nummer heeft gebruikt).

1. **Fouten tijdens retrieval verschuiven van HTTP-status naar stream-event.** Noodzakelijk gevolg van het eerder openen van de stream. Leg vast welke fouten het betreft, waarom de winst (zichtbare voortgang) opweegt tegen het minder expliciete foutcontract, en hoe de client het verschil opvangt.
2. **Voortgang wordt bewust niet gelogd.** De `progress`-events zijn vluchtige UI-state. Leg vast dat ze geen onderdeel zijn van het auditspoor, zodat later niemand aanneemt dat de getoonde stappen reproduceerbaar zijn vastgelegd.

Neem in beide gevallen ook de negatieve gevolgen op, conform `decisions/TEMPLATE.md` §Gevolgen.

---

**Definition of Done (zie `CLAUDE.md`)** — functionaliteit volgens bovenstaande acceptatiecriteria; RLS-impact vastgesteld (verwachting: geen); audit-impact aantoonbaar nul; tests toegevoegd of gemotiveerd niet — voor de fase-afleiding (welke fasen worden getoond bij welke vlaggen) is een pure `core/lib/*.sanity.ts` het aangewezen patroon; `tsc --noEmit --skipLibCheck` groen; `lint:colors`, `lint:boundaries` en `sanity` groen; `bash scripts/cross-tenant-ci.sh` groen; ontwerpdocumentatie bijgewerkt (de eventvorm van `/api/chat` documenteren waar die nu beschreven staat) en de ontwerp-sync-check groen; `HANDOVER.md` release-historie bijgewerkt; decision-entry aangemaakt voor de twee besluitpunten hierboven.

**Documentatiehaak** — dit is een **kleine release**: gedragsverbetering aan een bestaande route, geen architectuur-, data-, security- of tenant-impact. `HANDOVER.md` + de decision-entry volstaan; de `00–09`-set en de as-built Word-doc blijven ongemoeid en de marker in `00 Overzicht en status/doc-actualisatie-log.md` wordt **niet** bijgewerkt. Blijkt in Plan-modus dat het gewijzigde foutcontract meer consumers raakt dan alleen de assistent, leg die weging dan opnieuw voor.

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md` (samenvatting, aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's). Neem daarin op: (a) welke controles vóór en welke ná het stream-openpunt staan, (b) een gemeten verdeling van de wachttijd over de fasen — met name hoeveel tijd de reformulatie op het sterke model kost, als onderbouwing voor een eventuele model-tiering-tranche (`0067`), en (c) het bewijs dat `governance_log` en `governance_events` na een vraag identiek zijn aan vóór de wijziging.
