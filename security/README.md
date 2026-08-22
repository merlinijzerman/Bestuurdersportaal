# Securitydossier

Dit dossier is de technische ingang voor beveiliging en de route naar OWASP ASVS
Level 2. Het is **geen verklaring van conformiteit**. Conformiteit mag pas worden
geclaimd nadat ieder toepasselijk Level 1- en Level 2-vereiste afzonderlijk is
beoordeeld, bewijs heeft en onafhankelijk is gereviewd.

## Documenten

- [`PUBLICATIEBELEID.md`](./PUBLICATIEBELEID.md) — bindende grens tussen de
  publieke en private securitylaag; private-by-default.
- [`ASVS-L2-REGISTER.md`](./ASVS-L2-REGISTER.md) — normbasis, bewijsregels,
  huidige dekking en uitvoeringsroadmap.
- [`DREIGINGSMODEL.md`](./DREIGINGSMODEL.md) — assets, vertrouwensgrenzen,
  aanvalspaden en technische risico's.
- [`../decisions/0175-preview-productie-scheiding.md`](../decisions/0175-preview-productie-scheiding.md)
  — bindend architectuurbesluit over de domeinen en Preview-AI.
- [`../decisions/0176-fondsgerichte-preview-tenants.md`](../decisions/0176-fondsgerichte-preview-tenants.md)
  — fondsgerichte Preview-hosts binnen dezelfde geïsoleerde Preview-stack.
- [`../decisions/0177-app-blijft-productie-preview-ernaast-en-beheer-gescheiden.md`](../decisions/0177-app-blijft-productie-preview-ernaast-en-beheer-gescheiden.md)
  — actuele domein-, Supabase- en beheertopologie; herziet 0175/0176 waar nodig.

`publicatie-manifest.json` is de machineleesbare classificatie. Operationele
runbooks en uitvoerbewijs staan tijdelijk hash-gepind als `legacy_frozen`; zij
zijn geen voorbeeld voor nieuwe publieke documentatie en worden na inrichting
van de private bestemming uit deze laag gemigreerd.

## Minimale bewijsregel

Een control is pas `Voldoet` als het register ten minste bevat:

1. het versievaste ASVS-ID (`v5.0.0-x.y.z`);
2. toepasselijkheid en motivatie;
3. implementatiebewijs (code, providerinstelling of migratie);
4. verificatiebewijs (geautomatiseerde test of reproduceerbare handtest);
5. datum, omgeving en reviewer.

Een ontwerp, commentaar, intentie of groene build is op zichzelf geen bewijs dat
een ASVS-vereiste volledig is afgedekt.
