import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type VersleuteldBlob = { sleutelVersie: number; iv: string; tag: string; ciphertext: string };
export type MicrosoftSleutel = { versie: number; sleutel: Buffer };

function valideerSleutel(config: MicrosoftSleutel): void {
  if (!Number.isSafeInteger(config.versie) || config.versie < 1 || config.sleutel.length !== 32) {
    throw new Error("Microsoft-tokenkluis heeft geen geldige AES-256-sleutel.");
  }
}

export function versleutelMetMicrosoftSleutel(
  plaintext: string,
  aad: string,
  config: MicrosoftSleutel,
): VersleuteldBlob {
  valideerSleutel(config);
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

export function ontsleutelMetMicrosoftSleutel(
  blob: VersleuteldBlob,
  aad: string,
  config: MicrosoftSleutel,
): string {
  valideerSleutel(config);
  if (blob.sleutelVersie !== config.versie) {
    throw new Error("Microsoft-tokenkluis gebruikt een niet-beschikbare sleutelversie.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", config.sleutel, Buffer.from(blob.iv, "base64"));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Microsoft-tokenkluis kon niet veilig worden ontsleuteld.");
  }
}
