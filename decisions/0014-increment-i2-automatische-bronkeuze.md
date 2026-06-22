# 0014 — Increment I-2: automatische bronkeuze (Design A + verduidelijking bij twijfel)

- **Status:** Geaccepteerd
- **Datum:** 2026-06-22
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder, compliance-sign-off), Claude Code (uitvoering)

## Context

In Increment I-1 bleef de zichtbare **bron-as** (Onze documenten / Slim combineren /
Algemene vraag) bewust ongemoeid; het vervangen ervan door automatisch brongebruik
was vooruitgeschoven naar I-2 (FO v1.3 §11a). Het principe is *de gebruiker kiest het
doel van de vraag, niet de technische werking*: een bestuurder hoort niet vooraf een
bron-modus te kiezen. Tegelijk geldt de niet-onderhandelbare guardrail **geen
schijnzekerheid** — een fondsvraag mag nooit stil als "algemene vraag" worden
afgedaan, want dan lijkt een algemeen antwoord een fondsspecifiek antwoord.

Randvoorwaarden: gedragsneutraliteit t.o.v. Increment G (retrieval/filtering/weging/
RPC's ongemoeid), geen datamodelwijziging (`governance_log.retrieval_meta` is jsonb),
en volledige auditeerbaarheid (B10) van de — nu verborgen — bronkeuze.

## Besluit

De zichtbare bron-as vervalt. Het systeem bepaalt zélf de bron-intentie (`fonds` /
`algemeen` / `gecombineerd`) met een **pure heuristiek** ([`lib/vraagtype.ts` →
`bepaalBronIntent`](../lib/vraagtype.ts)); alleen de expliciete restrictie **"Alleen
fondsdocumenten"** blijft over (onder "Aanpassen"). De retrieval volgt **Design A
"combineren-vloer"**: tenzij beperkt tot fondsdocumenten halen we altijd op — nooit
volledig overslaan. Bij een **onzekere** intentie (geen anker/signaal) **vraagt de
assistent eerst terug** ("Wilt u dit weten voor uw fonds specifiek, of in algemene
zin?") met twee chips, i.p.v. te gokken. De intentie krijgt **géén zichtbare badge**
in de chat; ze leeft in het paneel "Onderbouwing en bronnen" en in het auditspoor.

De heuristiek wordt geijkt tegen een **geaccordeerde meetset** van 40 contrastieve
vragen ([`lib/bronkeuze-meetset.ts`](../lib/bronkeuze-meetset.ts)) en bewaakt door een
runner met **door gebruiker/compliance vastgestelde, bewust ASYMMETRISCHE drempels**
([`lib/bronkeuze-classificatie.sanity.ts`](../lib/bronkeuze-classificatie.sanity.ts),
sign-off 2026-06-22): fondsvraag → stil 'algemeen' = **0** (nul-tolerantie), foute
zekere auto-keuze ≤ 5%, terugvraag-frequentie ≤ 20%, niet-stil-verkeerd ≥ 90%.

## Overwogen alternatieven

- **Bron-as zichtbaar laten (status quo I-1)** — verworpen: druist in tegen §11a en
  legt technische werking bij de bestuurder.
- **Model-call voor de classificatie** — verworpen: niet reproduceerbaar/
  programmatisch toetsbaar, kost latency en geld, en is niet hard te gaten. De
  heuristiek is deterministisch en CI-gateable.
- **Bij twijfel gokken (stil een modus kiezen)** — verworpen: schendt "geen
  schijnzekerheid". Daarom de verduidelijkingsvraag bij onzekerheid.
- **Onzekere fallback = 'algemeen'** — verworpen: dat is juist de gevaarlijke fout.
  De fallback leunt bewust **fondsgericht** (intent `fonds`, vertrouwen `onzeker`).
- **Symmetrische drempels** — verworpen: de gevaarlijke fout (schijnzekerheid)
  verdient nul-tolerantie, de ongevaarlijke (iets te vaak doorvragen) niet.
- **Intent óók de retrieval-modus laten sturen** — verworpen: dat zou Increment G's
  gedrag wijzigen. De intent stuurt alleen promptframing + meldingen; de auto-
  retrieval-modus blijft de combineren-vloer (alleen de fondsrestrictie wijzigt die).
- **Zichtbare intent-badge in de chat** — verworpen (rustige weergave §11c): de
  intentie hoort in het controlevlak, niet als ruis boven elk antwoord.

## Gevolgen

- **UX:** geen bron-modusknoppen meer; één "Brongebruik"-regel + "Aanpassen → Alleen
  fondsdocumenten". Bij twijfel verschijnen twee chips; een klik herstuurt dezelfde
  vraag met bevestigde intentie (combineren-vloer voor "Voor mijn fonds", géén harde
  scope) zonder een tweede gebruikersbubbel.
- **RLS/tenant-isolatie:** ongewijzigd — retrieval, scope-validatie en RPC's intact.
- **Audit/reproduceerbaarheid:** `retrieval_meta` bevat nu `bron_intent`,
  `bron_vertrouwen`, `bron_modus_auto` en `alleen_fondsdocumenten`; de
  verduidelijkingstak doet géén modelcall en logt géén antwoordregel (er is geen
  antwoord). De classificatie is volledig reproduceerbaar uit de vraag.
- **Datamodel/migraties:** geen — `retrieval_meta` is jsonb (append-only intact).
- **Bewust geaccepteerde schuld:** de drempels en de meetset zijn een momentopname;
  de runner faalt hard bij regressie, maar uitbreiding van de meetset blijft mensenwerk.

## Referenties

- [`lib/vraagtype.ts`](../lib/vraagtype.ts) — `bepaalBronIntent`, `moetVerduidelijken`,
  `bepaalAutoBronModus`, `VERDUIDELIJKINGSVRAAG`, `VERDUIDELIJKING_OPTIES`.
- [`lib/bronkeuze-meetset.ts`](../lib/bronkeuze-meetset.ts) — 40 gelabelde vragen.
- [`lib/bronkeuze-classificatie.sanity.ts`](../lib/bronkeuze-classificatie.sanity.ts) — drempel-gating.
- [`lib/vraagtype.sanity.ts`](../lib/vraagtype.sanity.ts) — helpers + gedragsneutraliteit.
- [`app/api/chat/route.ts`](../app/api/chat/route.ts) — auto-bronmodus, verduidelijkingstak, meta/auditmeta.
- [`app/(dashboard)/ai/page.tsx`](../app/(dashboard)/ai/page.tsx) + [`OnderbouwingPaneel.tsx`](../app/(dashboard)/ai/_components/OnderbouwingPaneel.tsx) — UI.
- FO v1.3 §11a/§11c/§11d; besluit `0013` (Increment G, gedragsbasis).
