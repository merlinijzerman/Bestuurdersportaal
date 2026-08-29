import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DocumentUploadModal from "@/core/components/DocumentUploadModal";
import { verwachtGeenErnstigeAxeBevindingen } from "./axe";
import { renderMetProviders } from "./render-met-providers";
import { uitgesteld } from "./uitgesteld";

const uploadDocument = vi.hoisted(() => vi.fn());

vi.mock("@/core/lib/document-upload-client", () => ({ uploadDocument }));

async function vulVerplichtFormulier(user: ReturnType<typeof renderMetProviders>["user"]) {
  const bestand = new File(["inhoud"], "beleidsnota.pdf", { type: "application/pdf" });
  await user.upload(screen.getByLabelText("Bestand"), bestand);
  await user.type(screen.getByLabelText("Titel"), "Beleidsnota 2026");
  const typeSelect = screen.getByLabelText(/Documenttype/);
  const eersteType = (typeSelect as HTMLSelectElement).options[1]?.value;
  expect(eersteType).toBeTruthy();
  await user.selectOptions(typeSelect, eersteType);
  return bestand;
}

describe("DocumentUploadModal", () => {
  it("uploadt geldige metadata en sluit na succes", async () => {
    uploadDocument.mockResolvedValue({ ok: true, document_id: "document-1" });
    const onUploaded = vi.fn();
    const onClose = vi.fn();
    const { user } = renderMetProviders(
      <DocumentUploadModal onUploaded={onUploaded} onClose={onClose} agendapuntId="agenda-1" />,
    );
    const bestand = await vulVerplichtFormulier(user);

    fireEvent.submit(screen.getByRole("button", { name: "Uploaden & indexeren" }).closest("form")!);

    await waitFor(() => expect(uploadDocument).toHaveBeenCalledOnce());
    expect(uploadDocument).toHaveBeenCalledWith(
      bestand,
      expect.objectContaining({
        titel: "Beleidsnota 2026",
        bron: "Intern",
        agendapunt_id: "agenda-1",
      }),
    );
    expect(onUploaded).toHaveBeenCalledWith({ ok: true, document_id: "document-1" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("toont de API-fout en houdt het venster open", async () => {
    uploadDocument.mockResolvedValue({ ok: false, error: "Bestand is te groot" });
    const onClose = vi.fn();
    const { user } = renderMetProviders(
      <DocumentUploadModal onUploaded={vi.fn()} onClose={onClose} />,
    );
    await vulVerplichtFormulier(user);

    fireEvent.submit(screen.getByRole("button", { name: "Uploaden & indexeren" }).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Bestand is te groot");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blokkeert dubbel submitten zolang de upload loopt", async () => {
    const antwoord = uitgesteld<{ ok: true; document_id: string }>();
    uploadDocument.mockReturnValueOnce(antwoord.promise);
    const onUploaded = vi.fn();
    const { user } = renderMetProviders(
      <DocumentUploadModal onUploaded={onUploaded} onClose={vi.fn()} />,
    );
    await vulVerplichtFormulier(user);

    fireEvent.submit(screen.getByRole("button", { name: "Uploaden & indexeren" }).closest("form")!);

    expect(screen.getByRole("button", { name: "Verwerken..." })).toBeDisabled();
    antwoord.resolve({ ok: true, document_id: "document-1" });
    await waitFor(() => expect(onUploaded).toHaveBeenCalledOnce());
  });

  it("start zonder bestand geen upload en is als dialoog axe-schoon", async () => {
    const onClose = vi.fn();
    const { user, container } = renderMetProviders(
      <DocumentUploadModal onUploaded={vi.fn()} onClose={onClose} />,
    );

    expect(screen.getByRole("dialog", { name: "Document uploaden" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Uploaden & indexeren" }));
    expect(uploadDocument).not.toHaveBeenCalled();

    const sluiten = screen.getByRole("button", { name: "Uploadvenster sluiten" });
    sluiten.focus();
    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledOnce();
    await verwachtGeenErnstigeAxeBevindingen(container);
  });
});
