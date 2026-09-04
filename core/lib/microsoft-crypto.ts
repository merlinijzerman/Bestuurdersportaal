import "server-only";
import {
  ontsleutelMetMicrosoftSleutel,
  versleutelMetMicrosoftSleutel,
  type VersleuteldBlob,
} from "@/core/lib/microsoft-crypto-core";
export type { VersleuteldBlob } from "@/core/lib/microsoft-crypto-core";

function leesSleutel(): { versie: number; sleutel: Buffer } {
  const waarde = process.env.MICROSOFT_VAULT_ENCRYPTION_KEY;
  const versie = Number.parseInt(process.env.MICROSOFT_VAULT_KEY_VERSION ?? "1", 10);
  if (!waarde || !Number.isSafeInteger(versie) || versie < 1) throw new Error("Microsoft-tokenkluis is niet geconfigureerd.");
  const sleutel = Buffer.from(waarde, "base64");
  if (sleutel.length !== 32) throw new Error("Microsoft-tokenkluis heeft geen geldige AES-256-sleutel.");
  return { versie, sleutel };
}

export function versleutelMicrosoftGeheim(plaintext: string, aad: string): VersleuteldBlob {
  return versleutelMetMicrosoftSleutel(plaintext, aad, leesSleutel());
}

export function ontsleutelMicrosoftGeheim(blob: VersleuteldBlob, aad: string): string {
  return ontsleutelMetMicrosoftSleutel(blob, aad, leesSleutel());
}
