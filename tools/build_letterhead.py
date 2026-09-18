"""تجهيز الترويسة الرسمية من ملف Word الأصلي.

المخرجات:
  assets/letterhead/page.jpg   صورة الصفحة الفارغة بالترويسة (للمعاينة و PDF)
  src/letterhead-docx.js        أجزاء ملف docx مضمّنة (لتصدير Word بالترويسة الأصلية)

الاستخدام:
  python tools/build_letterhead.py "<مسار ملف الترويسة.docx>"
يُفرَّغ متن الملف (أي نص مكتوب داخل الصفحة) ثم يُحوَّل إلى PDF عبر Microsoft Word
لضمان مطابقة الخطوط والمواضع، ولذلك يلزم وجود Word على الجهاز.
المتطلبات: pip install pymupdf pillow
"""
import base64
import io
import json
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

# هوامش النص داخل الترويسة (بالـ twips، 1440 = 1 إنش) — تحت خطوط الترويسة وفوق التذييل
MARGIN_TOP = 2750
MARGIN_BOTTOM = 1900
MARGIN_SIDE = 1440  # مطابق لملف الترويسة الأصلي — عناصر الترويسة مثبّتة نسبةً إلى هذا الهامش، فلا يُغيَّر

SKIP = ("word/webextensions/", "customXml/")


def optimize_media(name, data):
    im = Image.open(io.BytesIO(data))
    if name.endswith("image1.png"):  # العلامة المائية: خلفية صفحة كاملة
        out = io.BytesIO()
        im.convert("RGB").save(out, "JPEG", quality=82, optimize=True)
        return name.replace(".png", ".jpeg"), out.getvalue()
    if im.width > 800:
        im = im.resize((800, round(im.height * 800 / im.width)), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "PNG", optimize=True)
    return name, out.getvalue()


def build_docx_parts(docx_path):
    z = zipfile.ZipFile(docx_path)
    parts = {}
    for name in z.namelist():
        if name.startswith(SKIP):
            continue
        data = z.read(name)
        if name.startswith("word/media/"):
            name, data = optimize_media(name, data)
        parts[name] = data

    text = lambda n: parts[n].decode("utf-8")

    ct = text("[Content_Types].xml")
    ct = re.sub(r'<Override PartName="/(word/webextensions|customXml)/[^>]*/>', "", ct)
    ct = ct.replace('<Default Extension="png"', '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png"')
    parts["[Content_Types].xml"] = ct.encode()

    rels = text("_rels/.rels")
    rels = re.sub(r'<Relationship [^>]*webextensiontaskpanes[^>]*/>', "", rels)
    parts["_rels/.rels"] = rels.encode()

    drels = text("word/_rels/document.xml.rels")
    drels = re.sub(r'<Relationship [^>]*customXml"[^>]*/>', "", drels)
    parts["word/_rels/document.xml.rels"] = drels.encode()

    for name in list(parts):
        if re.match(r"word/_rels/(header|footer)\d+\.xml\.rels", name):
            parts[name] = text(name).replace("media/image1.png", "media/image1.jpeg").encode()

    doc = text("word/document.xml")

    prefix = doc[: doc.index("<w:body>") + len("<w:body>")]
    sect = re.search(r"<w:sectPr\b.*?</w:sectPr>", doc, re.S).group(0)
    sect = re.sub(
        r"<w:pgMar [^>]*/>",
        f'<w:pgMar w:top="{MARGIN_TOP}" w:right="{MARGIN_SIDE}" w:bottom="{MARGIN_BOTTOM}" '
        f'w:left="{MARGIN_SIDE}" w:header="0" w:footer="0" w:gutter="0"/>',
        sect,
    )
    del parts["word/document.xml"]

    return {
        "documentPrefix": prefix,
        "documentSuffix": sect + "</w:body></w:document>",
        "parts": {n: base64.b64encode(d).decode("ascii") for n, d in sorted(parts.items())},
    }


BODY_RE = re.compile(r"(<w:body>).*?(<w:sectPr\b.*?</w:sectPr>\s*</w:body>)", re.S)


def blank_letterhead_pdf(docx_path, workdir):
    """نسخة من الترويسة بمتن فارغ، محوّلة إلى PDF عبر Word."""
    blank = Path(workdir) / "blank.docx"
    pdf = Path(workdir) / "blank.pdf"
    with zipfile.ZipFile(docx_path) as src, zipfile.ZipFile(blank, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == "word/document.xml":
                data = BODY_RE.sub(r"\1<w:p/>\2", data.decode("utf-8")).encode("utf-8")
            dst.writestr(item, data)
    ps = (
        "$w = New-Object -ComObject Word.Application; $w.Visible = $false; $w.DisplayAlerts = 0; "
        f"$d = $w.Documents.Open('{blank}', $false, $true); $d.ExportAsFixedFormat('{pdf}', 17); "
        "$d.Close($false); $w.Quit()"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)
    return pdf


def render_page(pdf_path, out_path):
    page = pymupdf.open(pdf_path)[0]
    pix = page.get_pixmap(dpi=200)
    im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    im.save(out_path, "JPEG", quality=86, optimize=True, progressive=True)
    return page.rect.width, page.rect.height


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    docx_path = sys.argv[1]

    assets = ROOT / "assets" / "letterhead"
    assets.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        w, h = render_page(blank_letterhead_pdf(docx_path, tmp), assets / "page.jpg")

    data = build_docx_parts(docx_path)
    data["page"] = {
        "widthPt": w, "heightPt": h,
        "marginTopPt": MARGIN_TOP / 20, "marginBottomPt": MARGIN_BOTTOM / 20, "marginSidePt": MARGIN_SIDE / 20,
    }
    js = (
        "/* مُولَّد تلقائياً بواسطة tools/build_letterhead.py — لا تعدّله يدوياً */\n"
        "(function (App) {\n  App.letterheadDocx = "
        + json.dumps(data, ensure_ascii=False)
        + ";\n})(window.App = window.App || {});\n"
    )
    (ROOT / "src" / "letterhead-docx.js").write_text(js, encoding="utf-8")
    print("page.jpg:", (assets / "page.jpg").stat().st_size // 1024, "KB")
    print("letterhead-docx.js:", len(js) // 1024, "KB", f"page {w}x{h}pt")


if __name__ == "__main__":
    main()
