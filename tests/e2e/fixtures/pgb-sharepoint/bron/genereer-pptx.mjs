import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const skillDir = "/Users/merlinijzerman/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations";
const runtimePython = "/Users/merlinijzerman/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const workspaceDir = process.cwd();
const fixtureRoot = path.join(workspaceDir, "tests/e2e/fixtures/pgb-sharepoint");
const buildDir = path.join(workspaceDir, ".artifacts-build/pgb-sharepoint/pptx");
const finalPath = path.join(
  fixtureRoot,
  "bibliotheek/01 Vergaderstukken/2026-10 Bestuursvergadering/PGB354-PPT-001-Kwartaalplanning-oktober.pptx",
);

await fs.mkdir(buildDir, { recursive: true });
await fs.mkdir(path.dirname(finalPath), { recursive: true });

const { resolvePresentationFont, finalizePresentation } = await import(
  pathToFileURL(path.join(skillDir, "container_tools/artifact_tool_utils.mjs")).href
);
const fontFamily = resolvePresentationFont();
const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });

const colors = {
  background: "#F7F8FA",
  navy: "#17365D",
  ink: "#15181D",
  muted: "#59636E",
  pale: "#EAF2F8",
};

function addText(slide, text, position, options = {}) {
  const box = slide.shapes.add({
    geometry: "textbox",
    position,
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  box.text = text;
  box.text.style = {
    typeface: fontFamily,
    fontSize: options.fontSize ?? 24,
    bold: options.bold ?? false,
    color: options.color ?? colors.ink,
    autoFit: "none",
  };
  return box;
}

function baseSlide() {
  const slide = deck.slides.add();
  slide.background.fill = colors.background;
  addText(
    slide,
    "PGB Preview-pilot  |  PGB354-PPT-001  |  synthetische fixture",
    { left: 72, top: 670, width: 1136, height: 24 },
    { fontSize: 13, color: colors.muted },
  );
  return slide;
}

{
  const slide = baseSlide();
  addText(
    slide,
    "Kwartaalplanning oktober",
    { left: 84, top: 150, width: 1112, height: 88 },
    { fontSize: 50, bold: true, color: colors.navy },
  );
  addText(
    slide,
    "Fixture voor lijst, preview, locator en fondsbrede retrieval",
    { left: 88, top: 260, width: 1070, height: 52 },
    { fontSize: 27, color: colors.ink },
  );
  addText(
    slide,
    "Doel PGB Preview-pilot\nEigenaar M365 pilotteam\nHerziening 10 december 2026",
    { left: 88, top: 390, width: 580, height: 130 },
    { fontSize: 20, color: colors.muted },
  );
  slide.speakerNotes.textFrame.setText(
    "Alle inhoud in deze presentatie is synthetische testdata en heeft geen betekenis buiten ticket 354.",
  );
}

{
  const slide = baseSlide();
  addText(slide, "Planning voor de acceptatieronde", { left: 72, top: 54, width: 1120, height: 66 }, { fontSize: 38, bold: true, color: colors.navy });
  addText(slide, "14 oktober 2026", { left: 92, top: 190, width: 300, height: 48 }, { fontSize: 28, bold: true });
  addText(slide, "Basisronde met lijst en preview", { left: 420, top: 190, width: 700, height: 48 }, { fontSize: 25 });
  addText(slide, "20 oktober 2026", { left: 92, top: 305, width: 300, height: 48 }, { fontSize: 28, bold: true });
  addText(slide, "Mutaties, versiecontrole en rechtenproef", { left: 420, top: 305, width: 700, height: 48 }, { fontSize: 25 });
  addText(slide, "23 oktober 2026", { left: 92, top: 420, width: 300, height: 48 }, { fontSize: 28, bold: true });
  addText(slide, "Oefenbesluit en volledige reset", { left: 420, top: 420, width: 700, height: 48 }, { fontSize: 25 });
  slide.speakerNotes.textFrame.setText("De data zijn uitsluitend ontworpen voor reproduceerbare acceptatietests.");
}

{
  const slide = baseSlide();
  addText(slide, "Oefenbesluit IJsvogelkompas 73", { left: 72, top: 54, width: 1136, height: 66 }, { fontSize: 38, bold: true, color: colors.navy });
  addText(slide, "Verwacht antwoordfeit", { left: 92, top: 190, width: 460, height: 42 }, { fontSize: 22, bold: true, color: colors.muted });
  addText(
    slide,
    "Het oefenbesluit voor IJsvogelkompas 73 staat gepland op 23 oktober 2026.",
    { left: 92, top: 250, width: 1040, height: 150 },
    { fontSize: 34, bold: true, color: colors.ink },
  );
  addText(
    slide,
    "Verwachte locator: dia 3. Een fondsbrede vraag combineert dit feit met Koraalmaat 47 uit PGB354-DOC-001.",
    { left: 92, top: 455, width: 1050, height: 90 },
    { fontSize: 21, color: colors.muted },
  );
  slide.speakerNotes.textFrame.setText("Canaryterm IJsvogelkompas 73. Verwachte broncode PGB354-PPT-001.");
}

{
  const slide = baseSlide();
  addText(slide, "Controlepunten", { left: 72, top: 54, width: 1136, height: 66 }, { fontSize: 38, bold: true, color: colors.navy });
  const items = [
    "De presentatie staat in de vergadering van oktober.",
    "Preview opent alle vier dia's.",
    "Retrieval verwijst voor het antwoordfeit naar dia 3.",
    "Auditbewijs bevat geen inhoud, URL of Microsoft-identifiers.",
  ];
  items.forEach((item, index) => {
    addText(slide, String(index + 1).padStart(2, "0"), { left: 92, top: 168 + index * 100, width: 70, height: 42 }, { fontSize: 25, bold: true, color: colors.navy });
    addText(slide, item, { left: 180, top: 168 + index * 100, width: 970, height: 64 }, { fontSize: 24 });
  });
  slide.speakerNotes.textFrame.setText("Controlelijst voor de PGB Preview-pilot.");
}

const stagingDir = path.join(buildDir, "finalizer");
await fs.mkdir(stagingDir, { recursive: true });
const candidatePath = path.join(stagingDir, "candidate.pptx");
await (await PresentationFile.exportPptx(deck)).save(candidatePath);

await finalizePresentation({
  workspaceDir,
  candidatePath,
  finalPath,
  pythonExecutable: runtimePython,
  integrityValidatorPath: path.join(skillDir, "container_tools/inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(skillDir, "container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs: [
    "--expected-slide-size-emu",
    "12192000,6858000",
    "--validate-bullet-geometry",
    "--validate-heading-fit",
  ],
  explicitTotalSlideCount: 4,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [],
  fontPolicy: { basis: "design", families: [fontFamily] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(stagingDir, "PGB354-PPT-001.validation.json"),
});

console.log(`Gegenereerd: ${finalPath}`);
