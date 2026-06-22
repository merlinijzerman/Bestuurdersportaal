# 0016 — Increment I-2: twee aanscherpingen na subagent-review (schijnzekerheid-melding + override-audit)

- **Status:** Geaccepteerd
- **Datum:** 2026-06-22
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder, compliance-akkoord), Claude Code (uitvoering)

## Context

De I-2-reviewronde (ai-governance / code / audit-evidence / ontwerp-sync, 2026-06-22)
gaf geen blockers, maar legde twee punten bloot die vóór deploy de moeite waard waren.
Beide raken besluit [`0014`](./0014-increment-i2-automatische-bronkeuze.md) en de
niet-onderhandelbare guardrail **geen schijnzekerheid**.

1. **Governance:** de nul-tolerantie "fondsvraag → stil 'algemeen' = 0" is in
   [`lib/bronkeuze-classificatie.sanity.ts`](../lib/bronkeuze-classificatie.sanity.ts)
   geborgd tegen de meetset, maar de garantie leunt op de woordenlijst-dekking van
   `bepaalBronIntent`, niet op een invariant. Een échte fondsvraag zónder anker
   (`onze/wij/het bestuur/dit fonds`) die wél een generiek patroon raakt
   (bv. *"Voldoet het beleggingsbeleid aan de wet?"*, *"Wat houdt het transitieplan in?"*)
   wordt `algemeen/zeker`. In het smalle venster *fout-geclassificeerd én 0 fondstreffers*
   onderdrukte [`bepaalInlineMeldingen`](../lib/vraagtype.ts) toen óók nog de
   "gebaseerd op algemene kennis"-melding — precies de schijnzekerheid die de
   guardrail wil voorkomen.

2. **Audit (H1):** een via verduidelijkingschip BEVESTIGDE intentie werd gelogd als
   `bron_intent='fonds'/'algemeen'`, `bron_vertrouwen='zeker'` — identiek aan een
   heuristisch-zekere keuze. Uit `governance_log` alleen was niet herleidbaar dát de
   gebruiker een eerdere twijfel bevestigde.

## Besluit

1. **`bepaalInlineMeldingen` is voortaan intent-onafhankelijk.** Bij `combineren` +
   0 fondstreffers verschijnt **altijd** de melding `geen_fondstreffer` ("Geen
   relevante fondsdocumenten gevonden. Dit antwoord is gebaseerd op algemene kennis."),
   óók bij auto-intent `algemeen`. De parameter `bronIntent` is uit de functie
   verwijderd: meldingen hangen aan wat er **daadwerkelijk** is opgehaald, niet aan de
   (mogelijk foute) intent-gok. Voor een echt-algemene vraag is de melding gewoon
   correct en transparant; "rustige weergave" (FO §11c) weegt hier niet op tegen de
   schijnzekerheid-guardrail.
2. **`retrieval_meta.bron_intent_override` (boolean) toegevoegd** aan het auditspoor
   én het `meta`-event. `true` = de intentie is door de gebruiker bevestigd via een
   verduidelijkingschip; `false` = heuristisch bepaald. Het paneel "Onderbouwing en
   bronnen" toont "— door u bevestigd na verduidelijking" i.p.v. "— automatisch gekozen".

## Overwogen alternatieven

- **Suppressie behouden, alleen meetset uitbreiden** — verworpen: de meetset blijft
  een momentopname; alleen de altijd-tonen-regel maakt de guardrail een invariant
  i.p.v. een steekproef. (Meetset-uitbreiding blijft een nuttige, losse follow-up.)
- **Een zachtere/aparte meldingtekst voor de echt-algemene vraag** — verworpen:
  onnodige complexiteit; de bestaande tekst is voor beide gevallen accuraat.
- **Twijfel-promotie bij dubbele match (generiek + zwak fondsthema)** in
  `bepaalBronIntent` — overwogen, niet nu gedaan: raakt de classificatiekern en de
  geaccordeerde drempels; de melding-fix dekt het schaderisico af zonder dat risico.
- **Override alléén in de log, niet in de UI** — verworpen: het paneel toonde "na
  verduidelijking" eerder aan `bron_vertrouwen='onzeker'`, wat een beantwoorde turn
  nooit bereikt (onzeker → terugvraag zónder antwoord). De override is het juiste,
  zichtbare signaal in het controlevlak.

## Gevolgen

- **UX:** een echt-algemene vraag toont nu een korte herkomst-melding; dat is bewust
  (transparantie boven rust bij 0 fondstreffers). Bevestigde intenties zijn in het
  paneel als zodanig herkenbaar.
- **Audit/reproduceerbaarheid:** `bron_intent_override` maakt de chip-bevestiging
  herleidbaar; de classificatie blijft volledig reproduceerbaar uit de vraag.
- **Datamodel/migraties:** geen — `retrieval_meta` is jsonb (append-only intact).
- **Tests:** [`lib/vraagtype.sanity.ts`](../lib/vraagtype.sanity.ts) vervangt de drie
  intent-suppressie-tests door een guardrail-test (combineren + 0 treffers → áltijd
  `geen_fondstreffer`) + een intent-onafhankelijkheidstest; `tsc` groen; meetset-runner
  ongewijzigd binnen drempels.
- **Bewust niet gewijzigd:** retrieval/filtering/weging/RPC's (Increment G) en de
  classificatiekern/drempels van besluit 0014.

## Referenties

- [`lib/vraagtype.ts`](../lib/vraagtype.ts) — `bepaalInlineMeldingen` (intent-onafhankelijk).
- [`lib/rag.ts`](../lib/rag.ts) — `RetrievalMeta.bron_intent_override`.
- [`app/api/chat/route.ts`](../app/api/chat/route.ts) — auditveld + `meta`-event.
- [`app/(dashboard)/ai/_components/OnderbouwingPaneel.tsx`](../app/(dashboard)/ai/_components/OnderbouwingPaneel.tsx) — bevestigd-na-verduidelijking-tekst.
- Besluit [`0014`](./0014-increment-i2-automatische-bronkeuze.md) (I-2 grondslag); FO v1.3 §11a/§11c/§11d.
