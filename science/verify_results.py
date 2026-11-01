"""Recalculate the published CellReview results from saved class scores."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys

# Verification must not add __pycache__ files to the exported package.
sys.dont_write_bytecode = True

NUMPY_VERSION = "2.5.2"
BUDGETS = (0.05, 0.10, 0.20, 0.40)
RANDOM_REPEATS = 1000
RANDOM_SEED = 20260912
COLLECTIONS = {"final_test": "test", "validation": "validation"}
TOLERANCE = 1e-12


class VerificationError(ValueError):
    """A published value does not match its inputs or frozen configuration."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def compare(actual, expected, path: str) -> None:
    """Compare complete structures, retaining exact integer and boolean checks."""
    if isinstance(expected, dict):
        require(isinstance(actual, dict) and actual.keys() == expected.keys(),
                f"{path}: fields differ")
        for key, value in expected.items():
            compare(actual[key], value, f"{path}.{key}")
    elif isinstance(expected, list):
        require(isinstance(actual, list) and len(actual) == len(expected),
                f"{path}: list length differs")
        for index, value in enumerate(expected):
            compare(actual[index], value, f"{path}[{index}]")
    elif isinstance(expected, float):
        require(type(actual) in (int, float) and math.isfinite(actual)
                and math.isclose(actual, expected, rel_tol=TOLERANCE, abs_tol=TOLERANCE),
                f"{path}: saved {actual!r}, recalculated {expected!r}")
    else:
        require(type(actual) is type(expected) and actual == expected,
                f"{path}: saved {actual!r}, expected {expected!r}")


def verify_payload(payload: dict, collection_id: str, evaluation) -> dict:
    """Use the original evaluation module; this wrapper only checks the export."""
    import numpy as np

    split = COLLECTIONS[collection_id]
    compare(payload["version"], 2, "version")
    compare(payload["collection_id"], collection_id, "collection_id")
    compare(payload["evaluated_split"], split, "evaluated_split")
    compare(payload["final_test_evaluated"], True, "final_test_evaluated")
    classes = [item["id"] for item in payload["classes"]]
    require(len(classes) == 8 and len(set(classes)) == 8, "Expected eight unique classes")
    cases = payload["cases"]
    require(isinstance(cases, list) and bool(cases), "No saved cases")
    compare(payload["counts"][split], len(cases), f"counts.{split}")
    ids = [case["id"] for case in cases]
    require(all(isinstance(value, str) and value for value in ids), "Invalid image ID")
    require(len(set(ids)) == len(ids), "Duplicate image IDs")
    require(all(isinstance(case["scores"], list) and len(case["scores"]) == len(classes)
                and all(type(value) in (int, float) for value in case["scores"])
                for case in cases), "Expected one numeric score per class and image")
    scores = np.asarray([case["scores"] for case in cases], dtype=np.float64)
    uncertainty = evaluation.normalized_entropy(scores)
    predictions = [classes[int(index)] for index in scores.argmax(axis=1)]
    labels = [case["reference"] for case in cases]
    errors = [label != prediction for label, prediction in zip(labels, predictions, strict=True)]
    for index, case in enumerate(cases):
        field = f"cases[{index}] ({case['id']})"
        compare(case["rank"], index + 1, f"{field}.rank")
        compare(case["prediction"], predictions[index], f"{field}.prediction")
        compare(case["score"], float(scores[index].max()), f"{field}.score")
        compare(case["uncertainty"], float(uncertainty[index]), f"{field}.uncertainty")
        compare(case["error"], errors[index], f"{field}.error")

    classification = evaluation.classification_metrics(labels, predictions, classes)
    compare(payload["classification"], classification, "classification")
    saved_review = payload["review"]
    compare(saved_review["random_seed"], RANDOM_SEED, "review.random_seed")
    compare(saved_review["random_repeats"], RANDOM_REPEATS, "review.random_repeats")
    compare([budget["fraction"] for budget in saved_review["budgets"]],
            list(BUDGETS), "review.budgets.fractions")
    review = evaluation.review_comparison(
        ids, scores, errors, budgets=BUDGETS,
        random_repeats=RANDOM_REPEATS, random_seed=RANDOM_SEED,
    )
    compare(ids, review.pop("order"), "cases.priority_order")
    # The shared module labels its output as validation. The final-test runner
    # changes only these two descriptions; the public JSON omits the order list
    # because it already stores cases in priority order.
    if collection_id == "final_test":
        review["status"] = "held_out_internal_test"
        review["quantiles_interpretation"] = (
            "Variability of random queues on this fixed test set; "
            "not confidence intervals or patient-level uncertainty."
        )
    compare(saved_review, review, "review")
    return {"collection": collection_id, "images": len(cases),
            "accuracy": classification["accuracy"], "macro_f1": classification["macro_f1"],
            "disagreements": review["total_errors"], "budgets": review["budgets"]}


def checked_bytes(package: Path, manifest: dict, relative: str) -> bytes:
    path = package / relative
    require(path.resolve().is_relative_to(package), f"Path leaves package: {relative}")
    expected = manifest["files"][relative]
    raw = path.read_bytes()
    require(len(raw) == expected["bytes"]
            and hashlib.sha256(raw).hexdigest() == expected["sha256"],
            f"Manifest hash or size differs: {relative}")
    return raw


def verify_package(package: Path, collection_ids: list[str]) -> list[dict]:
    """Verify evaluation inputs and code before recalculating either collection."""
    import numpy as np

    require(np.__version__ == NUMPY_VERSION,
            f"NumPy {NUMPY_VERSION} required; installed {np.__version__}. "
            "Install science/requirements.txt in a Python 3.12 environment.")
    package = package.resolve()
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    compare(manifest["schema_version"], 1, "manifest.schema_version")
    evaluation_path = package / "science/evaluation.py"
    evaluation_bytes = checked_bytes(package, manifest, "science/evaluation.py")
    compare(hashlib.sha256(evaluation_bytes).hexdigest(),
            manifest["provenance"]["frozen_input_hashes"]["evaluation_sha256"],
            "frozen evaluation source SHA-256")
    for relative in ("science/verify_results.py", "science/requirements.txt", "science/README.md"):
        checked_bytes(package, manifest, relative)
    spec = importlib.util.spec_from_file_location("cellreview_public_evaluation", evaluation_path)
    require(spec is not None and spec.loader is not None, "Cannot load evaluation.py")
    evaluation = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evaluation)
    summaries = []
    for collection_id in collection_ids:
        payload = json.loads(checked_bytes(package, manifest, f"data/{collection_id}.json"))
        provenance = manifest["provenance"]["collections"][collection_id]
        compare(payload["fingerprint"], provenance["predictions_sha256"], "predictions fingerprint")
        compare(len(payload["cases"]), provenance["images"], "provenance image count")
        compare(payload["evaluated_split"], provenance["evaluated_split"], "provenance split")
        summaries.append(verify_payload(payload, collection_id, evaluation))
    return summaries


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", choices=(*COLLECTIONS, "both"), default="final_test")
    parser.add_argument("--package", type=Path, default=Path(__file__).resolve().parents[1],
                        help="Root of the downloaded CellReview package")
    args = parser.parse_args(argv)
    selected = list(COLLECTIONS) if args.collection == "both" else [args.collection]
    try:
        summaries = verify_package(args.package, selected)
    except (OSError, ValueError, KeyError, TypeError, ImportError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    for result in summaries:
        print(f"PASS {result['collection']}: {result['images']} images, "
              f"accuracy={result['accuracy']:.10f}, macro-F1={result['macro_f1']:.10f}, "
              f"disagreements={result['disagreements']}")
        for budget in result["budgets"]:
            random = budget["random"]["errors_found"]
            print(f"  {budget['fraction']:.0%}: {budget['n_reviewed']} reviewed; "
                  f"uncertainty={budget['uncertainty']['errors_found']}; "
                  f"random mean={random['mean']:.3f}, "
                  f"2.5-97.5% quantiles=[{random['q025']:.3f}, {random['q975']:.3f}]")
    print(f"PASS: class metrics, confusion matrix, scores, entropy, queue order and all "
          f"random summaries match. {RANDOM_REPEATS} PCG64 permutations, seed {RANDOM_SEED}.")
    print("Saved predictions only; no training, inference or clinical validation. "
          "Hashes cover evaluation inputs and code, not the JPEG collection.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
