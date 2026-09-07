// ============================================================================
//  core/lib/microsoft-login-crypto-core.ts — PURE AES-256-GCM voor de eenmalige
//  login-flowtransactie (fase 1B, #335 T2; besluit 0211 D7: eigen sleutel).
// ----------------------------------------------------------------------------
//  Bewust een eigen module naast microsoft-crypto-core.ts (Graph-connector-kluis):
//  gescheiden vertrouwensdomeinen, eigen sleutel (MICROSOFT_LOGIN_ENCRYPTION_KEY),
//  eigen AAD-prefix. Injecteerbare sleutel → testbaar zonder env.
// ============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type LoginVersleuteldBlob = {
  readonly sleutelVersie: number;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
};
export type LoginSleutel = { readonly versie: number; readonly sleutel: Buffer };

export const LOGIN_AAD_PREFIX = "m365login:v1";

/** AAD bindt de blob aan fonds, gebruiker (of `-` bij inloggen) en intent. */
export function loginAad(args: { fondsId: string; userId: string | null; intent: "koppelen" | "inloggen" }): string {
  return `${LOGIN_AAD_PREFIX}:${args.fondsId}:${args.userId ?? "-"}:${args.intent}`;
}

/** Leest de sleutel uit configuratiewaarden (puur; de server-only laag levert env aan). */
export function parseLoginSleutel(base64: string | undefined, versie: string | undefined): LoginSleutel {
  const v = Number.parseInt(versie ?? "", 10);
  if (!base64?.trim() || !Number.isSafeInteger(v) || v < 1) {
    throw new Error("Microsoft-login-sleutel is niet geconfigureerd.");
  }
  const sleutel = Buffer.from(base64.trim(), "base64");
  if (sleutel.length !== 32) throw new Error("Microsoft-login-sleutel heeft geen geldige AES-256-lengte.");
  return { versie: v, sleutel };
}

function valideer(config: LoginSleutel): void {
  if (!Number.isSafeInteger(config.versie) || config.versie < 1 || config.sleutel.length !== 32) {
    throw new Error("Microsoft-login-sleutel is ongeldig.");
  }
}

export function versleutelLoginGeheim(plaintext: string, aad: string, config: LoginSleutel): LoginVersleuteldBlob {
  valideer(config);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.sleutel, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    sleutelVersie: config.versie,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function ontsleutelLoginGeheim(blob: LoginVersleuteldBlob, aad: string, config: LoginSleutel): string {
  valideer(config);
  if (blob.sleutelVersie !== config.versie) throw new Error("Microsoft-login-transactie gebruikt een niet-beschikbare sleutelversie.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", config.sleutel, Buffer.from(blob.iv, "base64"));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Microsoft-login-transactie kon niet veilig worden ontsleuteld.");
  }
}
