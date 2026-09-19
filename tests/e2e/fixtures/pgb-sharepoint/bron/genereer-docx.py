#!/usr/bin/env python3
"""Genereer de Word-fixtures voor ticket #354.

Gebruik de gebundelde Codex-Pythonruntime. De binaire uitvoer wordt in Git gepind;
dit script is de leesbare bron waarmee de inhoud gecontroleerd kan worden.
"""

import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "bibliotheek"
MUTATIONS = ROOT / "mutaties"
BLACK = RGBColor(0, 0, 0)
NAVY = "17365D"
PALE_BLUE = "EAF2F8"
LIGHT_GRAY = "D9D9D9"


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_borders(cell) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = "w:" + edge
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "4")
        element.set(qn("w:color"), LIGHT_GRAY)


def configure(doc: Document, code: str, title: str) -> None:
    section = doc.sections[0]
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(1.8)
    section.left_margin = Cm(2.2)
    section.right_margin = Cm(2.2)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Liberation Sans"
    normal._element.rPr.rFonts.set(qn("w:ascii"), "Liberation Sans")
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Liberation Sans")
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(7)
    normal.paragraph_format.line_spacing = 1.12

    for name, size in (("Title", 24), ("Heading 1", 17), ("Heading 2", 13)):
        style = styles[name]
        style.font.name = "Liberation Sans"
        style._element.rPr.rFonts.set(qn("w:ascii"), "Liberation Sans")
        style._element.rPr.rFonts.set(qn("w:hAnsi"), "Liberation Sans")
        style.font.size = Pt(size)
        style.font.color.rgb = BLACK
        style.font.bold = True
        style.paragraph_format.space_before = Pt(12)
        style.paragraph_format.space_after = Pt(6)
        if name == "Title":
            style_paragraph_properties = style._element.get_or_add_pPr()
            paragraph_borders = style_paragraph_properties.find(qn("w:pBdr"))
            if paragraph_borders is not None:
                style_paragraph_properties.remove(paragraph_borders)

    props = doc.core_properties
    props.title = title
    props.subject = "Synthetische SharePoint-retrievalfixture voor de PGB Preview-pilot"
    props.author = "M365 pilotteam"
    props.last_modified_by = "M365 pilotteam"
    props.category = "PGB Preview-pilot"
    props.keywords = f"synthetisch, testdata, {code}"
    props.comments = "Uitsluitend testdata; geen klantinformatie of persoonsgegevens."

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = footer.add_run(f"PGB Preview-pilot  |  synthetische fixture  |  {code}")
    run.font.name = "Liberation Sans"
    run.font.size = Pt(8)
    run.font.color.rgb = RGBColor(90, 90, 90)


def add_title(doc: Document, title: str, code: str) -> None:
    paragraph = doc.add_paragraph(style="Title")
    paragraph.add_run(title)
    subtitle = doc.add_paragraph()
    subtitle.paragraph_format.space_after = Pt(14)
    run = subtitle.add_run(f"Fixture {code}  |  doel PGB Preview-pilot  |  eigenaar M365 pilotteam  |  herziening 10 december 2026")
    run.bold = True
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(70, 70, 70)
    warning = doc.add_paragraph()
    warning.add_run("Dit document bevat uitsluitend synthetische testgegevens.").bold = True
    warning.add_run(" De termen en feiten hebben geen betekenis buiten de acceptatietest.")


def add_metadata_table(doc: Document, rows: list[tuple[str, str]]) -> None:
    table = doc.add_table(rows=1, cols=2)
    table.autofit = False
    table.columns[0].width = Cm(4.3)
    table.columns[1].width = Cm(11.4)
    hdr = table.rows[0].cells
    hdr[0].text = "Veld"
    hdr[1].text = "Waarde"
    for cell in hdr:
        set_cell_shading(cell, NAVY)
        set_cell_borders(cell)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        for run in cell.paragraphs[0].runs:
            run.font.color.rgb = RGBColor(255, 255, 255)
            run.bold = True
    for index, (label, value) in enumerate(rows):
        cells = table.add_row().cells
        cells[0].text = label
        cells[1].text = value
        for cell in cells:
            set_cell_borders(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if index % 2:
                set_cell_shading(cell, PALE_BLUE)
        cells[0].paragraphs[0].runs[0].bold = True
    doc.add_paragraph()


def save(doc: Document, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)


def make_doc_001() -> None:
    code = "PGB354-DOC-001"
    if not _gevraagd(code):
        return
    doc = Document()
    configure(doc, code, "Agenda en besluitpunten september")
    add_title(doc, "Agenda en besluitpunten september", code)
    doc.add_heading("1 Doel van de vergadering", level=1)
    doc.add_paragraph(
        "De vergadering gebruikt vier oefenonderwerpen om lijstweergave, preview en bronlocators te controleren. "
        "Alle bedragen, data en termen zijn verzonnen."
    )
    add_metadata_table(
        doc,
        [
            ("Vergadermaand", "september 2026"),
            ("Documentstatus", "actueel"),
            ("Openbaarheid", "algemene testgebruikers"),
            ("Canaryterm", "Koraalmaat 47"),
        ],
    )
    doc.add_heading("1.1 Agenda", level=2)
    for item in (
        "Opening en controle van de testrollen",
        "Bespreking van het oefenonderwerp Koraalmaat 47",
        "Vastlegging van de hersteltermijn",
        "Afsluiting van de acceptatieronde",
    ):
        doc.add_paragraph(item, style="List Number")

    doc.add_page_break()
    doc.add_heading("2 Bekende feiten voor retrieval", level=1)
    doc.add_heading("2.1 Afbakening", level=2)
    doc.add_paragraph(
        "Koraalmaat 47 is een unieke canaryterm. Een zoekresultaat op deze term hoort uitsluitend naar deze fixture te verwijzen."
    )
    doc.add_heading("2.2 Hersteltermijn", level=2)
    fact = doc.add_paragraph()
    fact.add_run("Verwacht antwoordfeit. ").bold = True
    fact.add_run("De hersteltermijn voor Koraalmaat 47 is vier werkdagen.")
    doc.add_paragraph(
        "De termijn begint in deze synthetische casus op de eerste werkdag na registratie. Weekenden tellen niet mee. "
        "Deze toelichting test of de locator bij de antwoorddragende passage blijft."
    )
    add_metadata_table(
        doc,
        [
            ("Vraag", "Welke hersteltermijn geldt voor Koraalmaat 47?"),
            ("Antwoord", "vier werkdagen"),
            ("Locator", "sectie 2.2, pagina 2"),
        ],
    )

    doc.add_page_break()
    doc.add_heading("3 Controlelijst", level=1)
    doc.add_paragraph(
        "Deze pagina maakt passage- en paginacontrole over meerdere pagina's reproduceerbaar. De antwoorddragende passage staat bewust niet op de titelpagina."
    )
    for item in (
        "De lijst toont de bestandsnaam en map.",
        "De browserpreview opent zonder inhoud op te slaan.",
        "De retrieval verwijst naar sectie 2.2 op pagina 2.",
        "De audit bevat alleen fixturecode, categorie, timing, versie-indicator en tellingen.",
    ):
        doc.add_paragraph(item, style="List Bullet")
    save(doc, LIBRARY / "01 Vergaderstukken/2026-09 Bestuursvergadering/PGB354-DOC-001-Agenda-en-besluitpunten-september.docx")


def make_simple_doc(code: str, title: str, heading: str, fact: str, canary: str, filename: str, folder: str) -> None:
    if not _gevraagd(code):
        return
    doc = Document()
    configure(doc, code, title)
    add_title(doc, title, code)
    doc.add_heading("1 " + heading, level=1)
    paragraph = doc.add_paragraph()
    paragraph.add_run("Verwacht antwoordfeit. ").bold = True
    paragraph.add_run(fact)
    doc.add_paragraph(
        f"De canaryterm {canary} identificeert uitsluitend fixture {code}. Gebruik deze tekst niet als echte beleidsinformatie."
    )
    add_metadata_table(
        doc,
        [
            ("Fixturecode", code),
            ("Canaryterm", canary),
            ("Status", "actueel"),
            ("Doel", "PGB Preview-pilot"),
        ],
    )
    save(doc, LIBRARY / folder / filename)


def add_semantic_title(doc: Document, title: str, code: str) -> None:
    """Eigen kop voor de #407-fixtures.

    De gedeelde add_title schrijft "... hebben geen betekenis ..." in de body.
    Het woord "geen" bevat de letterreeks "een", en de lexicale passagekeuze
    van de spike toetst met includes() in plaats van op hele woorden. Die ene
    zin zou dus al lexicale score opleveren voor SEM01. Daarom een eigen,
    woordbewuste variant; de contaminatieguard bewaakt dat dit zo blijft.
    """
    paragraph = doc.add_paragraph(style="Title")
    paragraph.add_run(title)
    subtitle = doc.add_paragraph()
    subtitle.paragraph_format.space_after = Pt(14)
    run = subtitle.add_run(f"Fixture {code}  |  reeks PGB Preview-pilot  |  eigenaar M365 pilotteam")
    run.bold = True
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(70, 70, 70)
    warning = doc.add_paragraph()
    warning.add_run("Dit document bevat uitsluitend fictieve testgegevens.").bold = True
    warning.add_run(" Alle cijfers, namen en uitspraken zijn bedacht.")


def make_semantic_doc(
    code: str,
    title: str,
    canary: str,
    kader_kop: str,
    feit_kop: str,
    fact: str,
    toelichting: str,
    filename: str,
    folder: str,
) -> None:
    """#407 — semantische fixture.

    Twee harde eisen, bewaakt door de contaminatieguard in de spikesuite:

    1. de volledige body deelt GEEN token met de vaste vergelijkingsscenario's
       (S02, S03, S04, S04H, SEM01, SEM02), stopwoorden meegerekend. Daardoor
       kan de lexicale arm hier niet kunstmatig scoren;
    2. er staat nergens een vraagregel in het document. De gedeelde
       make_simple_doc schrijft wel zo'n metadatatabel; die is hier bewust
       niet hergebruikt.

    De canaryterm dient uitsluitend als indexgereedheidsprobe en mag daarom in
    geen enkele scenariovraag of zoekterm voorkomen.
    """
    if not _gevraagd(code):
        return
    doc = Document()
    configure(doc, code, title)
    add_semantic_title(doc, title, code)

    doc.add_heading("1 Doel van dit dossier", level=1)
    doc.add_paragraph(
        "Deze notitie dient als oefenmateriaal binnen de fictieve PGB-bibliotheek. "
        "Alle bedragen, namen en afspraken zijn bedacht."
    )

    doc.add_heading("2 " + kader_kop, level=1)
    doc.add_heading("2.1 Afbakening", level=2)
    doc.add_paragraph(
        f"{canary} dient enkel als indexcontrole. Deze aanduiding hoort nergens in vraagstelling terug te keren."
    )

    doc.add_heading("2.2 " + feit_kop, level=2)
    paragraph = doc.add_paragraph()
    paragraph.add_run("Verwacht antwoordfeit. ").bold = True
    paragraph.add_run(fact)
    doc.add_paragraph(toelichting)

    add_metadata_table(
        doc,
        [
            ("Fixturecode", code),
            ("Canaryterm", canary),
            ("Reeks", "PGB Preview-pilot"),
            ("Soort", "semantische proef"),
        ],
    )
    save(doc, LIBRARY / folder / filename)


def make_doc_004(path: Path, version: str, fact: str) -> None:
    code = "PGB354-DOC-004"
    if not _gevraagd(code):
        return
    doc = Document()
    configure(doc, code, "Inhoudsmutatie")
    add_title(doc, "Inhoudsmutatie", code)
    doc.add_heading("1 Controlevenster", level=1)
    paragraph = doc.add_paragraph()
    paragraph.add_run(f"Versie {version}. ").bold = True
    paragraph.add_run(fact)
    doc.add_paragraph(
        "Vervang bij scenario S07 de inhoud van hetzelfde SharePoint-item. Upload geen tweede item. "
        "Controleer daarna dat eTag en cTag zijn veranderd en dat retrieval uitsluitend dit versiefait teruggeeft."
    )
    add_metadata_table(
        doc,
        [
            ("Fixturecode", code),
            ("Canaryterm", "Bronzenveer 52"),
            ("Bestandsversie", version),
            ("Doel", "PGB Preview-pilot"),
        ],
    )
    save(doc, path)


BEKENDE_FIXTURECODES = (
    "PGB354-DOC-001",
    "PGB354-DOC-002",
    "PGB354-DOC-003",
    "PGB354-DOC-004",
    "PGB354-DOC-005",
    "PGB407-DOC-101",
    "PGB407-DOC-102",
)

# Standaard draait alles. main() vernauwt dit na validatie van --only.
_GEVRAAGDE_CODES: tuple[str, ...] = BEKENDE_FIXTURECODES


def bepaal_gevraagde_codes(argv: list[str]) -> tuple[str, ...]:
    """Valideer --only FAIL-CLOSED en lever de exacte set codes die mag draaien.

    Zonder --only draait alles. Met --only moet er een bruikbare waarde staan:
    een ontbrekende, lege of onbekende waarde stopt het script met een foutmelding en een exitcode ongelijk 0
    en schrijft geen enkel bestand. Dat is bewust streng — de vorige versie viel
    in al die gevallen terug op "draai alles", en juist dán herschrijft de
    generator de gepinde bestanden die je met --only wilde ontzien.

        python3 genereer-docx.py                # alles
        python3 genereer-docx.py --only PGB407  # alleen de #407-fixtures
        python3 genereer-docx.py --only=PGB354-DOC-001
    """
    prefixen: list[str] = []
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg.startswith("--only="):
            prefixen.append(arg[len("--only="):])
        elif arg == "--only":
            volgende = argv[index + 1] if index + 1 < len(argv) else None
            if volgende is None or volgende.startswith("-"):
                raise SystemExit("fout: --only vereist een waarde, bijvoorbeeld --only PGB407")
            prefixen.append(volgende)
            index += 1
        else:
            raise SystemExit(f"fout: onbekend argument {arg!r}; gebruik --only <prefix>")
        index += 1

    if not prefixen:
        return BEKENDE_FIXTURECODES

    gekozen: list[str] = []
    for prefix in prefixen:
        if not prefix.strip():
            raise SystemExit("fout: --only vereist een niet-lege waarde")
        treffers = [code for code in BEKENDE_FIXTURECODES if code.startswith(prefix)]
        if not treffers:
            raise SystemExit(
                f"fout: --only {prefix!r} past op geen enkele fixturecode; "
                f"bekend zijn {', '.join(BEKENDE_FIXTURECODES)}"
            )
        gekozen.extend(treffers)
    return tuple(dict.fromkeys(gekozen))


def _gevraagd(code: str) -> bool:
    """Draait deze fixture in deze aanroep mee?

    python-docx schrijft een tijdstempel in docProps, dus twee runs leveren
    nooit bit-identieke bytes. De binaire uitvoer is in Git gepind en de
    manifestguard bewaakt die pins. Een kale run herschrijft daardoor ook de
    bestaande bestanden en laat hun hashes driften terwijl er inhoudelijk niets
    verandert. Gebruik daarom --only zodra je één fixture bijwerkt, en
    regenereer daarna uitsluitend de gewijzigde checksumregels.
    """
    if code not in BEKENDE_FIXTURECODES:
        raise SystemExit(f"fout: onbekende fixturecode {code!r} in de generator")
    return code in _GEVRAAGDE_CODES


def main() -> None:
    global _GEVRAAGDE_CODES
    # Eerst valideren, dan pas schrijven: een ongeldige --only mag nooit een
    # half-gegenereerde bibliotheek achterlaten.
    _GEVRAAGDE_CODES = bepaal_gevraagde_codes(sys.argv[1:])
    make_doc_001()
    make_simple_doc(
        "PGB354-DOC-002",
        "Besloten voorbereidingsnotitie",
        "Oefenquorum",
        "Het oefenquorum voor Saffierhek 29 is vijf teststemmen.",
        "Saffierhek 29",
        "PGB354-DOC-002-Besloten-voorbereidingsnotitie.docx",
        "04 Beperkt bestuur",
    )
    make_simple_doc(
        "PGB354-DOC-003",
        "Hernoem en verplaatsproef",
        "Controledag",
        "De controledag voor Duinglas 84 is woensdag.",
        "Duinglas 84",
        "PGB354-DOC-003-Hernoem-en-verplaatsproef.docx",
        "99 Mutatie- en intrekkingstests",
    )
    make_doc_004(
        LIBRARY / "99 Mutatie- en intrekkingstests/PGB354-DOC-004-Inhoudsmutatie.docx",
        "1",
        "In de beginstaat valt het controlevenster voor Bronzenveer 52 op donderdag om 09.20 uur.",
    )
    make_doc_004(
        MUTATIONS / "PGB354-DOC-004-Inhoudsmutatie-v2.docx",
        "2",
        "Na de mutatie valt het controlevenster voor Bronzenveer 52 op vrijdag om 10.35 uur.",
    )
    make_semantic_doc(
        "PGB407-DOC-101",
        "Zandloperbaken 12 hersteldossier",
        "Zandloperbaken 12",
        "Fictief herstelkader",
        "Hersteldoorloop",
        "Bij vastgestelde onderdekking beschikt dit fonds over negen kalenderdagen om herstel volledig af te ronden.",
        "Deze doorloop start op de eerstvolgende bankwerkdag na vaststelling. Zaterdag en zondag tellen niet mee.",
        "PGB407-DOC-101-Zandloperbaken-hersteldossier.docx",
        "02 Beleid en reglementen",
    )
    make_semantic_doc(
        "PGB407-DOC-102",
        "Nevelanker 30 zittingsdossier",
        "Nevelanker 30",
        "Fictief zittingskader",
        "Zittingsmoment",
        "Op 12 november 2026 verzamelt dit college zich ter definitieve goedkeuring van deze oefenuitspraak.",
        "Deze zitting rondt de proefronde af. Latere aanpassingen vallen buiten dit dossier.",
        "PGB407-DOC-102-Nevelanker-zittingsdossier.docx",
        "02 Beleid en reglementen",
    )
    make_simple_doc(
        "PGB354-DOC-005",
        "Intrekkingsproef",
        "Afkaptijd",
        "De synthetische afkaptijd voor Nachtlelie 68 is 17.40 uur.",
        "Nachtlelie 68",
        "PGB354-DOC-005-Intrekkingsproef.docx",
        "04 Beperkt bestuur",
    )


if __name__ == "__main__":
    main()
