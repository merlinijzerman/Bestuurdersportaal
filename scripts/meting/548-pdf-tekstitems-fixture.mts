// ============================================================================
//  scripts/meting/548-pdf-tekstitems-fixture.mts — fixture uit een echte PDF.
// ----------------------------------------------------------------------------
//  Legt de pdfjs-tekstitems (tekst, positie, lettergrootte, font) van een
//  paginabereik vast als JSON, zodat de bronblokken- en sectietests op de
//  echte layout draaien zonder de PDF zelf in Git. Fontnamen worden per pagina
//  genormaliseerd (F1, F2, … in volgorde van eerste voorkomen): pdfjs-namen
//  zijn alleen binnen één pagina vergelijkbaar.
//
//  Gebruik:
//    npx tsx scripts/meting/548-pdf-tekstitems-fixture.mts <pdf> <van> <tot> <uit.json> [bron-omschrijving]
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { leesPdfPaginas } from "../../core/lib/document-extractie";

const [pad, van, tot, uit, bron] = process.argv.slice(2);
const buffer = readFileSync(pad);
const alle = await leesPdfPaginas(buffer);
const paginas = alle
  .filter((p) => p.pagina >= Number(van) && p.pagina <= Number(tot))
  .map((p) => {
    const fonts = new Map<string, string>();
    return {
      pagina: p.pagina,
      breedte: p.breedte,
      hoogte: p.hoogte,
      items: p.items.map((i) => {
        if (i.font && !fonts.has(i.font)) fonts.set(i.font, `F${fonts.size + 1}`);
        const rond = (n: number) => Math.round(n * 100) / 100;
        return { str: i.str, x: rond(i.x), y: rond(i.y), fontSize: rond(i.fontSize), width: rond(i.width), font: i.font ? fonts.get(i.font) : undefined };
      }),
    };
  });
writeFileSync(
  uit,
  JSON.stringify(
    {
      bron: bron ?? pad.split("/").pop(),
      sha256: createHash("sha256").update(buffer).digest("hex"),
      paginasInBron: alle.length,
      paginas,
    },
    null,
    0
  ) + "\n"
);
console.log(`${paginas.length} pagina's, ${paginas.reduce((n, p) => n + p.items.length, 0)} items → ${uit}`);
