"""Generate a NEW fictional 40-hour/$15 fixture; preserve the original sample.

Run locally: python samples/current_upload_generate.py
No real document, credentials, or external service is used.
"""

import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas


SAMPLES = Path(__file__).resolve().parent
TEXT = """FICTIONAL CURRENT UPLOAD TEST PAYSTUB - NOT A REAL DOCUMENT
All people, identifiers and company details are invented for testing.
Employer: CURRENT UPLOAD DEMO CAFE LLC
Employee: Riley Fiction
SSN: 000-00-0040
Partial SSN: ***-**-4040
Employee ID: FS-CURRENT-0040
Employee Address: 404 Synthetic Street Apt 40
Fabletown, TX 00000
Email: riley.fixture@example.invalid
Phone: 202-555-0140
Bank account: 000000004040
Routing number: 000000000

Pay Period Start: 2026-10-01
Pay Period End: 2026-10-14
Pay Date: 2026-10-16
Currency: USD

EARNINGS - CURRENT PERIOD
Regular: Hours 40.00 | Hourly Rate 15.00 | Pay 600.00
Overtime: Hours 4.00 | Hourly Rate 22.50 | Pay 90.00
Tips: 0.00
Gross Pay: 690.00

EMPLOYEE DEDUCTIONS - CURRENT PERIOD
Federal withholding: 50.00
Social Security Tax: 42.78
Medicare: 10.01
Total current deductions: 102.79
Net Pay: 587.21
All current employee deductions are listed.
Gross pay includes all tips; no reimbursements or noncash adjustments.

YEAR TO DATE - DO NOT USE AS CURRENT PERIOD
YTD Gross Pay: 8280.00
YTD Net Pay: 7046.52
"""

EXPECTED = {
    "employer_name": "CURRENT UPLOAD DEMO CAFE LLC",
    "pay_period_start": "2026-10-01",
    "pay_period_end": "2026-10-14",
    "pay_date": "2026-10-16",
    "currency": "USD",
    "regular_hours": "40.00",
    "regular_hourly_rate": "15.00",
    "regular_pay": "600.00",
    "overtime_hours": "4.00",
    "overtime_hourly_rate": "22.50",
    "overtime_pay": "90.00",
    "tips": "0.00",
    "gross_pay": "690.00",
    "deductions": [
        {"label": "Federal withholding", "amount": "50.00"},
        {"label": "Social Security Tax", "amount": "42.78"},
        {"label": "Medicare", "amount": "10.01"},
    ],
    "net_pay": "587.21",
    "other_earnings": [],
    "warnings": ["User review is required. Extracted values are not verified."],
}


def main() -> None:
    lines = TEXT.splitlines()
    (SAMPLES / "current_upload.txt").write_text(TEXT, encoding="utf-8")
    (SAMPLES / "current_upload_expected.json").write_text(json.dumps(EXPECTED, indent=2) + "\n", encoding="utf-8")
    with io.BytesIO() as buffer:
        canvas = Canvas(buffer, pagesize=(612, 792))
        text = canvas.beginText(25, 765)
        text.setFont("Courier", 8)
        text.setLeading(17)
        for line in lines:
            text.textLine(line)
        canvas.drawText(text)
        canvas.save()
        (SAMPLES / "current_upload.pdf").write_bytes(buffer.getvalue())

    try:
        font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 25)
    except OSError:
        try:
            font = ImageFont.truetype("DejaVuSansMono.ttf", 25)
        except OSError:
            font = ImageFont.load_default(size=25)
    with Image.new("RGB", (1500, 1800), "white") as image:
        draw = ImageDraw.Draw(image)
        for index, line in enumerate(lines):
            draw.text((45, 40 + index * 43), line, font=font, fill="black")
        image.save(SAMPLES / "current_upload.png")
        with io.BytesIO() as buffer:
            canvas = Canvas(buffer, pagesize=(612, 792))
            canvas.drawImage(ImageReader(image), 0, 0, width=612, height=792)
            canvas.save()
            (SAMPLES / "current_upload_scanned.pdf").write_bytes(buffer.getvalue())
    print("New fictional current_upload PDF, scan PDF, PNG and expected values generated locally.")


if __name__ == "__main__":
    main()
