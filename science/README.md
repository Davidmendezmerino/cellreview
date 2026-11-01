# CellReview: inspect and recalculate the evaluation

David Méndez Merino

This small code sample recalculates the published results from the saved predictions in `data/final_test.json` and `data/validation.json`. It uses the original `evaluation.py` from the experiment, copied without changes. No model weights, training data or GPU are needed.

## Run locally

Download the complete Space repository, or keep its `science/`, `data/` and `manifest.json` files in the same layout. Use **Python 3.12** and the pinned dependency. This combination was checked locally on Windows; other operating systems have not been tested for this sample.

From the downloaded package root, on Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r science/requirements.txt
.\.venv\Scripts\python.exe -B science/verify_results.py
```

On macOS or Linux, the equivalent commands are:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r science/requirements.txt
.venv/bin/python -B science/verify_results.py
```

The default is the final test. To check development validation or both collections, append `--collection validation` or `--collection both`. The script finds the package relative to its own location; `--package /path/to/package` selects another downloaded copy. After installing NumPy, verification runs without a network connection and does not modify the package.

## What is checked

- SHA-256 and byte counts for the selected prediction JSON and the four scientific sample files, against the package manifest. The evaluation module is also checked against its hash recorded before the final test.
- Predicted class and maximum score for every image; reference disagreement flags; normalized entropy; complete review order, including the lexical image-ID tie rule.
- Accuracy, macro-F1, per-class recall, support and F1, and every cell of the confusion matrix.
- Review budgets of 5%, 10%, 20% and 40%, rounded up to complete images; disagreement counts, recall, precision and lift.
- All summaries and frequency counts from **1,000 random permutations**, using NumPy PCG64 and seed **20260912**. Each permutation supplies nested review budgets without replacement. Random queue quantiles describe variability on this fixed collection, not confidence intervals across patients.

Integers, flags, identifiers and configuration values must match exactly. Floating-point comparisons use absolute and relative tolerances of `1e-12`. Failure prints `FAIL` and returns a nonzero exit code; success prints `PASS` with the recomputed results. A changed result cannot pass merely because its JSON hash was updated: the scientific values are recalculated separately.

Expected final-test summary:

```text
PASS final_test: 3414 images, accuracy=0.8406561219, macro-F1=0.8335172779, disagreements=544
  10%: 342 reviewed; uncertainty=194; random mean=54.281, 2.5-97.5% quantiles=[42.000, 67.000]
```

The output also reports the other three budgets. For validation, accuracy is `0.8388986526`, macro-F1 is `0.8283062739`, and 342 reviews find 202 of 550 disagreements versus a random mean of 55.348.

## Reading the code

Start with [`evaluation.py`](evaluation.py): `normalized_entropy` and `priority_order` do not accept reference labels. Labels are used later by `classification_metrics` and `review_comparison` to assess the fixed ranking. [`verify_results.py`](verify_results.py) reads the public JSON and compares its values with those functions. The original module describes its generic output as validation; the wrapper applies the final-test descriptions recorded by the final-test runner without changing any numerical calculation.

This sample **recalculates saved predictions; it does not reproduce training or image inference**. It does not re-audit the dataset, establish patient independence, verify JPEG hashes, recreate the earlier 400-image pilot comparison, or establish clinical performance. The manifest detects differences from the supplied files; it is not an independent authenticity signature. See the [technical note](../TECHNICAL_NOTE.md) for the model, split, experiment results and limitations, and the [data notice](../DATA_NOTICE.md) for PBC attribution.
