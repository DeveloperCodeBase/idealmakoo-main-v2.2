#!/usr/bin/env python3
"""Build the Persian release documents from the checked-in, reviewed Markdown.

Authoring-only dependency: python-docx. Runtime deployment does not execute this
script. Render the resulting DOCX files with LibreOffice before distribution.
"""
from pathlib import Path
import argparse
import re

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[1]
FONT = 'DejaVu Sans'
ROLES = ['superAdmin', 'admin', 'contentEditor', 'productManager',
         'scientificReviewer', 'translator', 'publisher', 'hr', 'business',
         'analyst', 'support', 'customer']


def element(parent, name, **attrs):
    item = OxmlElement(name)
    for key, value in attrs.items():
        item.set(qn(key), str(value))
    parent.append(item)
    return item


def font(run, size=None, bold=None, latin=False):
    run.font.name = 'DejaVu Sans Mono' if latin else FONT
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    props = run._r.get_or_add_rPr()
    fonts = props.find(qn('w:rFonts'))
    if fonts is None:
        fonts = element(props, 'w:rFonts')
    for name in ['ascii', 'hAnsi', 'cs', 'eastAsia']:
        fonts.set(qn('w:' + name), 'DejaVu Sans Mono' if latin else FONT)
    element(props, 'w:rtl', **{'w:val': '0' if latin else '1'})
    element(props, 'w:iCs', **{'w:val': '0'})
    element(props, 'w:lang', **{'w:val': 'fa-IR', 'w:bidi': 'fa-IR'})
    if size is not None:
        element(props, 'w:szCs', **{'w:val': round(size * 2)})


def rtl(paragraph, align=WD_ALIGN_PARAGRAPH.RIGHT):
    paragraph.alignment = align
    props = paragraph._p.get_or_add_pPr()
    # Logical start aligns to the right in RTL in Word and LibreOffice. The
    # legacy physical 'right' value is mirrored by some bidi importers.
    if align == WD_ALIGN_PARAGRAPH.RIGHT:
        props.find(qn('w:jc')).set(qn('w:val'), 'start')
    if props.find(qn('w:bidi')) is None:
        element(props, 'w:bidi', **{'w:val': '1'})
    paragraph.paragraph_format.widow_control = True


def inline(paragraph, text, size=None, bold=None):
    # Plain labels for local documentation links work in a standalone DOCX too.
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)',
                  lambda m: m[1] + (' (' + m[2] + ')' if m[2].startswith('http') else ''), text)
    for part in re.split(r'(`[^`]+`|\*\*[^*]+\*\*)', text):
        if not part:
            continue
        mono = part.startswith('`') and part.endswith('`')
        strong = part.startswith('**') and part.endswith('**')
        value = part[1:-1] if mono else part[2:-2] if strong else part
        run = paragraph.add_run(value)
        font(run, (min(size or 10.5, 9) if mono else size),
             strong if strong else bold, latin=mono)
    rtl(paragraph)


def base(title, subtitle):
    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Inches(8.5), Inches(11)
    section.left_margin = section.right_margin = Inches(.72)
    section.top_margin = Inches(.64)
    section.bottom_margin = Inches(.68)
    section.footer_distance = Inches(.25)
    styles = doc.styles
    for style in styles:
        for border in style.element.findall('.//' + qn('w:pBdr')):
            border.getparent().remove(border)
    for name in ['Normal', 'Body Text', 'Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Heading 3']:
        style = styles[name]
        style.font.name = FONT
        style.font.color.rgb = RGBColor(0, 0, 0)
        style.font.italic = False
        style.font.size = Pt(10.5)
        style.paragraph_format.space_after = Pt(5)
        style.paragraph_format.line_spacing = 1.12
        props = style.element.get_or_add_rPr()
        element(props, 'w:rFonts', **{'w:ascii': FONT, 'w:hAnsi': FONT, 'w:cs': FONT})
        element(props, 'w:szCs', **{'w:val': '21'})
        element(props, 'w:iCs', **{'w:val': '0'})
    for name, size in [('Title', 25), ('Subtitle', 13), ('Heading 1', 18), ('Heading 2', 14), ('Heading 3', 12)]:
        style = styles[name]
        style.font.size = Pt(size)
        style.font.bold = name != 'Subtitle'
        style.paragraph_format.space_before = Pt(15 if name.startswith('Heading') else 0)
        style.paragraph_format.space_after = Pt(8)
        style.paragraph_format.keep_with_next = True
        element(style.element.get_or_add_rPr(), 'w:szCs', **{'w:val': str(size * 2)})
    p = doc.add_paragraph(style='Title'); inline(p, title, size=25, bold=True)
    p = doc.add_paragraph(style='Subtitle'); inline(p, subtitle, size=13)
    p = doc.add_paragraph(); inline(p, 'ایده‌آل ماکو | نسخهٔ ۲٫۲٫۰ | ۲۶ اکتبر ۲۰۲۶')
    footer = section.footer.paragraphs[0]
    rtl(footer, WD_ALIGN_PARAGRAPH.CENTER)
    font(footer.add_run('ایده‌آل ماکو ۲٫۲  •  '), 8)
    field = element(footer._p, 'w:fldSimple', **{'w:instr': 'PAGE'})
    run = element(field, 'w:r'); element(run, 'w:t').text = '1'
    doc.core_properties.author = 'Ideal Makoo'
    doc.core_properties.title = title
    doc.core_properties.subject = subtitle
    doc.core_properties.language = 'fa-IR'
    doc.core_properties.keywords = 'Ideal Makoo, 2.2.0, Persian'
    return doc


def add_table(doc, rows):
    table = doc.add_table(rows=1, cols=len(rows[0]))
    table.autofit = False
    props = table._tbl.tblPr
    element(props, 'w:bidiVisual', **{'w:val': '1'})
    borders = element(props, 'w:tblBorders')
    for edge in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
        element(borders, 'w:' + edge, **{'w:val': 'single', 'w:sz': '4', 'w:color': 'CDD9E1'})
    margins = element(props, 'w:tblCellMar')
    for side in ['top', 'left', 'bottom', 'right']:
        element(margins, 'w:' + side, **{'w:w': '95', 'w:type': 'dxa'})
    widths = [2.0, 5.04] if len(rows[0]) == 2 else [1.30, 2.68, 3.06] if len(rows[0]) == 3 else [7.04 / len(rows[0])] * len(rows[0])
    for column, width in zip(table.columns, widths):
        column.width = Inches(width)
    for index, values in enumerate(rows):
        row = table.rows[0] if index == 0 else table.add_row()
        trprops = row._tr.get_or_add_trPr()
        element(trprops, 'w:cantSplit')
        if index == 0:
            element(trprops, 'w:tblHeader')
        for cell, value, width in zip(row.cells, values, widths):
            cell.width = Inches(width)
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(2)
            paragraph.paragraph_format.line_spacing = 1.08
            inline(paragraph, value, size=9.4, bold=index == 0)
            if index == 0:
                element(cell._tc.get_or_add_tcPr(), 'w:shd', **{'w:fill': 'E8F0F5'})
    doc.add_paragraph().paragraph_format.space_after = Pt(1)


def markdown(doc, path, first_title=True, images=True):
    lines = path.read_text(encoding='utf8').splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip(); i += 1
        if not line:
            continue
        if line.startswith('```'):
            code = []
            while i < len(lines) and not lines[i].startswith('```'):
                code.append(lines[i]); i += 1
            i += 1
            for source in code:
                p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.LEFT
                p.paragraph_format.space_after = Pt(1)
                p.paragraph_format.line_spacing = 1.0
                p.paragraph_format.left_indent = Inches(.08)
                font(p.add_run(source), 8.4, latin=True)
                element(p._p.get_or_add_pPr(), 'w:shd', **{'w:fill': 'F3F6F8'})
            continue
        if line.startswith('|'):
            block = [line]
            while i < len(lines) and lines[i].strip().startswith('|'):
                block.append(lines[i].strip()); i += 1
            rows = []
            for row in block:
                cells = [cell.strip() for cell in row.strip('|').split('|')]
                if all(re.fullmatch(r'[:\s-]+', cell) for cell in cells):
                    continue
                rows.append(cells)
            add_table(doc, rows)
            continue
        image = re.fullmatch(r'!\[([^\]]*)\]\(([^)]+)\)', line)
        if image:
            if images:
                target = (path.parent / image[2]).resolve()
                if not target.is_file():
                    raise FileNotFoundError(target)
                p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.space_before = Pt(7)
                p.paragraph_format.space_after = Pt(4)
                p.paragraph_format.keep_with_next = True
                shape = p.add_run().add_picture(str(target), width=Inches(6.75))
                shape._inline.docPr.set('descr', image[1])
            continue
        heading = re.match(r'^(#{1,6})\s+(.*)', line)
        if heading:
            level = min(len(heading[1]), 3)
            if level == 1 and not first_title:
                continue
            p = doc.add_paragraph(style='Heading ' + str(level))
            inline(p, heading[2], size={1:18, 2:14, 3:12}[level], bold=True)
            continue
        p = doc.add_paragraph()
        if line.startswith('- '):
            p.paragraph_format.right_indent = Inches(.12)
            inline(p, '• ' + line[2:])
        else:
            inline(p, line)
        if line == 'نمونهٔ درخواست مناسب:':
            p.paragraph_format.keep_with_next = True
        if line.startswith('شکل '):
            p.paragraph_format.space_after = Pt(10)
            for run in p.runs:
                font(run, 8.5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, default=ROOT.parent / 'deliverables')
    parser.add_argument('--only', choices=['technical', 'roles', 'both'], default='both')
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.only in ['technical', 'both']:
        doc = base('سند فنی و برنامهٔ پیاده‌سازی', 'قرارداد قابلیت‌ها، دسترسی، پذیرش و مراحل اجرای سامانه')
        p = doc.add_paragraph(); inline(p, 'این سند تعریف قابلیت‌ها و معیارهای پذیرش را همراه برنامهٔ اجرایی نگه می‌دارد. راهنمای نصب و سرویس‌ها، گزارش نتیجهٔ آزمون و کتابچهٔ نقش‌ها همراه بستهٔ انتشار ارائه می‌شوند.')
        markdown(doc, ROOT / 'docs/EXPANSION-SPEC-2.2.fa.md', first_title=False)
        doc.add_page_break()
        markdown(doc, ROOT / 'docs/IMPLEMENTATION-PLAN-2.2.fa.md')
        output = args.output_dir / 'IdealMakoo-2.2-Technical-Spec.fa.docx'
        doc.save(output); print(output)
    if args.only in ['roles', 'both']:
        doc = base('راهنمای جامع نقش‌ها', 'آموزش گام‌به‌گام کار با پنل و حساب مشتری، همراه تصاویر واقعی')
        p = doc.add_paragraph(); inline(p, 'هر فصل مستقل است: هدف نقش، صفحه‌های موردنیاز، ورود و MFA، مراحل کار، تصاویر، وضعیت‌ها، اعلان، گزارش، AI اختیاری، خطاهای رایج، تمرین و تحویل کار را توضیح می‌دهد. تصاویر با حساب آموزشی همین نسخه تهیه شده‌اند.')
        p = doc.add_paragraph(style='Heading 1'); inline(p, 'فهرست فصل‌ها', size=18, bold=True)
        for number, role in enumerate(ROLES, 1):
            path = ROOT / 'docs/role-guides' / (role + '.fa.md')
            title = path.read_text().splitlines()[0].lstrip('# ')
            p = doc.add_paragraph(); inline(p, str(number) + '. ' + title)
        for role in ROLES:
            doc.add_page_break()
            markdown(doc, ROOT / 'docs/role-guides' / (role + '.fa.md'))
        output = args.output_dir / 'IdealMakoo-2.2-Role-Handbook.fa.docx'
        doc.save(output); print(output)


if __name__ == '__main__':
    main()
