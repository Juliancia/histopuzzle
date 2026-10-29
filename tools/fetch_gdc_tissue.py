"""Pobieranie prawdziwych preparatów H&E z archiwum TCGA (GDC) bez ściągania całych skanów.

Pełny plik .svs ma setki MB, a gra potrzebuje tylko miniatury szkiełka i jednego wycinka.
API GDC udostępnia skany jako piramidę kafelków DeepZoom (``/tile/{file_id}``), więc
skrypt pobiera wyłącznie potrzebne kafelki i skleja je lokalnie. Rozdzielczość (µm/piksel)
odczytuje z nagłówka TIFF pliku .svs zapytaniami HTTP Range (kilka kilobajtów).

Polecenia::

    # 1) lista otwartych preparatów diagnostycznych z projektu TCGA
    python3 tools/fetch_gdc_tissue.py list TCGA-DLBC

    # 2) miniatura kandydata do obejrzenia (np. do katalogu roboczego)
    python3 tools/fetch_gdc_tissue.py thumb <file_id> --out /tmp/kandydat.jpg

    # 3) wycinek do gry + aktualizacja assets/tissues/manifest.json
    python3 tools/fetch_gdc_tissue.py fragment <file_id> --id lymph_node --tx 0.42 --ty 0.55

Współrzędne ``--tx/--ty`` to środek wycinka jako ułamek szerokości/wysokości miniatury.

Dane TCGA są publiczne (open access, zasady NIH GDC). W grze podajemy źródło:
„The Cancer Genome Atlas (TCGA), NCI Genomic Data Commons”.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import re
import struct
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare_tissue import MANIFEST, update_manifest  # noqa: E402

API = "https://api.gdc.cancer.gov"
TIMEOUT = 60


def http_get(url: str, byte_range: tuple[int, int] | None = None) -> bytes:
    """Pobiera zasób HTTP (opcjonalnie tylko zakres bajtów).

    Args:
        url: Adres zasobu.
        byte_range: Zakres bajtów ``(od, do)`` włącznie albo None dla całości.

    Returns:
        Treść odpowiedzi.

    Raises:
        urllib.error.URLError: Gdy połączenie się nie powiedzie.
    """
    request = urllib.request.Request(url, headers={"User-Agent": "skn-histo-puzzle/1.0"})
    if byte_range:
        request.add_header("Range", f"bytes={byte_range[0]}-{byte_range[1]}")
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read()


def list_slides(project: str, limit: int) -> list[dict]:
    """Zwraca otwarte preparaty diagnostyczne (H&E, FFPE) z danego projektu TCGA.

    Args:
        project: Identyfikator projektu, np. ``TCGA-COAD``.
        limit: Maksymalna liczba wyników.

    Returns:
        Lista słowników z polami ``file_id``, ``file_name``, ``file_size``.
    """
    filters = {"op": "and", "content": [
        {"op": "in", "content": {"field": "cases.project.project_id", "value": [project]}},
        {"op": "in", "content": {"field": "data_type", "value": ["Slide Image"]}},
        {"op": "in", "content": {"field": "experimental_strategy", "value": ["Diagnostic Slide"]}},
        {"op": "in", "content": {"field": "access", "value": ["open"]}},
    ]}
    query = urllib.parse.urlencode({
        "filters": json.dumps(filters), "fields": "file_id,file_name,file_size", "size": str(limit),
    })
    return json.loads(http_get(f"{API}/files?{query}"))["data"]["hits"]


def slide_metadata(file_id: str) -> dict:
    """Pobiera opis piramidy DeepZoom preparatu.

    Args:
        file_id: Identyfikator pliku w GDC.

    Returns:
        Słownik z polami ``width``, ``height``, ``tile``, ``overlap``, ``max_level``.
    """
    meta = json.loads(http_get(f"{API}/tile/metadata/{file_id}"))
    width, height = int(meta["Width"]), int(meta["Height"])
    return {
        "width": width, "height": height,
        "tile": int(meta["TileSize"]), "overlap": int(meta["Overlap"]),
        "max_level": math.ceil(math.log2(max(width, height))),
    }


def read_mpp(file_id: str) -> tuple[float | None, str | None]:
    """Odczytuje rozdzielczość i powiększenie z opisu Aperio w nagłówku TIFF pliku .svs.

    Czyta kolejne katalogi IFD zapytaniami Range, aż znajdzie tag ImageDescription (270)
    zawierający ``MPP = …``. Obsługuje klasyczny TIFF (tak zapisuje Aperio).

    Args:
        file_id: Identyfikator pliku w GDC.

    Returns:
        Para ``(mpp, powiększenie)``; None, gdy nie udało się ich odczytać.
    """
    url = f"{API}/data/{file_id}"
    header = http_get(url, (0, 7))
    endian = "<" if header[:2] == b"II" else ">"
    if struct.unpack(f"{endian}H", header[2:4])[0] != 42:
        return None, None  # BigTIFF albo nieznany format
    offset = struct.unpack(f"{endian}I", header[4:8])[0]
    for _ in range(4):
        if offset == 0:
            break
        count = struct.unpack(f"{endian}H", http_get(url, (offset, offset + 1)))[0]
        entries = http_get(url, (offset + 2, offset + 2 + count * 12 + 3))
        for i in range(count):
            tag, _type, length, value = struct.unpack(f"{endian}HHII", entries[i * 12:(i + 1) * 12])
            if tag == 270:
                text = http_get(url, (value, value + length - 1)).decode("latin-1") if length > 4 else ""
                mpp = re.search(r"MPP\s*=\s*([\d.]+)", text)
                mag = re.search(r"AppMag\s*=\s*([\d.]+)", text)
                if mpp:
                    return float(mpp.group(1)), mag.group(1) if mag else None
        offset = struct.unpack(f"{endian}I", entries[count * 12:count * 12 + 4])[0]
    return None, None


def read_region(file_id: str, meta: dict, level: int, left: int, top: int, width: int, height: int) -> Image.Image:
    """Skleja z kafelków DeepZoom prostokąt obrazu na danym poziomie piramidy.

    Args:
        file_id: Identyfikator pliku w GDC.
        meta: Wynik :func:`slide_metadata`.
        level: Poziom piramidy (``max_level`` = pełna rozdzielczość).
        left: Lewa krawędź prostokąta w pikselach tego poziomu.
        top: Górna krawędź prostokąta.
        width: Szerokość prostokąta.
        height: Wysokość prostokąta.

    Returns:
        Obraz RGB o wymiarach ``width × height``.
    """
    tile, overlap = meta["tile"], meta["overlap"]
    canvas = Image.new("RGB", (width, height), (243, 241, 244))
    for row in range(top // tile, (top + height - 1) // tile + 1):
        for col in range(left // tile, (left + width - 1) // tile + 1):
            data = http_get(f"{API}/tile/{file_id}?level={level}&x={col}&y={row}")
            img = Image.open(io.BytesIO(data)).convert("RGB")
            # Kafelki DeepZoom (poza pierwszą kolumną/wierszem) zaczynają się `overlap` pikseli wcześniej.
            x0 = col * tile - (overlap if col > 0 else 0)
            y0 = row * tile - (overlap if row > 0 else 0)
            canvas.paste(img, (x0 - left, y0 - top))
            print(f"  kafelek poziom {level} ({col}, {row})", file=sys.stderr)
    return canvas


def thumbnail(file_id: str, meta: dict, max_width: int) -> tuple[Image.Image, int]:
    """Pobiera miniaturę całego preparatu z najmniejszego poziomu o szerokości ≥ max_width.

    Args:
        file_id: Identyfikator pliku w GDC.
        meta: Wynik :func:`slide_metadata`.
        max_width: Docelowa szerokość miniatury w pikselach.

    Returns:
        Para ``(miniatura, poziom piramidy)``; miniatura jest przeskalowana do ``max_width``.
    """
    level = meta["max_level"]
    while level > 0 and math.ceil(meta["width"] / 2 ** (meta["max_level"] - level + 1)) >= max_width:
        level -= 1
    scale = 2 ** (meta["max_level"] - level)
    w, h = math.ceil(meta["width"] / scale), math.ceil(meta["height"] / scale)
    image = read_region(file_id, meta, level, 0, 0, w, h)
    image = image.resize((max_width, round(h * max_width / w)), Image.LANCZOS)
    return image, level


def parse_args() -> argparse.Namespace:
    """Wczytuje argumenty wiersza poleceń.

    Returns:
        Przestrzeń nazw z wybranym poleceniem i jego opcjami.
    """
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p_list = sub.add_parser("list", help="Wypisz otwarte preparaty diagnostyczne z projektu TCGA.")
    p_list.add_argument("project")
    p_list.add_argument("--limit", type=int, default=10)
    p_thumb = sub.add_parser("thumb", help="Pobierz miniaturę preparatu do obejrzenia.")
    p_thumb.add_argument("file_id")
    p_thumb.add_argument("--out", type=Path, required=True)
    p_thumb.add_argument("--width", type=int, default=1200)
    p_crop = sub.add_parser("crop", help="Pobierz podgląd wycinka (bez zmian w manifeście).")
    p_crop.add_argument("file_id")
    p_crop.add_argument("--tx", type=float, required=True)
    p_crop.add_argument("--ty", type=float, required=True)
    p_crop.add_argument("--um", type=float, default=380, help="Bok podglądu w mikrometrach.")
    p_crop.add_argument("--level-offset", type=int, default=0, help="O ile poziomów poniżej pełnej rozdzielczości czytać.")
    p_crop.add_argument("--out", type=Path, required=True)
    p_frag = sub.add_parser("fragment", help="Pobierz wycinek i miniaturę do gry, zaktualizuj manifest.")
    p_frag.add_argument("file_id")
    p_frag.add_argument("--id", required=True, help="Identyfikator tkanki w manifeście.")
    p_frag.add_argument("--tx", type=float, required=True, help="Środek wycinka (ułamek szerokości miniatury).")
    p_frag.add_argument("--ty", type=float, required=True, help="Środek wycinka (ułamek wysokości miniatury).")
    p_frag.add_argument("--um", type=float, default=380, help="Bok wycinka w mikrometrach (domyślnie 380 µm).")
    p_frag.add_argument("--out-size", type=int, default=1024, help="Bok zapisanego wycinka w pikselach.")
    p_frag.add_argument("--thumb-width", type=int, default=1200)
    p_frag.add_argument("--name", help="Nazwa pliku .svs (do podpisu źródła).")
    p_frag.add_argument("--rotate", type=int, choices=[0, 180], default=0,
                        help="Obrót wycinka i miniatury (np. 180, gdy naskórek leży na dole skanu).")
    return parser.parse_args()


def main() -> None:
    """Wykonuje wybrane polecenie."""
    args = parse_args()
    if args.command == "list":
        for hit in list_slides(args.project, args.limit):
            print(f"{hit['file_id']}  {hit['file_size'] / 1e6:7.0f} MB  {hit['file_name']}")
        return

    meta = slide_metadata(args.file_id)
    if args.command == "thumb":
        image, _ = thumbnail(args.file_id, meta, args.width)
        image.save(args.out, quality=85)
        print(f"{args.out}  ({meta['width']}×{meta['height']} px na poziomie 0)")
        return

    mpp, magnification = read_mpp(args.file_id)
    if mpp is None:
        mpp = 0.25 if meta["width"] > 60000 else 0.5
        print(f"Nie odczytano MPP z nagłówka, przyjmuję {mpp} µm/px.", file=sys.stderr)
    size = round(args.um / mpp)
    cx, cy = round(args.tx * meta["width"]), round(args.ty * meta["height"])
    left = min(max(0, cx - size // 2), meta["width"] - size)
    top = min(max(0, cy - size // 2), meta["height"] - size)

    if args.command == "crop":
        k = 2 ** args.level_offset
        preview = read_region(args.file_id, meta, meta["max_level"] - args.level_offset, left // k, top // k, size // k, size // k)
        preview.save(args.out, quality=85)
        print(f"{args.out}  (MPP {mpp}, {size}×{size} px na poziomie 0)")
        return

    fragment = read_region(args.file_id, meta, meta["max_level"], left, top, size, size)
    fragment = fragment.resize((args.out_size, args.out_size), Image.LANCZOS)
    thumb, _ = thumbnail(args.file_id, meta, args.thumb_width)

    region = [left / meta["width"], top / meta["height"], size / meta["width"], size / meta["height"]]
    if args.rotate == 180:
        fragment = fragment.rotate(180)
        thumb = thumb.rotate(180)
        region = [1 - region[0] - region[2], 1 - region[1] - region[3], region[2], region[3]]

    out_dir = MANIFEST.parent
    fragment_path = out_dir / f"{args.id}_fragment.jpg"
    thumb_path = out_dir / f"{args.id}_thumb.jpg"
    fragment.save(fragment_path, quality=90)
    thumb.save(thumb_path, quality=85)

    case = args.name.split(".")[0] if args.name else args.file_id
    update_manifest(args.id, {
        "source": {
            "type": "image",
            "fragment": f"assets/tissues/{fragment_path.name}",
            "thumbnail": f"assets/tissues/{thumb_path.name}",
            "region": region,
        },
        "slide": {
            "width": meta["width"], "height": meta["height"], "mpp": round(mpp, 4),
            "magnification": f"{magnification or round(10 / mpp)}×", "fragmentSize": size,
        },
        "credit": f"TCGA, NCI Genomic Data Commons ({case})",
        "license": "TCGA open access",
    })
    print(f"Zapisano {fragment_path.name}, {thumb_path.name}; MPP {mpp}, wycinek {size}×{size} px w ({left}, {top}).")


if __name__ == "__main__":
    main()
