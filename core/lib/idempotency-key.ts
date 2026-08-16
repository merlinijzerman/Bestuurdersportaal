// Client-side idempotentie voor kostendragende gebruikersacties.
//
// Eén context hoort bij één logische actie. Een eventuele transportretry gebruikt
// opnieuw `headers()` op dezelfde context en behoudt zo dezelfde sleutel. Een
// nieuwe gebruikersactie maakt een nieuwe context en krijgt dus een nieuwe sleutel.

type UUIDBron = () => string;

export interface IdempotentVerzoek {
  sleutel: string;
  headers: (basis?: HeadersInit) => Headers;
}

export function maakIdempotentVerzoek(
  uuidBron: UUIDBron = () => globalThis.crypto.randomUUID()
): IdempotentVerzoek {
  const sleutel = uuidBron();

  return {
    sleutel,
    headers(basis?: HeadersInit) {
      const headers = new Headers(basis);
      headers.set("Idempotency-Key", sleutel);
      return headers;
    },
  };
}
