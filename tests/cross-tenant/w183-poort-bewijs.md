# #183a — proven-red bewijs van de drie nieuwe poorten

> Een poort die nooit rood is waargenomen, is geen bewezen poort (vgl. g2-evidence.sh,
> de fondsleden-suite: gebouwd, aangesloten, nooit gevuurd). Dit bestand legt de RODE
> uitvoer vast van elk van de drie poorten die in #183a-commit 2/3 zijn bijgekomen,
> vóórdat de baseline naar de eindstand is bevroren. Over drie maanden staat er anders
> alleen "groen" en is niet meer te zien dat de escape-value-baseline één keer met ~250
> ontsnappingswaarden is opgeschoven.

Reproduceren: pas de genoemde wijziging toe, draai de genoemde test, herstel.

---

## 1. Ontsnappingswaarde-drift (route-mechanismen.test.ts, gate 4)

**Wijziging:** de vier door #183a geïntroduceerde escape-waarden op hun **pre-#183a
teller (0)** gezet i.p.v. de gemeten eindstand.
**Test:** `node --import tsx --test tests/cross-tenant/route-mechanismen.test.ts`

```
✖ W13 — geen ontsnappingswaarde neemt toe t.o.v. de bevroren teller
  AssertionError: ontsnappingswaarde(n) toegenomen — werk de teller in route-mechanismen.expected.json bij én motiveer waarom de nieuwe ontsnapping klopt:
    rateLimit: "nog-niet-beoordeeld": 96 > bevroren 0
    hostGuard: "geen": 100 > bevroren 0
    rateLimit: "route-eigen": 16 > bevroren 0
    audit: "geen": 38 > bevroren 0
```

**De sprong.** Dit is de baseline die #183a opschuift. Ná deze waarneming bevroren op
de gemeten eindstand (96 · 100 · 16 · 38; `hostGuard: "route-eigen"` bleef 4 — die
escape-waarde bestond al vóór #183a). `nog-niet-beoordeeld` is bewust **dalend werk**:
de W10-pas moet dat getal naar 0 brengen (elke route een `LimietNaam` óf een `"geen"`
mét motivering); stijgen is drift.

---

## 2. Gedeelde-limietsleutel-assertie (ratelimit-gedeelde-sleutel.test.ts)

**Wijziging:** `documents/embeddings-backfill` van `"route-eigen"` naar
`"nog-niet-beoordeeld"` — één van de drie routes die `LIMIETEN.backfill` delen krijgt
een afwijkende waarde.
**Test:** `node --import tsx --test tests/cross-tenant/ratelimit-gedeelde-sleutel.test.ts`

```
✖ rate-limit — declaraties die één limietsleutel delen dragen dezelfde rateLimit-waarde
  LIMIETEN.backfill gedeeld door 3 handlers met VERSCHILLENDE rateLimit-waarden:
      POST classificatie/backfill → route-eigen
      POST documents/embeddings-backfill → nog-niet-beoordeeld
      POST documents/reindex-backfill → route-eigen
```

Vandaag loopt het gevaar nog niet (alle self-limiters staan op `"route-eigen"`); de
poort staat er vóór de W10-pas er één een `LimietNaam` geeft.

---

## 3. Label-collisietoets (audit-handelingen.test.ts)

**Wijziging:** `POST inbreng` krijgt het label `risicos.aanmaken` (al in gebruik door
`POST risicos`).
**Test:** `node --import tsx --test tests/cross-tenant/audit-handelingen.test.ts`

```
✖ audit-handelingen — geen collisie (elk label is uniek over de handlers)
✖ audit-handelingen — elk code-label staat in het register (geen ongeregistreerde/gedrifte handeling)
  label "risicos.aanmaken" staat op POST inbreng, register verwacht POST risicos
```

Zowel de collisie- als de drift/register-gate vuurt: één label op twee (methode, pad)
maakt `handelingen_log` dubbelzinnig, en het register verankert de koppeling label↔route.
