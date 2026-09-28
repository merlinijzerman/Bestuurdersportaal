// #462 PR-2 — pure projectie van het private SharePoint-mapregister naar de
// browser. Geen server-only-import: de functie is puur en wordt los getest.
import type { MapregisterProjectie } from "@/core/lib/microsoft-sharepoint-graph-core";

/** Wat de browser van een map mag zien: een lokale, fondsgebonden opaque ref,
 * de naam en het weergavepad onder de bronroot. Nooit een drive- of item-id. */
export type SharePointMapRef = { ref: string; naam: string; mappad: string };

/** Koppelt de registerrefs terug aan de enumeratie. Een map zonder ref (niet
 * geregistreerd) valt weg in plaats van met een pad als surrogaatsleutel mee
 * te gaan. Volgorde: op pad, deterministisch. */
export function projecteerMapRefs(mapItems: MapregisterProjectie[], refs: Array<{ ref: string; item_id: string }>): SharePointMapRef[] {
  const refVan = new Map(refs.map((x) => [x.item_id, x.ref]));
  const gezien = new Set<string>();
  const uit: SharePointMapRef[] = [];
  for (const map of mapItems) {
    const ref = refVan.get(map.itemId);
    if (!ref || gezien.has(ref)) continue;
    gezien.add(ref);
    uit.push({ ref, naam: map.naam, mappad: map.mappad });
  }
  return uit.sort((a, b) => a.mappad.localeCompare(b.mappad, "nl") || a.ref.localeCompare(b.ref));
}
