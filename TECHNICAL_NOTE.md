# CellReview technical note

**Author: David Méndez Merino**

This note summarizes the frozen experiment and the static demonstration built from its saved outputs. The measurements below describe the experiment and its verification, not an independent clinical assessment.

## Data and split

The source is original [PBC v1](https://doi.org/10.17632/snkd93bnjr.1), not a resized derivative dataset. The local audit found 17,092 valid JPEG images. It removed 16 redundant exact copies and quarantined both images in one exact-duplicate pair with conflicting labels. Two additional candidate near-duplicate pairs were kept in indivisible groups.

The frozen split contains **10,246 training, 3,414 development validation and 3,414 final test images**. Duplicate/similarity grouping addresses detected overlap only. Available filenames do not establish patient identities or a patient-independent split. All three partitions come from the same source.

Training data fitted the classifier. Development validation supported the assessment of the method during development. The final test remained reserved until the method and evaluation protocol were fixed. The demo displays this final test; validation results are retained below and in the [validation data file](data/validation.json).

## Frozen method

Frozen ResNet18 features and logistic regression were chosen as a manageable CPU baseline, keeping feature extraction separate from classifier fitting. The aim was to test review prioritisation with a reproducible reference before considering a more complex model.

1. **Preprocessing:** RGB; bilinear shortest-side resize to 256 pixels, flooring the other dimension; central 224 × 224 crop with rounded offset; float32 divided by 255; ImageNet channel normalization; NCHW layout. See [Data notice](DATA_NOTICE.md).
2. **Features:** a frozen ImageNet-pretrained ResNet18-v1, exported from MXNet and obtained from [ONNX Model Zoo](https://github.com/onnx/models/tree/main/validated/vision/classification/resnet). The `flatten_170` tensor supplies 512 features per image. This is distinct from torchvision's `IMAGENET1K_V1` weight set.
3. **Classifier:** StandardScaler followed by multiclass logistic regression (`C=1`, `solver=lbfgs`, `max_iter=2000`), fitted using training data only. The retained fit converged after 184 iterations. No calibration was applied.
4. **Priority:** normalized entropy of the eight class scores, divided by `log(8)`, sorted descending with lexical image-ID tie-breaking. Reference labels do not enter the ranking.
5. **Comparison:** review fractions 5%, 10%, 20% and 40%, rounded up. The random baseline uses 1,000 uniform permutations without replacement, PCG64 seed `20260912`, canonical image-ID order and nested prefixes of equal size.

The evaluation ran locally on CPU with ONNX Runtime 1.23.2 and scikit-learn 1.7.2. The final protocol fixed the classifier, preprocessing, source hashes, ranking and budgets before test inference. There was one final extraction of all 3,414 test images and **zero new model fits, calibration steps or training runs**. Verification reused saved features and predictions.

The original ONNX weights were `resnet18-v1-7.onnx`, SHA-256 `4e8f8653e7a2222b3904cc3fe8e304cd8b339ce1d05fd24688162f86fb6df52c`. They are cited for provenance and **are not included in the static package**. See also the [logistic regression documentation](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html).

## Results and verification

The final test gives **2,870/3,414 matches**, **84.0656% accuracy**, **0.8335173 macro-F1** and **544 disagreements**. At 342 reviews, entropy finds 194 disagreements versus a random mean of 54.281, leaving 350 outside the selection. All four preset budgets are reported in the [project overview](README.md).

At completion of the frozen experiment, the local project record reports **82 software tests passed**, **27/27 final-package integrity checks passed**, and **65 independent recalculation conditions passed** using scikit-learn, SciPy and NumPy on saved CSV outputs. That independent recalculation used a separate computational route on the same predictions; it was not a separate cohort, new model or external clinical validation. Saved-feature inference reproduced the stored scores exactly. An independent entropy calculation differed by at most `3.47e-18` without changing the order.

The later preparation of the static demo passed **96 software tests**, including **14 tests of the static exporter**.

Integrity checks covered hashes, frozen inputs, test membership, dimensions, finite values, score replay, metric/ranking recomputation and preservation of historical files. These checks support internal consistency and traceability; software test counts do not establish generalization or diagnostic safety.

## Recalculate saved results

The [evaluation code and instructions](science/README.md) are included in the demo package. The evaluation module is an unchanged copy of the code used by the local experiment. A small verifier recalculates classification metrics, entropy, review order and the random comparison from the saved image-level scores and labels.

This checks the published results without model weights or image processing. It does not reproduce training or independently validate the classifier on a new cohort.

## Development validation

The same retained model gave **2,864/3,414 matches**, **83.8899% accuracy**, **0.8283063 macro-F1** and **550 disagreements** on the development validation partition.

| Review budget | Images reviewed | Disagreements found by uncertainty | Random mean, 1,000 selections | Disagreements outside the uncertainty selection |
| --- | ---: | ---: | ---: | ---: |
| 5% | 171 | 109 | 27.794 | 441 |
| 10% | 342 | 202 | 55.348 | 348 |
| 20% | 683 | 342 | 110.265 | 208 |
| 40% | 1,366 | 484 | 220.373 | 66 |

At the 10% budget, validation retrieves 202 disagreements, compared with 194 on the final test. The partitions contain different images and different total numbers of disagreements. This is a descriptive comparison of one model across two partitions, not a training improvement or evidence that either partition is an external validation cohort.

The [validation JSON](data/validation.json) preserves image-level predictions, class metrics, the confusion matrix, queue results and the historical pilot comparison. The [final test JSON](data/final_test.json) contains the corresponding final evaluation. Validation remains part of the experiment record even though it is not a separate interactive collection in the demo.

## Static application and scope

The application reads precomputed image-level predictions and experiment summaries for the final test. Image navigation, revealing a reference and marking review progress do not execute the classifier, edit source labels or update metrics. Browser review marks are interaction state, not clinical annotations. Hiding the reference in the interface is an educational affordance, not a blinded study design.

Scores are uncalibrated. Disagreements are relative to dataset labels rather than adjudicated clinical errors. No external-hospital, patient-independent, prospective or human reviewer validation has been established, and time savings were not measured. A method revised after inspecting this test would require a new evaluation not used for selection.

[Project overview](README.md) · [Data notice](DATA_NOTICE.md) · [Open demo](https://huggingface.co/spaces/Dwagga/cellreview)
