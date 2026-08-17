# 0181 — ClamAV als geïsoleerd Vercel-containerproject in arn1

**Status:** geaccepteerd voor Preview; productie vereist afzonderlijk akkoord
**Datum:** 2026-08-17

## Besluit

Malwarescanning gebeurt in een apart Vercel-containerproject, gepind op `arn1`, bereikbaar via Vercel Trusted Sources/OIDC. Supabase Storage is de quarantaine- en promotiegrens. De gewone app ontvangt geen service-role en kan quarantainedocumenten niet lezen.

## Reden

Dit sluit aan op de bestaande Supabase- en Vercelarchitectuur, introduceert geen nieuwe verwerker en houdt de volledige documentbytes buiten VS-verwerking. Een warme ClamAV-container voorkomt bovendien het per-document downloaden en starten van de engine.

## Afgewezen alternatieven

- **Vercel Sandbox:** alleen `iad1`; strijdig met de gekozen dataresidentie.
- **Publiek scannerendpoint met bearer-secret:** vergroot het aanvalsoppervlak en maakt een langlevend secret onderdeel van de grens.
- **Environment-scrubbing als isolatie:** een proces dat het secret eerst ontvangt is geen harde secretgrens.
- **Nieuwe externe scanleverancier:** onnodige nieuwe verwerker en contractuele keten.

## Consequenties

Uploads zijn asynchroon en worden pas na een schone, hashgebonden scan leesbaar. Dit voegt meestal seconden toe en kan bij een koude start circa 20–30 seconden kosten. Scanner- en signatureproblemen blokkeren promotie. De rollout gebruikt een featureflag en vereist een database-Previewomgeving of een expliciet, afzonderlijk besluit voor een additieve migratie op productie.
