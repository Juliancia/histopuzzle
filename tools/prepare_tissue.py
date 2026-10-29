"""Przygotowanie prawdziwego preparatu (WSI) do gry HistoPuzzle.

Skrypt otwiera skan całego preparatu (np. .svs z TCGA albo .tif z CAMELYON16), wycina
kwadratowy fragment w pełnej rozdzielczości, zapisuje miniaturę całego szkiełka i aktualizuje
wpis w ``assets/tissues/manifest.json``. Do repozytorium trafiają tylko te dwa małe pliki JPG,
a nie wielogigabajtowy skan.

Wymagania::

    brew install openslide
    pip install openslide-python pillow

Przykład::

    python3 tools/prepare_tissue.py ~/wsi/tumor_001.tif --id lymph_node \
        --credit "CAMELYON16, Radboud UMC / UMC Utrecht" --license "CC0 1.0"

Bez ``--x/--y`` skrypt sam wybiera miejsce z największą ilością tkanki.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

GAME_DIR = Path(__file__).resolve().parent.parent
MANIFEST = GAME_DIR / "assets" / "tissues" / "manifest.json"


def parse_args() -> argparse.Namespace:
    """Wczytuje argumenty wiersza poleceń.

    Returns:
        Przestrzeń nazw z ustawieniami skryptu.
    """
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("slide", type=Path, help="Ścieżka do pliku WSI (.svs, .tif, .ndpi, …).")
    parser.add_argument("--id", required=True, help="Identyfikator tkanki w manifeście (np. skin, lymph_node).")
    parser.add_argument("--x", type=int, help="Środek fragmentu w pikselach poziomu 0 (oś X).")
    parser.add_argument("--y", type=int, help="Środek fragmentu w pikselach poziomu 0 (oś Y).")
    parser.add_argument("--size", type=int, default=1536, help="Bok fragmentu w pikselach poziomu 0 (domyślnie 1536).")
    parser.add_argument("--out-size", type=int, default=1024, help="Bok zapisanego fragmentu w pikselach.")
    parser.add_argument("--thumb-width", type=int, default=1200, help="Szerokość miniatury całego preparatu.")
    parser.add_argument("--credit", help="Autor lub źródło obrazu (pokazywane w grze).")
    parser.add_argument("--license", help="Licencja obrazu, np. 'CC0 1.0' lub 'CC BY 4.0'.")
    return parser.parse_args()


def tissue_mask(thumb: Image.Image) -> np.ndarray:
    """Wyznacza maskę tkanki na miniaturze (odróżnia tkankę od pustego szkła).

    Args:
        thumb: Miniatura preparatu w RGB.

    Returns:
        Tablica logiczna o wymiarach miniatury; True oznacza tkankę.
    """
    rgb = np.asarray(thumb.convert("RGB"), dtype=np.int16)
    saturation = rgb.max(axis=2) - rgb.min(axis=2)
    brightness = rgb.max(axis=2)
    return (saturation > 22) | (brightness < 200)


def pick_region(mask: np.ndarray, window: int) -> tuple[int, int]:
    """Znajduje na miniaturze okno o największym udziale tkanki.

    Args:
        mask: Maska tkanki z :func:`tissue_mask`.
        window: Bok okna w pikselach miniatury.

    Returns:
        Środek najlepszego okna (x, y) w pikselach miniatury.

    Raises:
        ValueError: Gdy na miniaturze nie ma żadnej tkanki.
    """
    if not mask.any():
        raise ValueError("Na miniaturze nie wykryto tkanki – podaj --x i --y ręcznie.")
    window = max(1, window)
    integral = np.pad(mask.astype(np.int32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    h, w = mask.shape
    best, best_xy = -1, (w // 2, h // 2)
    for y in range(0, max(1, h - window), max(1, window // 2)):
        for x in range(0, max(1, w - window), max(1, window // 2)):
            total = integral[y + window, x + window] - integral[y, x + window] - integral[y + window, x] + integral[y, x]
            if total > best:
                best, best_xy = total, (x + window // 2, y + window // 2)
    return best_xy


def update_manifest(tissue_id: str, entry_update: dict) -> None:
    """Aktualizuje (albo dodaje) wpis tkanki w manifeście gry.

    Args:
        tissue_id: Identyfikator tkanki.
        entry_update: Pola do nadpisania we wpisie.
    """
    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entry = next((e for e in entries if e["id"] == tissue_id), None)
    if entry is None:
        entry = {"id": tissue_id, "name": tissue_id, "difficulty": "?", "level": 3, "description": ""}
        entries.append(entry)
    entry.update(entry_update)
    MANIFEST.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    """Wycina fragment i miniaturę z WSI oraz aktualizuje manifest."""
    import openslide  # import tutaj, żeby --help działało bez zainstalowanej biblioteki

    args = parse_args()
    slide = openslide.OpenSlide(str(args.slide))
    width, height = slide.dimensions
    thumb = slide.get_thumbnail((args.thumb_width, args.thumb_width * height // width)).convert("RGB")
    scale = width / thumb.width

    if args.x is None or args.y is None:
        tx, ty = pick_region(tissue_mask(thumb), round(args.size / scale * 4))
        cx, cy = round(tx * scale), round(ty * scale)
    else:
        cx, cy = args.x, args.y
    left, top = cx - args.size // 2, cy - args.size // 2

    fragment = slide.read_region((left, top), 0, (args.size, args.size)).convert("RGB")
    fragment = fragment.resize((args.out_size, args.out_size), Image.LANCZOS)

    out_dir = MANIFEST.parent
    fragment_path = out_dir / f"{args.id}_fragment.jpg"
    thumb_path = out_dir / f"{args.id}_thumb.jpg"
    fragment.save(fragment_path, quality=90)
    thumb.save(thumb_path, quality=85)

    mpp = float(slide.properties.get(openslide.PROPERTY_NAME_MPP_X, 0.25))
    magnification = slide.properties.get(openslide.PROPERTY_NAME_OBJECTIVE_POWER, "40")
    update = {
        "source": {
            "type": "image",
            "fragment": f"assets/tissues/{fragment_path.name}",
            "thumbnail": f"assets/tissues/{thumb_path.name}",
            "region": [left / width, top / height, args.size / width, args.size / height],
        },
        "slide": {
            "width": width, "height": height, "mpp": round(mpp, 4),
            "magnification": f"{magnification}×", "fragmentSize": args.size,
        },
    }
    if args.credit:
        update["credit"] = args.credit
    if args.license:
        update["license"] = args.license
    update_manifest(args.id, update)
    print(f"Zapisano {fragment_path.name} i {thumb_path.name}; preparat {width}×{height} px, fragment w ({left}, {top}).")


if __name__ == "__main__":
    main()
