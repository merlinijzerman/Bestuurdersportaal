#!/usr/bin/env python3
"""Genereer de PDF-fixtures voor ticket #354."""

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.colors import Color, HexColor, black, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "bibliotheek"
WIDTH, HEIGHT = A4
NAVY = HexColor("#17365D")
PALE_BLUE = HexColor("#EAF2F8")
GRAY = HexColor("#666666")


def wrap(text: str, font: str, size: float, max_width: float) -> list[str]:
    words = text.split()
    lines: list[str] = []
    line = ""
    for word in words:
        candidate = word if not line else line + " " + word
        if stringWidth(candidate, font, size) <= max_width:
            line = candidate
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def header(c: canvas.Canvas, title: str, code: str, page: int) -> float:
    c.setFillColor(white)
    c.setStrokeColor(white)
    c.setFont("Helvetica-Bold", 22)
    c.setFillColor(black)
    c.drawString(56, HEIGHT - 72, title)
    c.setFont("Helvetica-Bold", 8.5)
    c.setFillColor(GRAY)
    c.drawString(56, HEIGHT - 94, f"Fixture {code} | doel PGB Preview-pilot | eigenaar M365 pilotteam | herziening 10 december 2026")
    c.setFillColor(NAVY)
    c.rect(56, HEIGHT - 112, WIDTH - 112, 3, fill=1, stroke=0)
    c.setFont("Helvetica", 8)
    c.setFillColor(GRAY)
    c.drawCentredString(WIDTH / 2, 30, f"PGB Preview-pilot | synthetische fixture | {code} | pagina {page}")
    return HEIGHT - 145


def paragraph(c: canvas.Canvas, text: str, x: float, y: float, size: float = 10.5, leading: float = 15) -> float:
    c.setFillColor(black)
    c.setFont("Helvetica", size)
    for line in wrap(text, "Helvetica", size, WIDTH - x - 56):
        c.drawString(x, y, line)
        y -= leading
    return y - 8


def heading(c: canvas.Canvas, text: str, y: float, level: int = 1) -> float:
    size = 16 if level == 1 else 12.5
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", size)
    c.drawString(56, y, text)
    return y - (26 if level == 1 else 21)


def fact_box(c: canvas.Canvas, label: str, fact: str, y: float) -> float:
    lines = wrap(fact, "Helvetica", 10.5, WIDTH - 144)
    height = 34 + len(lines) * 15
    c.setFillColor(PALE_BLUE)
    c.roundRect(56, y - height + 10, WIDTH - 112, height, 4, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(70, y - 10, label)
    c.setFillColor(black)
    c.setFont("Helvetica", 10.5)
    line_y = y - 30
    for line in lines:
        c.drawString(70, line_y, line)
        line_y -= 15
    return y - height - 10


def create_searchable(path: Path, current: bool) -> None:
    code = "PGB354-PDF-001" if current else "PGB354-PDF-002"
    title = "Beleggingskader actueel" if current else "Beleggingskader vervallen"
    c = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    c.setTitle(title)
    c.setAuthor("M365 pilotteam")
    c.setSubject("Synthetische SharePoint-retrievalfixture voor de PGB Preview-pilot")
    unique_canary = "Maananker Actueel 61" if current else "Maananker Historisch 61"
    c.setKeywords(f"synthetisch testdata {code} {unique_canary}")

    y = header(c, title, code, 1)
    y = heading(c, "1 Status en afbakening", y)
    if current:
        y = paragraph(c, "Dit kader is de actuele synthetische bron voor de gedeelde term Maananker 61. De unieke canaryterm is Maananker Actueel 61. Het document vervangt de historische fixture PGB354-PDF-002 vanaf 1 september 2026.", 56, y)
        y = heading(c, "1.1 Gebruik in de acceptatietest", y, 2)
        paragraph(c, "Een vraag naar de actuele bandbreedte hoort dit document als primaire bron te gebruiken. De historische bron mag alleen als ondergeschikte context verschijnen.", 56, y)
    else:
        y = paragraph(c, "VERVALLEN PER 1 SEPTEMBER 2026. De unieke canaryterm is Maananker Historisch 61. Dit document blijft uitsluitend aanwezig om historische en actuele antwoorden van elkaar te onderscheiden.", 56, y)
        y = heading(c, "1.2 Historische bandbreedte", y, 2)
        y = fact_box(c, "HISTORISCH ANTWOORD", "De vervallen bandbreedte voor Maananker 61 was 28 tot en met 32 procent.", y)
        paragraph(c, "Deze waarde mag nooit het antwoord op een vraag naar de actuele bandbreedte vervangen.", 56, y)
    c.showPage()

    y = header(c, title, code, 2)
    if current:
        y = heading(c, "2 Actuele parameters", y)
        y = heading(c, "2.1 Bandbreedte", y, 2)
        y = fact_box(c, "VERWACHT ANTWOORD", "De actuele bandbreedte voor Maananker 61 is 34 tot en met 38 procent.", y)
        y = paragraph(c, "De gedeelde term Maananker 61 komt ook in de vervallen bron voor. De unieke canary Maananker Actueel 61 hoort alleen bij deze bron. Status en locator bepalen welk feit het antwoord draagt.", 56, y)
        y = heading(c, "2.2 Locatorcontrole", y, 2)
        paragraph(c, "De antwoorddragende passage staat in paragraaf 2.1 op pagina 2. De digitale tekstlaag moet selecteerbaar en doorzoekbaar zijn.", 56, y)
    else:
        y = heading(c, "2 Historische controle", y)
        y = paragraph(c, "De historische fixture deelt de term Maananker 61 met de actuele bron, maar heeft de unieke canary Maananker Historisch 61 en een andere waarde en status. Dit is bewust gedeeltelijk overlappende inhoud.", 56, y)
        y = heading(c, "2.1 Verwachte verwerking", y, 2)
        paragraph(c, "Retrieval mag deze bron terugvinden bij een expliciet historische vraag. Bij een actuele vraag krijgt PGB354-PDF-001 voorrang.", 56, y)
    c.showPage()

    if current:
        y = header(c, title, code, 3)
        y = heading(c, "3 Controlepunten", y)
        for index, text in enumerate(
            (
                "De lijst toont dit document onder 02 Beleid en reglementen.",
                "Preview toont alle drie pagina's.",
                "Een gerichte vraag citeert paragraaf 2.1 op pagina 2.",
                "Auditbewijs bevat geen Microsoft-identifiers of inhoud.",
            ),
            start=1,
        ):
            y = paragraph(c, f"{index}. {text}", 68, y)
        c.showPage()
    c.save()


def create_scan(path: Path) -> None:
    scale = 2
    image = Image.new("RGB", (int(WIDTH * scale), int(HEIGHT * scale)), "white")
    draw = ImageDraw.Draw(image)
    try:
        regular = ImageFont.truetype("/Library/Fonts/Arial.ttf", 28)
        bold = ImageFont.truetype("/Library/Fonts/Arial Bold.ttf", 42)
    except OSError:
        regular = ImageFont.load_default()
        bold = regular

    draw.text((110, 130), "Scan zonder tekstlaag", fill="black", font=bold)
    draw.text((110, 205), "Fixture PGB354-PDF-003", fill=(70, 70, 70), font=regular)
    draw.rectangle((110, 250, int(WIDTH * scale) - 110, 258), fill=(23, 54, 93))
    lines = [
        "Dit is een rasterafbeelding in een PDF.",
        "De PDF bevat bewust geen digitale tekstlaag.",
        "Canaryterm: Mistboei 93",
        "Verwachte retrievalcategorie: tekstlaag_ontbreekt",
        "Doel: PGB Preview-pilot",
        "Eigenaar: M365 pilotteam",
        "Herziening: 10 december 2026",
        "Alle inhoud is synthetische testdata.",
    ]
    y = 330
    for line in lines:
        draw.text((110, y), line, fill="black", font=regular)
        y += 58

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    buffer.seek(0)
    c = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    c.setTitle("Scan zonder tekstlaag")
    c.setAuthor("M365 pilotteam")
    c.drawImage(ImageReader(buffer), 0, 0, width=WIDTH, height=HEIGHT, mask="auto")
    c.showPage()
    c.save()


def main() -> None:
    current = LIBRARY / "02 Beleid en reglementen/PGB354-PDF-001-Beleggingskader-actueel.pdf"
    historic = LIBRARY / "03 Historisch en vervallen/PGB354-PDF-002-Beleggingskader-vervallen.pdf"
    scan = LIBRARY / "99 Mutatie- en intrekkingstests/PGB354-PDF-003-Scan-zonder-tekstlaag.pdf"
    for path in (current, historic, scan):
        path.parent.mkdir(parents=True, exist_ok=True)
    create_searchable(current, current=True)
    create_searchable(historic, current=False)
    create_scan(scan)


if __name__ == "__main__":
    main()
