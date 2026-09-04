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
