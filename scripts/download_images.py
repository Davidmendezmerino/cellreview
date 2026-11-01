"""Download CellReview image assets from the pinned public Space."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import argparse
import hashlib
import json
import tempfile
import urllib.request

REVISION = "53ee806db8538411e18d6bd1ed7c1cf5ed4e72ba"
BASE_URL = f"https://huggingface.co/spaces/Dwagga/cellreview/resolve/{REVISION}/"
ROOT = Path(__file__).resolve().parents[1]


def download(entry):
    relative, expected = entry
    destination = (ROOT / relative).resolve()
    if not destination.is_relative_to(ROOT):
        raise ValueError(f"Path leaves repository: {relative}")
    if destination.exists():
        if (destination.stat().st_size == expected["bytes"]
                and hashlib.sha256(destination.read_bytes()).hexdigest() == expected["sha256"]):
            return False
        raise ValueError(f"Existing file differs; preserved: {relative}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(BASE_URL + relative, headers={"User-Agent": "CellReview-assets/1.0"})
    digest = hashlib.sha256()
    size = 0
    with tempfile.NamedTemporaryFile(dir=destination.parent, suffix=".part", delete=False) as output:
        temporary = Path(output.name)
        with urllib.request.urlopen(request, timeout=90) as response:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
    if size != expected["bytes"] or digest.hexdigest() != expected["sha256"]:
        raise ValueError(f"Integrity check failed; partial preserved at {temporary}")
    temporary.replace(destination)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", choices=("final_test", "validation", "both"), default="final_test")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int, help="Download only the first N selected images for a setup check")
    args = parser.parse_args()
    if args.workers < 1 or (args.limit is not None and args.limit < 1):
        parser.error("workers and limit must be positive")
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    collections = ("final_test", "validation") if args.collection == "both" else (args.collection,)
    entries = [(path, item) for path, item in sorted(manifest["files"].items())
               if any(path.startswith(f"images/{collection}/") for collection in collections)]
    if args.limit is not None:
        entries = entries[:args.limit]
    if not entries:
        raise ValueError("No images found in the original manifest")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        downloaded = sum(pool.map(download, entries))
    print(f"Verified {len(entries)} images; downloaded {downloaded}; reused {len(entries) - downloaded}.")


if __name__ == "__main__":
    main()
