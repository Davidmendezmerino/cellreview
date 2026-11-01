"""Reproducible, label-free priorities and retrospective validation metrics."""

from __future__ import annotations

import math
from collections import Counter
from typing import Sequence

import numpy as np


def normalized_entropy(probabilities: np.ndarray) -> np.ndarray:
    """Entropy/log(K); model scores are not calibrated correctness probabilities."""
    values = np.asarray(probabilities, dtype=np.float64)
    if values.ndim != 2 or values.shape[1] < 2:
        raise ValueError("Expected an N x K score matrix with at least two classes")
    if not np.isfinite(values).all() or np.any(values < 0) or np.any(values > 1):
        raise ValueError("Scores must be finite and within [0, 1]")
    if not np.allclose(values.sum(axis=1), 1.0, atol=1e-8, rtol=1e-8):
        raise ValueError("Class scores must sum to one for each image")
    terms = np.zeros_like(values)
    np.log(values, out=terms, where=values > 0)
    return np.clip(-(values * terms).sum(axis=1) / np.log(values.shape[1]), 0, 1)


def priority_order(image_ids: Sequence[str], probabilities: np.ndarray) -> np.ndarray:
    """Descending entropy, with lexical image ID ties; no labels are accepted."""
    image_ids = list(image_ids)
    if len(image_ids) != len(set(image_ids)):
        raise ValueError("Image IDs must be unique")
    uncertainty = normalized_entropy(probabilities)
    if len(image_ids) != len(uncertainty):
        raise ValueError("IDs and scores have different lengths")
    return np.asarray(
        sorted(range(len(image_ids)), key=lambda i: (-uncertainty[i], image_ids[i])),
        dtype=np.int64,
    )


def classification_metrics(
    labels: Sequence[str], predictions: Sequence[str], classes: Sequence[str]
) -> dict:
    labels, predictions, classes = list(labels), list(predictions), list(classes)
    if not labels or len(labels) != len(predictions):
        raise ValueError("A non-empty, aligned validation set is required")
    if len(classes) < 2 or len(set(classes)) != len(classes):
        raise ValueError("Classes must be unique, with at least two classes")
    index = {label: i for i, label in enumerate(classes)}
    if not set(labels + predictions).issubset(index):
        raise ValueError("An unknown class occurs in labels or predictions")
    confusion = np.zeros((len(classes), len(classes)), dtype=np.int64)
    for label, prediction in zip(labels, predictions, strict=True):
        confusion[index[label], index[prediction]] += 1
    true_counts = confusion.sum(axis=1)
    predicted_counts = confusion.sum(axis=0)
    correct = confusion.diagonal()
    denominators = true_counts + predicted_counts
    f1 = np.divide(
        2 * correct,
        denominators,
        out=np.zeros(len(classes), dtype=np.float64),
        where=denominators != 0,
    )
    return {
        "classes": classes,
        "accuracy": float(correct.sum() / len(labels)),
        "macro_f1": float(f1.mean()),
        "recall_per_class": {
            label: float(correct[i] / true_counts[i]) if true_counts[i] else None
            for i, label in enumerate(classes)
        },
        "support_per_class": dict(zip(classes, true_counts.tolist(), strict=True)),
        "f1_per_class": dict(zip(classes, f1.tolist(), strict=True)),
        "confusion_matrix": confusion.tolist(),
        "confusion_axes": {"rows": "reference", "columns": "prediction"},
        "macro_f1_zero_division": 0,
    }


def _distribution(values: np.ndarray) -> dict:
    return {
        "mean": float(values.mean()),
        "std": float(values.std(ddof=0)),
        "q025": float(np.quantile(values, 0.025)),
        "q50": float(np.quantile(values, 0.5)),
        "q975": float(np.quantile(values, 0.975)),
        "min": int(values.min()),
        "max": int(values.max()),
        "frequency": {
            str(count): frequency
            for count, frequency in sorted(Counter(values.tolist()).items())
        },
    }


def review_comparison(
    image_ids: Sequence[str],
    probabilities: np.ndarray,
    errors: Sequence[bool],
    *,
    budgets: Sequence[float] = (0.05, 0.10, 0.20, 0.40),
    random_repeats: int = 1000,
    random_seed: int = 20260912,
) -> dict:
    """Compare equal-size queues on one fixed collection, not independent patients.

    Each random repeat is a uniform permutation without replacement. Its prefixes
    give nested budgets. Canonical ID ordering makes input row order irrelevant.
    Quantiles describe random queue variability, not statistical confidence bounds.
    """
    image_ids = list(image_ids)
    n_images = len(image_ids)
    order = priority_order(image_ids, probabilities)
    error_values = np.asarray(errors)
    if n_images == 0 or error_values.shape != (n_images,):
        raise ValueError("A non-empty, aligned error vector is required")
    if not np.isin(error_values, [False, True]).all():
        raise ValueError("Errors must contain only zero/one or boolean values")
    if not budgets or any(not math.isfinite(b) or not 0 < b <= 1 for b in budgets):
        raise ValueError("Budgets must be fractions greater than zero and at most one")
    if len(set(budgets)) != len(budgets):
        raise ValueError("Budgets must be unique")
    if not isinstance(random_repeats, int) or random_repeats < 1:
        raise ValueError("At least one random repetition is required")
    error_values = error_values.astype(np.int64)
    budgets = sorted(budgets)
    review_counts = np.asarray([math.ceil(b * n_images) for b in budgets])
    total_errors = int(error_values.sum())
    ranked_cumulative = np.cumsum(error_values[order])
    canonical = np.asarray(sorted(range(n_images), key=lambda i: image_ids[i]))
    canonical_errors = error_values[canonical]
    rng = np.random.default_rng(random_seed)
    random_counts = np.empty((random_repeats, len(budgets)), dtype=np.int64)
    for repeat in range(random_repeats):
        cumulative = np.cumsum(canonical_errors[rng.permutation(n_images)])
        random_counts[repeat] = cumulative[review_counts - 1]
    results = []
    for i, (fraction, reviewed) in enumerate(zip(budgets, review_counts, strict=True)):
        found = int(ranked_cumulative[reviewed - 1])
        random_summary = _distribution(random_counts[:, i])
        results.append(
            {
                "fraction": fraction,
                "n_reviewed": int(reviewed),
                "actual_fraction": float(reviewed / n_images),
                "uncertainty": {
                    "errors_found": found,
                    "error_recall": found / total_errors if total_errors else None,
                    "error_precision": float(found / reviewed),
                },
                "random": {
                    "errors_found": random_summary,
                    "error_recall": {
                        key: random_summary[key] / total_errors
                        for key in ("mean", "std", "q025", "q50", "q975")
                    }
                    if total_errors
                    else None,
                    "expected_errors_theoretical": float(reviewed * total_errors / n_images),
                },
                "extra_errors_vs_random_mean": found - random_summary["mean"],
                "lift_vs_random_mean": found / random_summary["mean"]
                if random_summary["mean"]
                else None,
            }
        )
    return {
        "status": "exploratory_validation_only",
        "n_images": n_images,
        "total_errors": total_errors,
        "priority": "normalized_entropy",
        "tie_breaker": "image_id_ascending_lexical",
        "priority_uses_reference_labels": False,
        "budget_rounding": "ceil",
        "random_repeats": random_repeats,
        "random_seed": random_seed,
        "random_generator": "numpy.default_rng/PCG64",
        "random_sampling": "uniform_permutation_without_replacement_with_nested_budgets",
        "quantiles_interpretation": "Variability of random queues on this fixed validation set; not confidence intervals or patient-level uncertainty.",
        "order": [image_ids[int(i)] for i in order],
        "budgets": results,
    }
