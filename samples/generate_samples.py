"""Rebuild only these fictional test assets; no real paystub is read.

Run from the repository root: python samples/generate_samples.py
The PDF is searchable text; the PNG exercises local OCR. No network is used.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SAMPLES = Path(__file__).resolve().parent


def make_pdf(lines: list[str]) -> None:
    """Write a one-page ASCII PDF without adding a PDF-generation dependency."""
    commands = ["BT /F1 9 Tf 12 TL 28 760 Td"]
    for index, line in enumerate(lines):
        escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        if index:
            commands.append("T*")
        commands.append(f"({escaped}) Tj")
    commands.append("ET")
    stream = "\n".join(commands).encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    result = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, item in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f"{index} 0 obj\n".encode() + item + b"\nendobj\n")
    xref_offset = len(result)
    result.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    result.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode())
    result.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n".encode()
    )
    (SAMPLES / "sample_paystub.pdf").write_bytes(result)


def make_png(lines: list[str]) -> None:
    try:
        font = ImageFont.truetype("DejaVuSansMono.ttf", 21)
    except OSError:
        try:
            font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 21)
        except OSError:
            font = ImageFont.load_default(size=21)
    with Image.new("RGB", (1500, 1600), "white") as image:
        draw = ImageDraw.Draw(image)
        for index, line in enumerate(lines):
            draw.text((45, 45 + index * 36), line, font=font, fill="black")
        image.save(SAMPLES / "sample_paystub.png")


if __name__ == "__main__":
    fictional_lines = (SAMPLES / "sample_paystub.txt").read_text(encoding="utf-8").splitlines()
    make_pdf(fictional_lines)
    make_png(fictional_lines)
    print("Fictional PDF and PNG samples rebuilt locally.")
