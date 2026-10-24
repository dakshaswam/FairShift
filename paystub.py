"""Run: python paystub.py samples/sample_paystub.pdf --output result.json"""

from fairshift_paystub import complete_paystub, extract_paystub, prepare_paystub
from fairshift_paystub.cli import main

__all__ = ["extract_paystub", "prepare_paystub", "complete_paystub"]


if __name__ == "__main__":
    raise SystemExit(main())
