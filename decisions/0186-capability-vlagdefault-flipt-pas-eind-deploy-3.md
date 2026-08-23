# 0186 — `ENFORCE_CAPABILITY` is een kale opt-in vlag; de omgevings-default flipt pas aan het eind van deploy 3

- **Status:** Geaccepteerd
- **Datum:** 2026-08-23
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse & uitvoering)
- **Werkopdracht:** W6 — `RouteSpec`: capability verplicht, deny-by-default (EPIC W, deploy 3)

## Context

W6 maakt `capability` een verplicht veld in `RouteSpecV1` en laat `withFondsRoute`
het handhaven. Het mechanisme landt met alle 112 handlers op `"TE_BEPALEN"`: welke
capability bij welke route hoort is een functioneel en deels bestuurlijk besluit,
en dat is W7.

Het portaal kent voor de tenantgrens al een env-schakelaar met een uitgesproken
vorm. `tenantEnforceVoorOmgeving()` (besluit 0042) zet productie, preview én
staging **altijd** fail-closed, ook als `TENANT_ENFORCE` ontbreekt of per ongeluk
op `off` staat. Die vorm is daar juist: een configuratiefout mag een
beveiligingsgrens niet stil uitschakelen.

De verleiding is om die vorm hier te kopiëren. Dat kan niet, en het verschil is
geen detail: zolang 112 handlers `"TE_BEPALEN"` declareren, betekent een
omgevings-default dat de eerste preview-deploy **elk** ingelogd request op 403
zet. De lokale meting laat dat precies zien — met de vlag aan valt 220 van de 361
harnasscenario's om, en de 141 die overeind blijven zijn de `anon`-scenario's,
waar de 401 vóór de poort valt.

## Besluit

`capabilityEnforceVoorOmgeving()` kent in W6 **één** invoer: de expliciete vlag.
Alleen `ENFORCE_CAPABILITY=on` zet de poort aan, overal en op geen enkele andere
grond. Er is bewust géén omgevingstak.

De flip naar fail-closed-per-omgeving hoort in diezelfde functie thuis, en gebeurt
**aan het eind van deploy 3, als eigen besluit op een eigen moment** — pas nadat
W7 de declaraties heeft ingevuld en `"TE_BEPALEN"` is verdwenen. Hij komt niet
stilzwijgend mee met een andere PR.

## Overwogen alternatieven

- **`tenantEnforceVoorOmgeving()` letterlijk kopiëren** — afgevallen. Fail-closed
  is hier pas veilig als er iets te handhaven valt. Met `"TE_BEPALEN"` overal
  handhaaft de poort niet een rolmodel maar de afwezigheid ervan.
- **De vlag nu al op preview aan laten staan** — afgevallen als eindtoestand,
  maar bewust wél als *stap*: W6 zet hem op preview aan om het 403-pad op echte
  infrastructuur te bewijzen, en daarna weer uit. De 403's die dat oplevert zijn
  de ontdekkingslijst waarmee W7 begint.
- **Geen vlag, direct handhaven** — afgevallen. Dan is W6 geen mechanisme maar een
  gedragswijziging over 95 routes tegelijk, zonder dat iemand het rolmodel heeft
  vastgesteld.

## Gevolgen

- **Gedrag:** met de vlag uit verandert er geen responsebyte. Het
  karakteriseringsharnas is 3× byte-identiek (361/361) tegen de op `main`
  opgenomen snapshots.
- **Observatie:** de poort logt onder de vlag-uit-stand elke zou-weigering als
  `[CAPABILITY-OBSERVE]` — route, methode, capability, rol, zou-beslissing, reden.
  Zonder gebruikers-id en zonder e-mailadres: W7 heeft route, rol en uitkomst
  nodig, meer niet.
- **Bewust geaccepteerde schuld:** tot de flip is de capability-poort géén
  beveiligingsmaatregel. De route-eigen gates (`requireCapability`, de inline
  rolstrings, de bureau-gate) en RLS blijven onverkort de werkende grens, en mag
  niemand verwijderen in het vertrouwen dat de wrapper het overneemt.
- **Volgorde in de wrapper:** de host↔fonds-guard gaat vóór de capability-poort.
  Anders zou het flippen van deze vlag veranderen wélke 403 een host-mismatch
  oplevert — een gedragswijziging die niets met autorisatie te maken heeft.
- **CI:** W13 krijgt de faalregel op elke resterende `"TE_BEPALEN"`. Die staat
  nog **niet** aan; hem nu aanzetten zou W6 zelf rood maken.

## Referenties

- `core/lib/capability-enforce.ts` + `core/lib/capability-enforce.sanity.ts`
- `core/lib/route-wrapper.ts` (blok "3b. Capability-poort")
- `core/lib/route-wrapper.md` — "Wat W6 in de praktijk opleverde"
- Besluit [0042](./0042-tenant-enforce-fail-closed-env-schakelaar.md) — de vorm die hier bewust *niet* is gekopieerd
- `05 Security en compliance/TICKET-W6-capability-deny-by-default.md` §2, §3
