# 0092 — Een terugvraag is ook een interactie: verduidelijking wordt gelogd én bewaard

- **Status:** Geaccepteerd
- **Datum:** 2026-07-30
- **Betrokkenen:** opdrachtgever (Merlin IJzerman), Claude (analyse + uitvoering)

## Context

Aanleiding: een bestuurder (Robert) stelde een vraag in de AI-chat en er was achteraf
niets terug te vinden — nul rijen in `governance_log` én nul in `gesprekken`, terwijl de
vraag aantoonbaar is gesteld. Andere accounts met dezelfde rol (`bestuurder`) hadden wél
bewaarde gesprekken, dus een rolafhankelijkheid was uitgesloten (de RLS-policy
"eigen gesprekken" is `gebruiker_id = auth.uid() and fonds_id = (select fonds_id from
profielen where id = auth.uid())` — identiek voor elke rol, en `profielen.rol` komt in het
opslagpad niet voor).

Oorzaak, geverifieerd in beide lagen:

1. **Server.** De verduidelijkingstak in `app/api/chat/route.ts` retourneert bij een
   onzekere bron-intentie één SSE-event met de vraag + chips en stopt daar, bewust zónder
   `governance_log`-regel. Redenering uit besluit 0014: *"er is geen antwoord"*.
2. **Client.** `bewaarGesprek` in `AssistentClient.tsx` wordt alleen aangeroepen in de tak
   `else if (volledig.trim())` — dus uitsluitend bij gestreamde antwoordtekst. Bij een
   verduidelijking komen er geen delta-events, dus `volledig` blijft leeg.

Netto: een vraag die in de terugvraag eindigde en waarbij niet op een chip werd geklikt,
liet **geen enkel spoor** achter. Dat gebeurt niet incidenteel: op 18 realistische
portaalvragen viel 17× de terugvraag (meting 30-07-2026, zie 0091).

Wat dit tot meer dan een gemis maakt: op datzelfde scherm staat in de begroeting *"Elke
vraag wordt vastgelegd in de Governance Log, inclusief welke bron is gebruikt."* Voor dit
pad werd die belofte niet nagekomen. De **vraag** is een gebruikersinteractie met het
AI-systeem; dat is wat bestuurlijke navolgbaarheid en de AI Act-lijn vragen, niet of er
een antwoord uit kwam. Bovendien is juist deze regel interessant: hij bewijst dat het
systeem níet gokte.

Randvoorwaarden: append-only audit (alleen inserts), geen migratie, geen modelkosten bij
een tak die per definitie geen model aanroept, en geen dubbele beurt in het gesprek nadat
de bestuurder op een chip klikt.

## Besluit

**Herziet de logkeuze uit 0014.** De verduidelijkingstak schrijft nu wél één
`governance_log`-regel: `vraag` = de vraag van de bestuurder, `antwoord` = de gestelde
verduidelijkingsvraag, `bronnen = []`, `model = null` (er is geen model aangeroepen — een
modelnaam zou suggereren dat er gegenereerd is), `modus` = de modus waar de vraag naartoe
onderweg was (`bepaalAutoBronModus`, dus de combineren-vloer of `documenten` bij een
expliciete fondsrestrictie), en `retrieval_meta = { verduidelijking: true,
geen_modelcall: true, bron_intent, bron_vertrouwen, alleen_fondsdocumenten }`.

**De client bewaart de terugvraag als beurt.** `bewaarGesprek` wordt ook aangeroepen bij
een verduidelijkingsbeurt, zodat de vraag een refresh overleeft en in de lade
"Gesprekken" terugkomt.

## Besluitpunt 1 — `verduidelijking: true` als marker, geen nieuw event-type

De regel is herkenbaar als terugvraag via een marker in de bestaande `retrieval_meta`
(jsonb), niet via een nieuwe tabel, kolom of `governance_events`-type. Daarmee blijft de
append-only keten ongewijzigd en wordt de terugvraag-frequentie **meetbaar op logdata** —
precies de empirische basis die de meetset-uitbreiding uit 0091 (OP-C3) nodig heeft.

## Besluitpunt 2 — geen dubbele beurt na een chipklik

`kiesVerduidelijking` stuurt dezelfde vraag opnieuw met `basisBerichten` waarin de
verduidelijkingsbubbel is weggelaten. Omdat de eerste opslag `gesprekId` al heeft gezet,
**overschrijft** de vervolgbeurt dezelfde gespreksrij met vraag + echt antwoord. De
bubbel verdwijnt dus netjes uit het bewaarde gesprek; in het `governance_log` blijven
beide regels staan (append-only) — de terugvraag én het antwoord, in die volgorde. Dat is
gewenst: het maakt de interactie volledig reconstrueerbaar.

## Besluitpunt 3 — fail-safe, nooit blokkerend

De insert staat in een `try/catch`: een mislukte logregel mag de terugvraag niet
blokkeren, maar wordt wel naar de serverlog geschreven zodat een structureel probleem
opvalt. Dezelfde afweging als bij de bestaande antwoord-logregel.

## Overwogen alternatieven

- **Alles laten zoals het was.** Verworpen: de belofte op het scherm wordt dan niet
  nagekomen, en na 0091 blijft de terugvraag bestaan (zeldzamer, niet weg).
- **Alleen client-side bewaren.** Verworpen: dan overleeft de vraag wél een refresh, maar
  het auditspoor blijft leeg — en dát is de governance-belofte.
- **Alleen server-side loggen.** Verworpen: de bestuurder ziet zijn vraag dan nog steeds
  verdwijnen na een refresh, wat de indruk "niet opgeslagen" in stand houdt.
- **Een eigen tabel of `governance_events`-type voor terugvragen.** Verworpen: een tweede
  logmechanisme voor dezelfde interactiesoort, met migratie- en RLS-impact, zonder
  functionele winst boven een marker in `retrieval_meta`.
- **`model` vullen met het geconfigureerde model.** Verworpen: er draait geen model. Een
  ingevulde modelnaam maakt het auditspoor onjuist. De governance-UI toont `model` niet,
  dus `null` is veilig.

## Gevolgen

- **Route:** `app/api/chat/route.ts` — één insert in de verduidelijkingstak, vóór de
  stream. Geen modelcall, dus verwaarloosbare kosten en geen latency van betekenis.
- **Client:** `app/(dashboard)/ai/_components/AssistentClient.tsx` — de
  verduidelijkingsbeurt wordt als `Bericht` vastgehouden en na het lezen van de stream
  bewaard.
- **Types:** `core/lib/rag.ts` — `RetrievalMeta.verduidelijking` en `.geen_modelcall`.
- **Audit:** meer regels in `governance_log` (elke terugvraag telt nu mee). Bij het
  interpreteren van logvolumes en van "aantal AI-vragen" moet op
  `retrieval_meta->>'verduidelijking'` worden gefilterd om terugvragen te scheiden van
  antwoorden. **Expliciet benoemd** zodat een rapportage niet stil verandert.
- **Geen migratie, geen RLS-/policy-/schema-wijziging.** `retrieval_meta` is jsonb,
  `model` is nullable. `tsc --noEmit --skipLibCheck` exit 0.
- **Agendapunt-modus onveranderd:** daar staat de bron-intentie-twijfel uit
  (`bronIntentResultaat = null`), dus `AgendapuntChat.tsx` kent deze tak niet.
- **Openstaand, apart belegd (OP-C4):** de agendavoorbereiding-route
  (`app/api/agendapunten/[id]/voorbereiding/route.ts`) doet uitsluitend reads en schrijft
  **geen** `governance_log`-regel — een volledige AI-generatie zonder auditspoor. Alleen
  `/api/chat` logt vandaag. Dat is een eigen besluit, geen bijproduct van deze fix.

## Referenties

- Code: `app/api/chat/route.ts` (verduidelijkingstak),
  `app/(dashboard)/ai/_components/AssistentClient.tsx` (`bewaarGesprek`-tak),
  `core/lib/rag.ts` (`RetrievalMeta`).
- Besluiten: [`0014`](./0014-increment-i2-automatische-bronkeuze.md) (**dit besluit
  herziet** de keuze "geen governance_log-regel bij verduidelijking"),
  [`0016`](./0016-i2-aanscherpingen-na-review.md) (auditspoor bron-intentie),
  [`0091`](./0091-expliciete-scopebepaling-en-voorstelvragen.md) (terugvraag-frequentie,
  meting 17/18), [`0086`](./0086-auto-restore-begrensd-tot-browsersessie.md) (waarom een
  bewaard gesprek na refresh niet automatisch terugkomt).
- Ontwerp: `03 Functioneel ontwerp/Bestuurdersportaal - Doorontwikkeling v2 functioneel
  ontwerp v1.3.md` (§11a, §11d auditspoor).
