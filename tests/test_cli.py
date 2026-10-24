"""CLI approval and explicit output behavior, without network calls."""

import builtins
from pathlib import Path
from unittest.mock import Mock

import pytest

from fairshift_paystub import cli
from fairshift_paystub.errors import ApprovalError
from fairshift_paystub.schema import Paystub


def test_terminal_edits_are_previewed_and_require_explicit_send(monkeypatch, capsys):
    monkeypatch.setattr(cli.sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(cli.sys.stderr, "isatty", lambda: True)
    answers = iter(["yes", "EDIT", "Employee: [NAME_1]", "Gross Pay: 42.00", ".END", "SEND"])
    monkeypatch.setattr(builtins, "input", lambda: next(answers))
    assert cli.terminal_review("old preview") == "Employee: [NAME_1]\nGross Pay: 42.00"
    preview = capsys.readouterr().err
    assert "old preview" in preview and "Employee: [NAME_1]\nGross Pay: 42.00" in preview


def test_noninteractive_cannot_autoapprove(monkeypatch):
    monkeypatch.setattr(cli.sys.stdin, "isatty", lambda: False)
    with pytest.raises(ApprovalError, match="interactive"):
        cli.terminal_review("Gross Pay: 42.00")


def test_output_only_explicit_and_refuses_overwrite(expected, monkeypatch, tmp_path, capsys):
    original = tmp_path / "input.pdf"
    original.write_bytes(b"fictional original")
    extract = Mock(return_value=Paystub.model_validate(expected))
    monkeypatch.setattr(cli, "extract_paystub", extract)
    monkeypatch.chdir(tmp_path)
    assert cli.main([str(original)]) == 0
    assert list(tmp_path.iterdir()) == [original]
    output = tmp_path / "result.json"
    assert cli.main([str(original), "--output", str(output)]) == 0
    assert '"gross_pay": "1615.00"' in output.read_text(encoding="utf-8")
    assert cli.main([str(original), "--output", str(output)]) == 1
    assert cli.main([str(original), "--output", str(original)]) == 1
    assert original.read_bytes() == b"fictional original"
    assert extract.call_count == 2


def test_preview_never_calls_gemini_or_creates_output(monkeypatch, tmp_path, capsys):
    extract = Mock()
    monkeypatch.setattr(cli, "extract_paystub", extract)
    monkeypatch.setattr(cli, "prepare_paystub", Mock(return_value="Employee: [NAME_1]"))
    monkeypatch.chdir(tmp_path)
    assert cli.main(["input.pdf", "--preview-only"]) == 0
    extract.assert_not_called()
    assert not list(tmp_path.iterdir())
    assert "[NAME_1]" in capsys.readouterr().out


def test_partial_output_removed_on_write_failure(monkeypatch, tmp_path):
    output = tmp_path / "failed.json"
    real_open = Path.open

    class BrokenWriter:
        def __init__(self, handle):
            self.handle = handle
        def __enter__(self):
            self.handle.__enter__()
            return self
        def write(self, value):
            self.handle.write(value[:8])
            raise OSError("fictional private filesystem detail")
        def __exit__(self, *args):
            return self.handle.__exit__(*args)

    monkeypatch.setattr(Path, "open", lambda self, *args, **kwargs: BrokenWriter(real_open(self, *args, **kwargs)))
    with pytest.raises(Exception, match="Could not save"):
        cli._save_result(output, '{"gross_pay": "42.00"}')
    assert not output.exists()


def test_argument_typo_does_not_echo_personal_path(capsys):
    with pytest.raises(SystemExit) as caught:
        cli.main(["input.pdf", "--ouput", "C:/Users/FictionalPerson/paystub.json"])
    assert caught.value.code == 2
    error = capsys.readouterr().err
    assert "FictionalPerson" not in error and "paystub.json" not in error
