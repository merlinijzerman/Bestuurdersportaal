import type { VersleuteldBlob } from "@/core/lib/microsoft-crypto";

export type MicrosoftCacheDatabaseRij = {
  verbinding_id: string;
  versie: number;
  sleutel_versie: number;
  iv: string;
  tag: string;
  ciphertext: string;
};

export type MicrosoftCache = {
  verbinding_id: string;
  versie: number;
} & VersleuteldBlob;

export function normaliseerMicrosoftCacheRij(rij: MicrosoftCacheDatabaseRij | undefined): MicrosoftCache | undefined {
  if (!rij) return undefined;
  return {
    verbinding_id: rij.verbinding_id,
    versie: rij.versie,
    sleutelVersie: rij.sleutel_versie,
    iv: rij.iv,
    tag: rij.tag,
    ciphertext: rij.ciphertext,
  };
}

export function normaliseerPostgresDatum(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // node-postgres maakt van een SQL date lokale middernacht. Gebruik daarom
    // bewust lokale datumdelen; UTC-conversie kan de kalenderdag verschuiven.
    const jaar = String(value.getFullYear()).padStart(4, "0");
    const maand = String(value.getMonth() + 1).padStart(2, "0");
    const dag = String(value.getDate()).padStart(2, "0");
    return `${jaar}-${maand}-${dag}`;
  }
  throw new Error("ongeldige_postgres_datum");
}
