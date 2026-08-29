import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export function sanitizeE2eLog(inhoud) {
  return String(inhoud)
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/(sb-[A-Za-z0-9_-]+-auth-token(?:\.\d+)?=)[^;\s]+/gi, "$1[REDACTED]")
    .replace(/("name"\s*:\s*"sb-[^"]*auth-token[^\"]*"\s*,\s*"value"\s*:\s*")[^"]*/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|code|secret|access_token|refresh_token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/((?:E2E_WACHTWOORD|password|wachtwoord|access_token|refresh_token|service_role_key|anon_key)\s*[=:]\s*["'])[^"'\r\n]+/gi, "$1[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
}

async function main() {
  const inputIndex = process.argv.indexOf("--input");
  const outputIndex = process.argv.indexOf("--output");
  const input = inputIndex >= 0 ? process.argv[inputIndex + 1] : null;
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  if (!input || !output) {
    throw new Error("Gebruik: sanitize-e2e-log.mjs --input <bestand> --output <bestand>");
  }
  const inhoud = await readFile(input, "utf8").catch(() => "Geen serverlog beschikbaar.\n");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, sanitizeE2eLog(inhoud), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
