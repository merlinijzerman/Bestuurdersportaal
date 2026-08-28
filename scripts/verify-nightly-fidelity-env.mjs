import { fileURLToPath } from "node:url";

export const FIDELITY_CONFIG_ERROR = Object.freeze({
  missing: "fidelity_config_missing",
  invalid: "fidelity_config_invalid",
});

export class FidelityConfigError extends Error {
  constructor(code) {
    super(code);
    this.name = "FidelityConfigError";
    this.code = code;
  }
}

/**
 * Valideert alleen de vorm. Bereikbaarheid en databasegedrag worden daarna door
 * cross-tenant-ci.sh/psql bewezen. De URL zelf mag nooit in uitvoer belanden.
 */
export function verifyNightlyFidelityEnv(env = process.env) {
  const rawUrl = env.TEST_DATABASE_URL;
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new FidelityConfigError(FIDELITY_CONFIG_ERROR.missing);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new FidelityConfigError(FIDELITY_CONFIG_ERROR.invalid);
  }

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname === ""
  ) {
    throw new FidelityConfigError(FIDELITY_CONFIG_ERROR.invalid);
  }
}

function main() {
  try {
    verifyNightlyFidelityEnv();
    console.log("Nightly fidelity-configuratie aanwezig; DB-laag is verplicht.");
  } catch (error) {
    const category =
      error instanceof FidelityConfigError
        ? error.code
        : FIDELITY_CONFIG_ERROR.invalid;
    console.error(
      `::error title=Nightly fidelity configuratiefout::${category}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
