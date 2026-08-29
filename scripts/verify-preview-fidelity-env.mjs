import { fileURLToPath } from "node:url";

export const PREVIEW_FIDELITY_CONFIG_ERROR = Object.freeze({
  missing: "preview_fidelity_config_missing",
  invalid: "preview_fidelity_config_invalid",
  unsafe: "preview_fidelity_target_unsafe",
});

export class PreviewFidelityConfigError extends Error {
  constructor(code) {
    super(code);
    this.name = "PreviewFidelityConfigError";
    this.code = code;
  }
}

/**
 * Bewijst uitsluitend de doelbinding van de read-only Preview-verbinding.
 * De URL zelf en onderdelen waar een wachtwoord in kan staan worden nooit
 * geretourneerd of gelogd. Bereikbaarheid en rechten bewijst psql daarna.
 */
export function verifyPreviewFidelityEnv(env = process.env) {
  const rawUrl = env.PREVIEW_DATABASE_URL;
  const previewRef = env.EXPECTED_PREVIEW_REF;
  const productionRef = env.PRODUCTION_REF;
  const previewHost = env.EXPECTED_PREVIEW_POOLER_HOST;

  if (
    typeof rawUrl !== "string" ||
    rawUrl.trim() === "" ||
    typeof previewRef !== "string" ||
    previewRef.trim() === "" ||
    typeof productionRef !== "string" ||
    productionRef.trim() === "" ||
    typeof previewHost !== "string" ||
    previewHost.trim() === ""
  ) {
    throw new PreviewFidelityConfigError(
      PREVIEW_FIDELITY_CONFIG_ERROR.missing,
    );
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new PreviewFidelityConfigError(
      PREVIEW_FIDELITY_CONFIG_ERROR.invalid,
    );
  }

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname === "" ||
    parsed.pathname !== "/postgres"
  ) {
    throw new PreviewFidelityConfigError(
      PREVIEW_FIDELITY_CONFIG_ERROR.invalid,
    );
  }

  const expectedUser = `drift_lezer.${previewRef}`;
  if (
    previewRef === productionRef ||
    parsed.username !== expectedUser ||
    parsed.hostname !== previewHost ||
    parsed.username.includes(productionRef) ||
    parsed.hostname.includes(productionRef)
  ) {
    throw new PreviewFidelityConfigError(
      PREVIEW_FIDELITY_CONFIG_ERROR.unsafe,
    );
  }
}

function main() {
  try {
    verifyPreviewFidelityEnv();
    console.log(
      "Preview-fidelitydoel veilig gebonden aan de read-only Preview-rol.",
    );
  } catch (error) {
    const category =
      error instanceof PreviewFidelityConfigError
        ? error.code
        : PREVIEW_FIDELITY_CONFIG_ERROR.invalid;
    console.error(
      `::error title=Preview fidelity configuratiefout::${category}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
