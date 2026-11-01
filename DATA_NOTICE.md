# PBC image attribution and data notice

The blood cell images used in CellReview are from:

**Acevedo, Andrea; Merino, Anna; Alférez, Santiago; Molina, Ángel; Boldú, Laura; Rodellar, José (2020).** *A dataset for microscopic peripheral blood cell images for development of automatic recognition systems*. Mendeley Data, version 1. [DOI: 10.17632/snkd93bnjr.1](https://doi.org/10.17632/snkd93bnjr.1).

Dataset: [Mendeley Data PBC v1](https://data.mendeley.com/datasets/snkd93bnjr/1). Related article: [Data in Brief, DOI: 10.1016/j.dib.2020.105474](https://doi.org/10.1016/j.dib.2020.105474).

The PBC images are licensed under the **Creative Commons Attribution 4.0 International License (CC BY 4.0)**: [license and terms](https://creativecommons.org/licenses/by/4.0/).

## Source and changes

PBC contains 17,092 RGB JPEG images in eight categories, acquired at Hospital Clínic de Barcelona with a CellaVision DM96 analyzer. CellReview uses a subset of the original PBC images selected through its documented audit and data split.

- **Distributed image files:** copied unchanged from the original JPEG files; no image retouching, re-encoding or generative editing was applied to these copies. Export filenames may differ from the original filenames.
- **Display:** the browser scales images to fit the interface. Display size is separate from the model input transformation.
- **Offline model input:** decode as RGB; resize the shorter side to 256 pixels with bilinear interpolation; take a central 224 × 224 crop; convert to floating point, divide by 255, and normalize using ImageNet mean `[0.485, 0.456, 0.406]` and standard deviation `[0.229, 0.224, 0.225]`. These operations produced model inputs, not replacements for the distributed original image files.
- **Added material:** model predictions, scores, uncertainty rankings and review controls are CellReview outputs, not annotations supplied by the dataset authors. Reference labels are retained for retrospective comparison.

CellReview is an independent research and educational demonstration. Attribution does not imply endorsement by the dataset authors, their institutions or the data host. A model–reference disagreement is not a confirmed clinical error.

This notice identifies the license for the PBC image material. It does not grant a license to the application code or third-party model weights. Third-party model weights are not distributed in this static package.

[Back to project overview](README.md) · [Technical note](TECHNICAL_NOTE.md)
