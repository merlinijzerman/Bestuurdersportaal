// ============================================================================
//  #504 — datumvelden in de generieke curatie-UI komen in de serveractie aan.
// ----------------------------------------------------------------------------
//  Productiesymptoom (Pensioenwet, 29-09-2026): documentdatum, geldig vanaf en
//  volgende review stonden zichtbaar in de invoervelden, maar opslaan gaf
//  "Geen wijzigingen." — de FormData droeg lege datums. Oorzaak: het formulier
//  verstuurde uitsluitend de React-state; een DOM-waarde die zonder React-
//  onChange in het veld kwam (React's value-tracker slikt een `input`-event na
//  een directe `el.value = …`-toewijzing, zoals autofill/extensies/automatisering
//  doen), bereikte de serveractie nooit. Deze tests leggen vast dat de
//  verzonden datum gelijk is aan wat de curator in het veld ziet.
// ============================================================================
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GeneriekeBibliotheekClient, {
  type GeneriekDocument,
} from "@/app/(platform)/platform/(beveiligd)/generieke-bibliotheek/_components/GeneriekeBibliotheekClient";
import { renderMetProviders } from "./render-met-providers";

const curatieBijwerken = vi.hoisted(() => vi.fn());

vi.mock("@/app/(platform)/platform/(beveiligd)/generieke-bibliotheek/acties", () => ({
  curatieBijwerken,
  curatieUploadUrl: vi.fn(),
  curatieAanmaken: vi.fn(),
  curatieVervangen: vi.fn(),
  curatieDepreceren: vi.fn(),
  curatieWithdrawn: vi.fn(),
  curatieHerpubliceren: vi.fn(),
  curatieVerwijderen: vi.fn(),
  curatieInzageUrl: vi.fn(),
  curatieHerindexeren: vi.fn(),
}));
vi.mock("@/core/lib/supabase", () => ({ createClient: vi.fn() }));

function pensioenwet(over: Partial<GeneriekDocument> = {}): GeneriekDocument {
  return {
    id: "a62e757b-9102-4ba3-ba6b-b33b21705fbd",
    titel: "Pensioenwet",
    bron: "Extern",
    bronorganisatie: "Overheid",
    extern_url: "https://wetten.overheid.nl/BWBR0020809",
    normgewicht: "bindend",
    documentdatum: null,
    geldig_vanaf: null,
    geldig_tot: null,
    status: "van_kracht",
    bronstatus: "actief",
    toepassingsgebied: null,
    regelingstype: "algemeen",
    doelgroep: null,
    thema: null,
    statusinterpretatie: null,
    documenttype: "wetgeving",
    wetsgeschiedenis_subtype: null,
    dossiernummer: null,
    wettelijk_regime: "pw",
    eigenaar: null,
    volgende_review: null,
    versie: null,
    verwerkingsstatus: "geindexeerd",
    paginas: null,
    opslag_pad: null,
    vervangen_door_document_id: null,
    vervangt_document_id: null,
    aangemaakt: null,
    ...over,
  };
}

function openBewerken(doc: GeneriekDocument) {
  renderMetProviders(
    <GeneriekeBibliotheekClient documenten={[doc]} aantalFondsen={3} magBeheren />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
}

const datumveld = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

async function slaOpEnLeesFormData(): Promise<FormData> {
  curatieBijwerken.mockResolvedValue({ ok: true, documentId: "x", bericht: "3 veld(en) bijgewerkt." });
  fireEvent.submit(screen.getByRole("button", { name: "Wijzigingen opslaan" }).closest("form")!);
  await waitFor(() => expect(curatieBijwerken).toHaveBeenCalledOnce());
  const [id, fd] = curatieBijwerken.mock.calls[0] as [string, FormData];
  expect(id).toBe("a62e757b-9102-4ba3-ba6b-b33b21705fbd");
  return fd;
}

// Zet een waarde zoals autofill/extensies/automatisering dat doen: via de
// eigen value-property van het element (die React's tracker bijwerkt), gevolgd
// door de gebruikelijke events. React's onChange vuurt dan níet.
function zetZonderReactOnChange(el: HTMLInputElement, waarde: string, events = true) {
  el.value = waarde;
  if (events) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

describe("#504 generieke curatie — datumvelden", () => {
  it("gewone invoer: de drie datums gaan mee naar curatieBijwerken", async () => {
    openBewerken(pensioenwet());
    fireEvent.change(datumveld("Documentdatum"), { target: { value: "2026-01-01" } });
    fireEvent.change(datumveld("Geldig vanaf"), { target: { value: "2026-01-01" } });
    fireEvent.change(datumveld("Volgende review"), { target: { value: "2026-12-15" } });
    fireEvent.change(screen.getByLabelText(/Reden van wijziging/), { target: { value: "Pilot" } });

    const fd = await slaOpEnLeesFormData();
    expect(fd.get("documentdatum")).toBe("2026-01-01");
    expect(fd.get("geldig_vanaf")).toBe("2026-01-01");
    expect(fd.get("volgende_review")).toBe("2026-12-15");
    expect(fd.get("reden")).toBe("Pilot");
  });

  it("KERN #504: zichtbare datum zonder React-onChange (input/change-event) wordt tóch verzonden", async () => {
    openBewerken(pensioenwet());
    fireEvent.change(screen.getByLabelText(/Reden van wijziging/), { target: { value: "Pilot" } });
    zetZonderReactOnChange(datumveld("Documentdatum"), "2026-01-01");
    zetZonderReactOnChange(datumveld("Geldig vanaf"), "2026-01-01");
    zetZonderReactOnChange(datumveld("Volgende review"), "2026-12-15");
    // Wat de curator ziet:
    expect(datumveld("Documentdatum").value).toBe("2026-01-01");

    const fd = await slaOpEnLeesFormData();
    expect(fd.get("documentdatum")).toBe("2026-01-01");
    expect(fd.get("geldig_vanaf")).toBe("2026-01-01");
    expect(fd.get("volgende_review")).toBe("2026-12-15");
  });

  it("KERN #504: een latere herrender wist de zichtbare datum niet meer", async () => {
    openBewerken(pensioenwet());
    zetZonderReactOnChange(datumveld("Documentdatum"), "2026-01-01");
    // Daarna nog een ander veld bewerken (herrendert het hele formulier).
    fireEvent.change(screen.getByLabelText(/Reden van wijziging/), { target: { value: "Pilot" } });
    expect(datumveld("Documentdatum").value).toBe("2026-01-01");

    const fd = await slaOpEnLeesFormData();
    expect(fd.get("documentdatum")).toBe("2026-01-01");
  });

  it("KERN #504: een DOM-waarde zonder enig event gaat bij opslaan mee (DOM = bron van waarheid)", async () => {
    openBewerken(pensioenwet());
    zetZonderReactOnChange(datumveld("Volgende review"), "2026-12-15", false);

    const fd = await slaOpEnLeesFormData();
    expect(fd.get("volgende_review")).toBe("2026-12-15");
  });

  it("bestaande datums worden voorgevuld en ongewijzigd teruggestuurd", async () => {
    openBewerken(
      pensioenwet({ documentdatum: "2026-01-01", geldig_vanaf: "2026-01-01", volgende_review: "2026-12-15" }),
    );
    expect(datumveld("Documentdatum").value).toBe("2026-01-01");

    const fd = await slaOpEnLeesFormData();
    expect(fd.get("documentdatum")).toBe("2026-01-01");
    expect(fd.get("geldig_vanaf")).toBe("2026-01-01");
    expect(fd.get("volgende_review")).toBe("2026-12-15");
  });

  it("leegmaken: een gewist datumveld wordt als lege waarde verzonden", async () => {
    openBewerken(
      pensioenwet({ documentdatum: "2026-01-01", geldig_vanaf: "2026-01-01", volgende_review: "2026-12-15" }),
    );
    fireEvent.change(datumveld("Volgende review"), { target: { value: "" } });

    const fd = await slaOpEnLeesFormData();
    expect(fd.get("volgende_review")).toBe("");
    expect(fd.get("documentdatum")).toBe("2026-01-01");
  });
});
