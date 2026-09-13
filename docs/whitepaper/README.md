# StellarKey Private Balance manuscript

[PDF](private-payments.pdf) · [Standalone LaTeX](private-payments.tex) · [arXiv source archive](arxiv-source.zip) · [Maintained Markdown](../private-balance.md)

Author: **DRAFT**. Contact: **support@stellarkey.io**. No affiliation is asserted.
The September 13, 2026 draft describes application **1.5.1**, Protocol **V2**,
with implementation revision `f8bd09b5a877a0f6f16fb6cfe0c98c83192b0084` on the local
`release/1.5.1-review` branch. Publish that source revision before relying on the
manuscript's pinned GitHub links. Nothing has been submitted to arXiv.

The manuscript includes a threat model, conditional state-transition arguments,
current artifact identities, raw browser measurements, primary-source related
work, and explicitly dated deployment evidence. Full-input exits address the
commitment-saturation failure; finite archive storage, partial-change capacity,
setup trust and network/token availability remain limitations. This is a
single-party development Testnet implementation, not a security certification.

Edit `docs/private-balance.md` for content and `template.tex` for presentation.
The builder produces a standalone ASCII LaTeX source using standard packages and
a native bibliography, with no local includes. It checks application version and
embeds the maintained Markdown checksum. It rejects layout and reference warnings.

```sh
python3 docs/whitepaper/build.py
python3 docs/whitepaper/build.py --check
node --test tests/private-balance-docs.test.mjs
qpdf --check docs/whitepaper/private-payments.pdf
```

With Python 3, Pandoc 3.11 and Tectonic installed, the first command rebuilds the
PDF and standalone source. The source alone also compiles with:

```sh
tectonic --outdir docs/whitepaper docs/whitepaper/private-payments.tex
```

`arxiv-source.zip` contains only `private-payments.tex`; all references are embedded
in its `thebibliography` environment. It excludes the PDF, auxiliary build files,
and the Markdown/Python generation toolchain. Review arXiv's processed PDF and
supply submission metadata before submitting; local compilation does not imply
arXiv acceptance or successful processing.

Validation scope and release evidence are recorded in
[the release preparation record](../private-capacity-release-plan.md).
