#!/usr/bin/env python3
"""Generate standalone LaTeX/PDF from the maintained paper; --check verifies freshness.

Requires Python 3, Pandoc 3.11, and Tectonic.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import quote, urlsplit
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MARKDOWN = ROOT / "docs/private-balance.md"
SOURCE = HERE / "private-payments.tex"
ARCHIVE = HERE / "arxiv-source.zip"


def run(command, text=None):
    return subprocess.run(command, input=text, text=True, check=True, capture_output=True).stdout


def generate():
    paper = MARKDOWN.read_text()
    version = re.search(r"Application version:\*\* StellarKey ([\d.]+)", paper).group(1)
    revision = re.search(r"Document revision:\*\* ([\d-]+)", paper).group(1)
    baseline = re.search(r"Implementation baseline:\*\* `(v\d+\.\d+\.\d+)`", paper).group(1)
    if baseline != f"v{version}":
        raise ValueError("The paper must reference the current immutable release tag.")
    if version != json.loads((ROOT / "package.json").read_text())["version"]:
        raise ValueError("Update the paper's application version before building.")
    if run(["pandoc", "--version"]).splitlines()[0] != "pandoc 3.11":
        raise ValueError("Use Pandoc 3.11 for reproducible LaTeX generation.")

    abstract, body = paper.split("## Abstract\n\n", 1)[1].split("## 1. ", 1)
    body = "## 1. " + body
    body = re.sub(r"^## \d+\. ", "# ", body, flags=re.MULTILINE)
    body = re.sub(r"^### ", "## ", body, flags=re.MULTILINE)
    body, references = body.split("# References\n\n", 1)
    references = re.split(r"^\d+\. ", references, flags=re.MULTILINE)[1:]
    if len(references) != 10:
        raise ValueError("Check the numbered bibliography and citation keys.")

    def convert(markdown):
        document = json.loads(run(["pandoc", "--from=gfm+tex_math_dollars", "--to=json"], markdown))

        def transform(value):
            if isinstance(value, list):
                return [transform(item) for item in value]
            if not isinstance(value, dict):
                return value
            if value.get("t") == "Table":
                columns = value["c"][2]
                widths = [0.30, 0.70] if len(columns) == 2 else [0.14, 0.43, 0.43]
                if len(columns) != len(widths):
                    raise ValueError("Specify printable widths for the new table shape.")
                for column, width in zip(columns, widths):
                    column[1] = {"t": "ColWidth", "c": width}
            if value.get("t") == "Link":
                target = value["c"][2][0]
                parsed = urlsplit(target)
                if not parsed.scheme and parsed.path:
                    path = (MARKDOWN.parent / parsed.path).resolve()
                    relative = path.relative_to(ROOT)
                    if not path.is_file():
                        raise ValueError(f"Missing local source: {relative}")
                    value["c"][2][0] = (
                        f"https://github.com/stellarchain/io.stellarkey/blob/{baseline}/"
                        + quote(relative.as_posix())
                        + ("#" + parsed.fragment if parsed.fragment else "")
                    )
            if value.get("t") == "Code" and re.fullmatch(r"(?:[a-f0-9]{40}|[a-f0-9]{64}|[CG][A-Z2-7]{55})", value["c"][1]):
                return {"t": "RawInline", "c": ["latex", r"{\ttfamily\seqsplit{" + value["c"][1] + "}}"]}
            math = {
                "Fr": r"\mathbb{F}_r", "Fq": r"\mathbb{F}_q", "rho": r"\rho",
                "x^5": "x^5", "2^14": "2^{14}",
                "3^17 = 129,140,163": "3^{17} = 129{,}140{,}163",
            }
            if value.get("t") == "Code" and value["c"][1] in math:
                return {"t": "Math", "c": [{"t": "InlineMath"}, math[value["c"][1]]]}
            if value.get("t") == "Code" and value["c"][1] == "CBQI…DRUI":
                return {"t": "RawInline", "c": ["latex", r"\texttt{CBQI\ldots DRUI}"]}
            if value.get("t") == "Str" and re.fullmatch(r"[A-Za-z0-9-]+(?:/[A-Za-z0-9-]+)+[.,;:]?", value["c"]):
                return {"t": "RawInline", "c": ["latex", value["c"].replace("/", r"/\allowbreak{}") ]}
            if value.get("t") == "Str":
                citation = re.fullmatch(r"\[(\d+(?:,\d+)*)\]([.,;:]?)", value["c"])
                if citation:
                    keys = [f"ref{number}" for number in citation[1].split(",")]
                    if any(int(key[3:]) > len(references) for key in keys):
                        raise ValueError("Citation has no bibliography entry.")
                    return {"t": "RawInline", "c": ["latex", r"\cite{" + ",".join(keys) + "}" + citation[2]]}
            if value.get("t") == "CodeBlock" and value["c"][1] == (
                "sum(private inputs) + public deposit\n"
                "  = sum(private outputs) + public withdrawal"
            ):
                return {"t": "RawBlock", "c": ["latex", r"\[\sum v_{\mathrm{in}} + v_{\mathrm{deposit}} = \sum v_{\mathrm{out}} + v_{\mathrm{withdrawal}}.\]"]}
            return {key: transform(item) for key, item in value.items()}

        return run(["pandoc", "--from=json", "--to=latex", "--wrap=auto"], json.dumps(transform(document)))

    template = (HERE / "template.tex").read_text()
    replacements = {
        "@@MARKDOWN_SHA256@@": hashlib.sha256(MARKDOWN.read_bytes()).hexdigest(),
        "@@VERSION@@": version,
        "@@REVISION@@": revision,
        "@@BASELINE@@": baseline,
        "@@SHORT_BASELINE@@": baseline[:8],
        "@@ABSTRACT@@": convert(abstract),
        "@@BODY@@": convert(body) + "\n" + r"\clearpage" + "\n" + r"\addcontentsline{toc}{section}{References}" + "\n" + r"\begin{thebibliography}{10}" + "\n"
            + "\n".join(r"\bibitem{ref" + str(index) + "}\n" + convert(reference.strip())
                        for index, reference in enumerate(references, 1))
            + "\n" + r"\end{thebibliography}",
    }
    for token, value in replacements.items():
        template = template.replace(token, value)
    template = template.replace("§", r"\S{}")
    if re.search(r"@@[A-Z_]+@@", template):
        raise ValueError("Unresolved template marker.")
    if not template.isascii():
        raise ValueError("Use explicit LaTeX macros for non-ASCII glyphs in the printable source.")
    return template


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check LaTeX without writing files or compiling PDF")
    args = parser.parse_args()
    source = generate()
    if args.check:
        if not SOURCE.is_file() or SOURCE.read_text() != source:
            raise SystemExit("LaTeX is stale; run python3 docs/whitepaper/build.py.")
        with ZipFile(ARCHIVE) as archive:
            if archive.namelist() != [SOURCE.name] or archive.read(SOURCE.name) != source.encode():
                raise SystemExit("arXiv source archive is stale; rebuild the manuscript.")
        print("LaTeX and arXiv source archive match the maintained Markdown, version, baseline, and template.")
        return

    scratch = ROOT / "tmp/pdfs"
    scratch.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix="whitepaper-", dir=scratch) as directory:
            build = Path(directory)
            tex = build / SOURCE.name
            tex.write_text(source)
            result = subprocess.run(
                ["tectonic", "--keep-logs", "--outdir", str(build), str(tex)],
                text=True, capture_output=True,
            )
            print(result.stdout, end="")
            print(result.stderr, end="")
            result.check_returncode()
            log = (build / "private-payments.log").read_text()
            issues = re.findall(r"^.*(?:LaTeX Warning:|Package \S+ Warning:|Overfull|Underfull|undefined references|Missing character:).*$", log, re.MULTILINE)
            if issues:
                raise ValueError("Resolve LaTeX layout/reference warnings:\n" + "\n".join(issues))
            shutil.copyfile(tex, SOURCE)
            shutil.copyfile(build / "private-payments.pdf", HERE / "private-payments.pdf")
            revision = re.search(r"Document revision:\*\* ([\d-]+)", MARKDOWN.read_text()).group(1)
            year, month, day = map(int, revision.split("-"))
            entry = ZipInfo(SOURCE.name, (year, month, day, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.external_attr = 0o644 << 16
            with ZipFile(ARCHIVE, "w") as archive:
                archive.writestr(entry, source.encode())
    finally:
        for directory in (scratch, scratch.parent):
            if directory.is_dir() and not any(directory.iterdir()):
                directory.rmdir()
    print("Updated docs/whitepaper/private-payments.tex private-payments.pdf, and arxiv-source.zip.")


if __name__ == "__main__":
    main()
