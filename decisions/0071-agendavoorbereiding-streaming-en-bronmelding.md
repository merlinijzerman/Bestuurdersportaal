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

## Vervolg (2026-07-15) — sticky-bottom scroll & afkap-signaal

Na livegang van de streaming bleek de weergave bij elke token naar de onderkant te springen, waardoor de lezer niet rustig kon teruglezen. Opgelost met een **sticky-bottom**-patroon in `AgendapuntChat.tsx`: tijdens het streamen scrollt de weergave alleen automatisch mee als de gebruiker al (binnen ~120px van) de onderkant staat; scrollt hij omhoog, dan stopt het meescrollen tot hij weer onderaan komt. Een vers gestart antwoord volgt vanaf de start. Daarnaast toonde een echt afgekapt antwoord (max_tokens) niets zichtbaars; de voorbereiding-route stuurt nu bij `stop_reason === "max_tokens"` het `AFGEKAPT_MELDING`-signaal mee in het `done`-event (zie ook 0067).

**Consistentie met de assistent — klikbare vervolgvragen.** In de assistent (`/ai`) worden de inhoudelijke vervolgvragen als **klikbare chips** getoond; in de agendapunt-chat verschenen ze als niet-klikbare bullets. Oorzaak: `AgendapuntChat` negeerde de `vervolgvragen`-array die de chat-backend al meestuurt (uit de `###VERVOLGVRAGEN###`-marker), en `SP_AGENDAPUNT_REGELS` dwong als workaround een inline tekst-kopje "Om door te vragen" af. Opgelost: `AgendapuntChat` rendert de array nu als klikbare chips (klik = de vervolgvraag als nieuwe beurt sturen, zelfde patroon als de startvragen), en het inline-slot is uit `SP_AGENDAPUNT_REGELS` verwijderd (geen dubbeling meer). `tsc` 0.

**Consistentie met de assistent — contextbewuste vervolgacties.** De assistent toont onder elk antwoord knoppen als "Werk uit richting besluitvorming", "Maak feitelijker", "Geef bestuurlijke duiding", "Stel kritische vragen" (`bepaalVervolgacties` + `stuurVervolgactie`); de agenda had die niet. Toegevoegd aan `AgendapuntChat` met dezelfde `bepaalVervolgacties`/`isTransformatieActie` (documentgericht = true, want de agenda is altijd stukgericht). `stuurBericht` accepteert nu `antwoordmodusOverride` en `transformatie` en stuurt die mee in de request-body. In de route wordt `transformatie` vóór de agendapunt-modus afgehandeld, dus de herschrijf-acties herschrijven correct het vorige antwoord; de retrieval-acties draaien met de vastgezette modus op de agendapunt-scope (geen aparte scope-override). `tsc` 0.
