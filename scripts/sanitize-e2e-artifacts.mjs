import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sanitizeE2eLog } from "./sanitize-e2e-log.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });

function sanitizeTraceTekst(inhoud) {
  return sanitizeE2eLog(inhoud).replace(
    /("(?:value|inputValue)"\s*:\s*")[^"]*/g,
    "$1[REDACTED]",
  );
}

async function sanitizeTekstbestand(pad, traceModus = false) {
  const buffer = await readFile(pad);
  let tekst;
  try {
    tekst = decoder.decode(buffer);
  } catch {
    return;
  }
  const veilig = traceModus ? sanitizeTraceTekst(tekst) : sanitizeE2eLog(tekst);
  if (veilig !== tekst) await writeFile(pad, veilig, "utf8");
}

async function loopBestanden(map, actie) {
  for (const entry of await readdir(map, { withFileTypes: true })) {
    const pad = join(map, entry.name);
    if (entry.isDirectory()) await loopBestanden(pad, actie);
    else if (entry.isFile()) await actie(pad);
  }
}

async function sanitizeTraceZip(pad) {
  const werkmap = await mkdtemp(join(tmpdir(), "bp-e2e-trace-"));
  try {
    execFileSync("unzip", ["-q", pad, "-d", werkmap]);
    await loopBestanden(werkmap, async (bestand) => {
      if (bestand.endsWith(".network")) {
        // Playwright-netwerktraces bevatten requestheaders en sessiecookies.
        // De actietijdlijn, DOM-snapshots en screenshots blijven beschikbaar.
        await rm(bestand);
        return;
      }
      await sanitizeTekstbestand(bestand, true);
    });
    await rm(pad);
    execFileSync("zip", ["-q", "-r", pad, "."], { cwd: werkmap });
  } finally {
    await rm(werkmap, { recursive: true, force: true });
  }
}

function isPlaywrightTraceZip(pad) {
  if (!pad.endsWith(".zip")) return false;
  const inhoud = execFileSync("unzip", ["-Z1", pad], { encoding: "utf8" });
  return inhoud.split("\n").some((naam) => naam.endsWith(".trace"));
}

export async function sanitizeE2eArtefacten(paden) {
  for (const invoerpad of paden) {
    const info = await stat(invoerpad).catch(() => null);
    if (!info) continue;
    if (info.isFile()) {
      if (isPlaywrightTraceZip(invoerpad)) await sanitizeTraceZip(invoerpad);
      else await sanitizeTekstbestand(invoerpad);
      continue;
    }
    await loopBestanden(invoerpad, async (bestand) => {
      if (isPlaywrightTraceZip(bestand)) await sanitizeTraceZip(bestand);
      else await sanitizeTekstbestand(bestand);
    });
  }
}

async function main() {
  const paden = process.argv.slice(2);
  if (paden.length === 0) {
    throw new Error("Gebruik: sanitize-e2e-artifacts.mjs <map-of-bestand> [...]");
  }
  await sanitizeE2eArtefacten(paden.map((pad) => join(process.cwd(), pad)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
