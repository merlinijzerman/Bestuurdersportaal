# 0099 — Bij `bronoverzicht` staan de documenten in het antwoord, niet in het paneel

- **Status:** Geaccepteerd
- **Datum:** 2026-07-31
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse en uitvoering)

## Context

Bij een vraag als *"welke stukken hebben we over de compensatieregeling?"* zíjn de
documenten het antwoord. Tot nu toe kreeg de bestuurder daar een alinea die de titels in
proza herhaalde, met de werkelijke lijst ingeklapt in het paneel "Onderbouwing en
bronnen" eronder. Het antwoord op de vraag stond dus verstopt achter een klik, terwijl de
zichtbare tekst een slap aftreksel was van wat er al lag.

De antwoordmodus `bronoverzicht` bestond al: hij wordt server-side bepaald in
`core/lib/vraagtype.ts` en gaat mee in het `meta`-event. Er was alleen nooit iets in de
weergave dat er iets mee deed.

## Besluit

**1. Bij antwoordmodus `bronoverzicht` promoveren de gevonden documenten naar het
antwoord**, als lijst direct onder de antwoordtekst (`Documentenlijst` in
`AntwoordWeergave.tsx`). Per document één kaart met bestandstype-badge, titel, chips voor
documenttype, status en datum, het trefferfragment met vindplaats, en een benoemde
openen-actie.

**2. Anti-dubbeling.** Staan de documenten in het antwoord, dan houdt het
onderbouwingspaneel alléén de verantwoording (bronbasis, antwoordmodus, retrievalmodus,
scope, peildatum). Geen tweede lijst. Het paneel meldt dat expliciet — *"De gevonden
documenten staan als lijst in het antwoord hierboven"* — want de bestaande fallbacktekst
*"Geen interne documentbronnen geraadpleegd"* zou daar feitelijk onjuist zijn.

De vlag volgt **exact dezelfde conditie** als de lijst zelf (`documentlijstZichtbaar()`):
voltooid antwoord, modus `bronoverzicht`, én minstens één documentbron. Volgde hij alleen de
modus, dan zou het paneel tijdens het streamen, bij een afgebroken antwoord en bij nul
treffers een lijst claimen die er niet staat — en tegelijk de bronkaarten verbergen.

De `[Bron N]`-pill blijft werken: de documentkaart draagt een scroll-anker per
bronvermelding die naar dat document wijst. Zonder dat zou een klik in juist deze modus
nergens landen, want de bronkaarten met hun ankers staan er niet meer.

**Een besluitregistratie hoort niet in een documentlijst.** `opmaakBesluitContext()` levert
bronnen met `bron: "Decision Object"` en een `decision_id` in het `document_id`-veld. In de
lijst zou dat de document-scope laten falen op `niet_gevonden` — en dus de héle vervolgvraag
blokkeren — en het filter "alleen vastgesteld" zou een `besloten` besluit juist verbergen,
omdat die status uit een ander domein komt. Ze staan buiten de lijst en blijven als
bronkaart in het paneel: de formeel zwaarste bron mag niet verdwijnen.

Bij **elke andere** antwoordmodus verandert er niets: de bronkaarten blijven in het
paneel staan zoals na tranche 2A.

**3. De modus wordt gelezen, niet bepaald.** `ANTWOORDMODUS_PATRONEN`,
`bepaalAntwoordmodus` en de drempels zijn niet aangeraakt. De weergave leest
`onderbouwing.antwoordmodus` — een waarde die al per bericht meereisde. Er komt geen state
bij, geen API-veld, en geen tweede plek waar iets over de modus wordt besloten.

**4. Ordening is deterministisch en getest.** `groepeerDocumentbronnen()` in
`core/lib/documentlijst.ts` ontdubbelt op `document_id` (één document levert vaak
meerdere chunks), groepeert op `documenttype` in de canonieke `DOCUMENTTYPEN`-volgorde met
de restgroep achteraan, en sorteert binnen een groep op `documentdatum` aflopend met
documenten zonder datum onderaan. Titel en `document_id` zijn de tiebreak, zodat de
ordening **totaal** is: dezelfde bronnenset geeft gegarandeerd dezelfde lijst. Geen
`localeCompare` — de ICU-collatie verschilt per Node-build en zou het resultaat
onreproduceerbaar maken.

**5. Filteren is weergave, geen retrieval.** De chips ("Alle" / "Alleen vastgesteld")
werken uitsluitend op de al opgehaalde set: geen fetch, geen nieuwe retrieval-call, geen
wijziging aan de filtering vóór retrieval. De teller toont altijd "n van m", zodat
zichtbaar blijft hoeveel er is weggefilterd. "Vastgesteld" weegt dezelfde **drieslag** als
de pill-markering uit tranche 2A: `ACTUELE_BRON_STATUSSEN`, bronstatus actief, en de
geldigheid niet verstreken — een `van_kracht`-stuk met verlopen `geldig_tot` is geen
actuele grondslag.

Documenten waarvan de status **niet is meegeleverd** worden apart geteld ("3 van 6 · 2
zonder status") in plaats van stil weggefilterd. Ontbrekende status is iets anders dan "niet
vastgesteld"; stil verbergen zou een oordeel suggereren dat er niet is.

Boven de lijst staat een voorbehoud: dit is de opgehaalde set bij déze vraag, geen
uitputtend overzicht van de bibliotheek. Zonder die regel leest een lijst met groepskoppen
en aantallen als een inventaris.

**6. Document-scope als vervolgactie.** "Vraag hierover" (per document) en "Vraag over
deze N documenten" zetten de bestaande client-scope en zetten de cursor in het
invoerveld. Ze versturen **geen** vraag: de bestuurder formuleert zelf wat hij wil weten.
De server-side validatie (`valideerScope`: bestaat, actief, geïndexeerd, RLS-toegang)
blijft onverkort leidend en wordt bij het versturen doorlopen; een geweigerd document
geeft daar de bestaande zichtbare fout — nooit een stille terugval.

In de agendapuntchat worden die knoppen **niet** getoond: daar ís de scope al vast (de aan
het agendapunt gekoppelde stukken), en versmallen zonder dat de bestuurder erom vraagt zou
de context stilletjes veranderen.

## Groeperen op `documenttype`, niet op `context`

Het alternatief was groeperen op `documenten.context` (dossier / vergadering / algemeen).
Afgewogen en verworpen:

- `context` zegt wáár een stuk in het portaal is opgeborgen, niet wát voor stuk het is —
  terwijl "welke stukken hebben we over X" om het soort stuk gaat;
- drie groepen over een lijst van doorgaans vier tot tien documenten voegt weinig ordening
  toe;
- `context` zit niet in de payload; meesturen zou een derde kolom betekenen.

Eerlijk tegenargument: `context` ís gebackfilld en `documenttype` niet. Zie hieronder.

## Gevolgen

- **`documenttype` is voorlopig grotendeels leeg.** De kolom is nullable en niet
  gebackfilld zolang de metadata-review-queue niet is doorgewerkt. In de praktijk valt
  vandaag het merendeel in de groep "Type nog niet vastgelegd" en doet de sortering op
  datum het werk. Dat is acceptabel en wordt vanzelf beter; de eerste live meting gaf één
  van zes documenten met een type.
- **Twee kolommen erbij in de payload** (`documenttype`, `bestandstype`) — zie hieronder.
  Ze belanden ook in `governance_log.bronnen`; dat verandert de inhoud van het auditspoor,
  niet de vorm.
- **Een misclassificatie weegt zwaarder dan voorheen.** De detectie is niet aangeraakt,
  maar een vraag die ten onrechte als `bronoverzicht` wordt herkend krijgt nu een
  documentlijst in plaats van alleen een paneel. De lijst staat additief ónder het
  antwoord, dus de schade blijft cosmetisch.

## De payloaduitbreiding: verrijking ná retrieval

`documenttype` en `bestandstype` bestaan al als kolom (migraties 2026_06_18 en
2026_05_03), maar **niet in het retrieval-pad**: `zoek_chunks` en `zoek_chunks_hybride`
hebben een vaste `returns table` zonder die kolommen, en een kolom toevoegen aan een
RPC-return vereist `drop function` + `create` — dus een migratie. De afspraak voor deze
tranche was: geen migratie.

Daarom haalt `verrijkDocumentmetadata()` in `core/lib/rag.ts` ze op in één gebatchte
vervolgquery op de unieke document-id's, precies zoals `verrijkNotulenChunks()` dat al
deed. Die plek zit ná de splitsing in retrieval-paden, waar RPC, fallback-cascade,
dekkingsbrede scope en parent-context weer samenkomen. Dat is niet alleen goedkoper dan
zeven selects bijhouden — het maakt "geen pad gemist" **structureel** in plaats van een
controle die je bij elke wijziging opnieuw moet doen.

De velden zijn **pure doorgeefwaarden**: ze worden nergens gelezen door retrieval,
ranking, filtering of promptopbouw. De verrijking draait ná `handhaafFondsdiscipline` en
ná `naVerwerking`, en `maakContext()` bouwt de modelcontext uit expliciet benoemde velden
— het bronnen-array gaat nergens door `JSON.stringify`.

RLS blijft leidend: de query loopt via de anon-client, dus een document buiten het eigen
fonds komt niet terug en het veld blijft leeg. Faalt de query, dan valt de weergave netjes
terug (geen chip, geen badge) — een fout mag het antwoord nooit tegenhouden.

## Overwogen alternatieven

- **Beide RPC's uitbreiden via een migratie.** Volgt het bestaande T10-patroon, maar
  breekt de afspraak "geen migratie", vereist migratie-eerst-dan-deploy en raakt de
  gedeelde retrieval-gate die álle antwoorden voedt.
- **Alleen de fallback-selects aanpassen.** Dan zijn de velden op het normale
  (RPC-)pad altijd leeg en valt de kaart in de praktijk altijd terug.
- **Een nieuwe antwoordmodus.** Uitdrukkelijk niet: `bronoverzicht` bestond al, en een
  achtste modus zou de detectie, de meetset en de labels raken.

## Referenties

- Code: [`core/lib/documentlijst.ts`](../core/lib/documentlijst.ts) +
  [`.sanity.ts`](../core/lib/documentlijst.sanity.ts), `verrijkDocumentmetadata()` in
  [`core/lib/rag.ts`](../core/lib/rag.ts), `Documentenlijst` in
  [`AntwoordWeergave.tsx`](../app/(dashboard)/ai/_components/AntwoordWeergave.tsx)
- Ontwerp: [`AI-WEERGAVE-ONTWERP.md`](../AI-WEERGAVE-ONTWERP.md) §9
- Voorgeschiedenis: [`0079`](./0079-agenda-assistent-gedeelde-weergave.md) (gedeelde
  renderer), [`0100`](./0100-fragmentlengte-op-zinsgrens.md) (het citaat)
