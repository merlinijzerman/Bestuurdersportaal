import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function decodeBase32(waarde) {
  const schoon = String(waarde).toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = "";
  for (const teken of schoon) {
    const index = BASE32.indexOf(teken);
    if (index < 0) throw new Error("Ongeldige base32-TOTP-secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function maakTotp(secret, { tijdMs = Date.now(), stapSeconden = 30, cijfers = 6 } = {}) {
  const teller = Math.floor(tijdMs / 1000 / stapSeconden);
  const bericht = Buffer.alloc(8);
  bericht.writeBigUInt64BE(BigInt(teller));
  const hmac = createHmac("sha1", decodeBase32(secret)).update(bericht).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** cijfers).padStart(cijfers, "0");
}
