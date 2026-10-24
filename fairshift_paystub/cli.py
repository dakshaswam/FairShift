"""Interactive local review; stdout contains only the final JSON."""

import argparse
import sys
from pathlib import Path

from .errors import ApprovalError, FairShiftError
from .pipeline import extract_paystub, prepare_paystub


class _PrivateArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default includes unrecognized argument values (file paths).
        self.exit(2, "FairShift: Invalid arguments. Run python paystub.py --help for usage.\n")


def terminal_review(text: str) -> str | None:
    """Edit replacement text in memory, then preview and explicitly approve it."""
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise ApprovalError("Review requires an interactive terminal. Open a terminal and run the command there.")
    while True:
        print("\n--- Exact redacted document text proposed for Gemini ---", file=sys.stderr)
        print(text, file=sys.stderr)
        print("--- End of proposed document text ---", file=sys.stderr)
        print("Check every line for personal information. Payroll amounts still go to Google after approval.", file=sys.stderr)
        print("Type SEND to approve, EDIT to replace the text, or CANCEL to stop:", file=sys.stderr)
        try:
            answer = input().strip()
        except EOFError:
            return None
        if answer == "SEND":
            return text
        if answer == "CANCEL":
            return None
        if answer == "EDIT":
            print("Paste the complete corrected redacted text. Finish with .END on its own line.", file=sys.stderr)
            print("Use placeholders such as [NAME_1]. This replacement is held in memory.", file=sys.stderr)
            lines = []
            length = 0
            try:
                while True:
                    line = input()
                    if line == ".END":
                        break
                    length += len(line) + 1
                    if length > 200_000:
                        raise ApprovalError("Edited text is too long; nothing was sent.")
                    lines.append(line)
            except EOFError:
                return None
            text = "\n".join(lines)
            # Avoid printing pasted escape/control codes in the next preview.
            from .pipeline import _safe_text
            _safe_text(text)
        else:
            print("Approval requires the exact word SEND. EDIT and CANCEL are also available.", file=sys.stderr)


def _output_target(output: str | None, original: str) -> Path | None:
    if output is None:
        return None
    try:
        path = Path(output).expanduser()
        if path.resolve() == Path(original).expanduser().resolve() or path.exists():
            raise FairShiftError("Output must be a new file. Existing files and the original document are never overwritten.")
        if not path.parent.is_dir():
            raise FairShiftError("The output folder does not exist. Create it locally and try again.")
        return path
    except FairShiftError:
        raise
    except Exception:
        raise FairShiftError("Cannot use that output location. Choose a new file in an existing local folder.") from None


def _save_result(path: Path, json_text: str) -> None:
    """Exclusive create prevents clobbering an input/hardlink/existing output."""
    created = False
    try:
        with path.open("x", encoding="utf-8", newline="\n") as handle:
            created = True
            handle.write(json_text + "\n")
    except Exception:
        if created:
            try:
                path.unlink()  # Only this newly created, redacted output file.
            except OSError:
                pass
        raise FairShiftError("Could not save the redacted JSON. Check folder permissions and choose a new output filename.") from None


def main(argv: list[str] | None = None) -> int:
    parser = _PrivateArgumentParser(description="FairShift: locally redact a paystub, review it, then extract JSON with Gemini.")
    parser.add_argument("file", help="Local PDF, PNG, JPEG, TIFF, BMP or WebP paystub")
    parser.add_argument("--output", help="Explicitly save final redacted JSON to a NEW file")
    parser.add_argument("--model", help="Override GEMINI_MODEL")
    parser.add_argument("--preview-only", action="store_true", help="Show local redaction only; no Gemini call or JSON file")
    args = parser.parse_args(argv)
    try:
        if args.preview_only and args.output:
            raise FairShiftError("--preview-only cannot be combined with --output; no extraction result exists to save.")
        # Do not search parent folders for unrelated teams' .env files.
        try:
            from dotenv import load_dotenv
            load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
        except ImportError:
            raise FairShiftError("Install requirements.txt in the active Python virtual environment first.") from None
        output = _output_target(args.output, args.file)
        if args.preview_only:
            print(prepare_paystub(args.file))
            print("Local preview only; nothing was sent to Gemini or saved.", file=sys.stderr)
            return 0
        result = extract_paystub(args.file, review=terminal_review, model=args.model)
        json_text = result.model_dump_json(indent=2)
        if output is not None:
            _save_result(output, json_text)
        print(json_text)
        return 0
    except FairShiftError as error:
        print(f"FairShift: {error}", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("FairShift: Cancelled. No result was saved.", file=sys.stderr)
        return 1
    except Exception:
        print("FairShift: Processing failed. Check local setup and try again. Sensitive error details were suppressed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
