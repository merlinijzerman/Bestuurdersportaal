# 0071 — Agendavoorbereiding: SSE-streaming en bronbasis-melding

- **Status:** Geaccepteerd (experimenteerfase)
- **Datum:** 2026-07-15
- **Betrokkenen:** Merlin (akkoord), Ontwikkeling

## Context

De rijke agendavoorbereiding (`app/api/agendapunten/[id]/voorbereiding`) leverde het antwoord in één keer (`messages.create`) i.p.v. gestreamd; met het tragere Opus (besluit 0067) voelt dat merkbaar lang. Daarnaast toonde de voorbereiding-opener géén bronbasis-melding wanneer er geen fondsstukken gekoppeld zijn: dan is er geen "Onderbouwing en bronnen"-blok én zette de voorbereiding-tak nooit `inlineMeldingen`. Gevolg: de bestuurder zag in dat geval geen enkel signaal over waar het antwoord op steunt — een transparantiegat t.o.v. de chat en t.o.v. de EU AI Act-lijn.

## Besluit

De route is omgebouwd naar **SSE-streaming** (`meta → delta → done`, dezelfde event-vorm als `/api/chat`) zodat het antwoord token voor token opbouwt; `AgendapuntChat` consumeert de stream incrementeel (dezelfde consumer-vorm als de chat). Er is een **bronbasis-melding** toegevoegd: zonder gekoppelde fondsstukken verschijnt een expliciete melding ("steunt op de toelichting van het agendapunt en algemene kennis; verifieer bij formele besluitvorming"). Zijn er wél bronnen, dan draagt het bestaande onderbouwingsblok de transparantie al (rustige weergave, geen extra melding).

## Overwogen alternatieven

- **Non-streaming laten** — afgewezen: trage waarneming bij Opus.
- **Alleen de bronmelding, zonder streaming** — lost de gepercipieerde traagheid niet op.

## Gevolgen

- Betere waargenomen snelheid; de **totale** generatietijd is ongewijzigd — echte tijdwinst vergt model-tiering (besluit 0067).
- Bronbasis in álle gevallen zichtbaar (uitlegbaarheid). Het append-only auditspoor (`governance_events`/`governance_log`) is ongewijzigd.
- `tsc --noEmit` groen. RLS/datamodel: geen wijziging.

## Referenties

- `app/api/agendapunten/[id]/voorbereiding/route.ts`, `app/(dashboard)/vergaderingen/_components/AgendapuntChat.tsx`.
- Samenhangend met besluit 0067 (model/streaming-compensatie) en 0069 (bronbasis via UI-laag).
