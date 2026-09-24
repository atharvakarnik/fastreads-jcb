#!/usr/bin/env python3
import json
import mimetypes
import os
import posixpath
import re
import struct
import tempfile
import zlib
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import quote, unquote, urlparse

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DIST_DIR = os.path.join(BASE_DIR, "ui", "dist")
REVIEWS_PATH = os.path.join(BASE_DIR, "reviews.json")
IMAGING_SERIES = ("t1", "flair", "t1_overlay", "flair_overlay")
SUBJECT_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
DATA_LAYOUT_EXAMPLE = """\
data/
|-- <ID-1>/
|   |-- t1/
|   |   `-- t1.nii.gz
|   |-- flair/
|   |   `-- flair.nii.gz
|   |-- t1_overlay/
|   |   `-- t1_overlay.nii.gz
|   |-- flair_overlay/
|   |   `-- flair_overlay.nii.gz
|   |-- pdf/
|   |   `-- report-page.dcm
|   `-- report.pdf
`-- <ID-2>/
    |-- t1/
    |   `-- t1.nii
    |-- flair/
    |   `-- flair.nii
    |-- t1_overlay/
    |   `-- t1_overlay.nii
    |-- flair_overlay/
    |   `-- flair_overlay.nii
    |-- pdf/
    |   `-- report-page.dcm
    `-- report.pdf
"""


def natural_key(value):
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value)]


def initial_six_digit_id(filename):
    match = re.match(r"^(\d{6})", filename)
    return match.group(1) if match else None


def is_safe_subject_id(subject_id):
    return bool(subject_id and SUBJECT_ID_RE.fullmatch(subject_id) and subject_id not in {".", ".."})


def subject_dir(record_or_id):
    if isinstance(record_or_id, dict):
        return os.path.join(DATA_DIR, record_or_id["dir_name"])
    record = subject_index().get(record_or_id)
    return os.path.join(DATA_DIR, record["dir_name"] if record else record_or_id)


def list_regular_files(folder):
    if not os.path.isdir(folder):
        return []
    files = []
    for entry in os.scandir(folder):
        if entry.is_file(follow_symlinks=False):
            files.append(entry.name)
    return sorted(files, key=natural_key)


def is_nifti_filename(filename):
    lower = filename.casefold()
    return lower.endswith(".nii") or lower.endswith(".nii.gz")


def list_nifti_files(folder):
    return [filename for filename in list_regular_files(folder) if is_nifti_filename(filename)]


def derive_subject_id(entry):
    filename_ids = []
    for series_key in IMAGING_SERIES:
        for filename in list_nifti_files(os.path.join(entry.path, series_key)):
            file_id = initial_six_digit_id(filename)
            if file_id:
                filename_ids.append(file_id)
    unique_ids = sorted(set(filename_ids), key=natural_key)
    return unique_ids[0] if unique_ids else entry.name


def discover_subject_records():
    subjects = []
    if not os.path.isdir(DATA_DIR):
        return subjects

    for entry in os.scandir(DATA_DIR):
        if not entry.is_dir(follow_symlinks=False):
            continue
        subject_id = derive_subject_id(entry)
        if not is_safe_subject_id(subject_id):
            continue

        nifti_available = {
            key: bool(list_nifti_files(os.path.join(entry.path, key)))
            for key in IMAGING_SERIES
        }
        available = {
            "t1": nifti_available["t1"],
            "flair": nifti_available["flair"],
            "t1_overlay": nifti_available["t1"] and nifti_available["t1_overlay"],
            "flair_overlay": nifti_available["flair"] and nifti_available["flair_overlay"],
        }
        available["pdf"] = (
            os.path.isfile(os.path.join(entry.path, "report.pdf"))
            or bool(list_regular_files(os.path.join(entry.path, "pdf")))
        )

        subjects.append({"id": subject_id, "dir_name": entry.name, "available": available})

    subjects.sort(key=lambda subject: natural_key(subject["id"]))
    return subjects


def warn_if_data_unavailable():
    records = discover_subject_records()
    if os.path.isdir(DATA_DIR) and any(any(record["available"].values()) for record in records):
        return

    print("", flush=True)
    print("WARNING: No viewable subject data was found.", flush=True)
    print(f"Place the data directory beside server.py at: {DATA_DIR}", flush=True)
    print("Each imaging folder may contain exactly one .nii or .nii.gz file.", flush=True)
    print("Modality and report resources may be omitted when unavailable.", flush=True)
    print("Expected directory structure:", flush=True)
    print(DATA_LAYOUT_EXAMPLE, flush=True)


def public_subject(record):
    return {"id": record["id"], "available": record["available"]}


def discover_subjects():
    return [public_subject(record) for record in discover_subject_records()]


def subject_index():
    return {subject["id"]: subject for subject in discover_subject_records()}


def get_subject(subject_id):
    if not is_safe_subject_id(subject_id):
        return None
    return subject_index().get(subject_id)


def get_nifti_files(subject_id, series_key):
    subject = get_subject(subject_id)
    if series_key not in IMAGING_SERIES or not subject:
        return None
    folder = os.path.join(subject_dir(subject), series_key)
    return list_nifti_files(folder)


def get_report_page_files(subject_id):
    subject = get_subject(subject_id)
    if not subject:
        return None
    return list_regular_files(os.path.join(subject_dir(subject), "pdf"))


def read_dicom_value(data, pos, explicit_vr, little_endian=True):
    endian = "<" if little_endian else ">"
    if pos + 8 > len(data):
        return None
    group, element = struct.unpack_from(f"{endian}HH", data, pos)
    pos += 4
    if explicit_vr:
        vr = data[pos:pos + 2].decode("ascii", errors="replace")
        pos += 2
        if vr in {"OB", "OD", "OF", "OL", "OV", "OW", "SQ", "UC", "UR", "UT", "UN"}:
            pos += 2
            length = struct.unpack_from(f"{endian}I", data, pos)[0]
            pos += 4
        else:
            length = struct.unpack_from(f"{endian}H", data, pos)[0]
            pos += 2
    else:
        vr = None
        length = struct.unpack_from(f"{endian}I", data, pos)[0]
        pos += 4

    if length == 0xFFFFFFFF:
        raise ValueError("Encapsulated DICOM pixel data is not supported for report previews.")
    value = data[pos:pos + length]
    pos += length + (length % 2)
    return (group, element), vr, value, pos


def dicom_text(value):
    return value.decode("ascii", errors="ignore").strip(" \0")


def dicom_uint(value, little_endian=True):
    endian = "<" if little_endian else ">"
    if len(value) < 2:
        return None
    return struct.unpack_from(f"{endian}H", value, 0)[0]


def png_chunk(kind, payload):
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def rgb_png_bytes(width, height, rgb):
    stride = width * 3
    raw = bytearray()
    for row in range(height):
        raw.append(0)
        start = row * stride
        raw.extend(rgb[start:start + stride])

    header = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        header
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(bytes(raw), level=6))
        + png_chunk(b"IEND", b"")
    )


def dicom_report_image(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if len(data) < 132 or data[128:132] != b"DICM":
        raise ValueError("Not a supported DICOM file.")

    pos = 132
    transfer_syntax = "1.2.840.10008.1.2.1"
    while pos < len(data):
        parsed = read_dicom_value(data, pos, explicit_vr=True, little_endian=True)
        if parsed is None:
            break
        tag, _vr, value, pos = parsed
        if tag == (0x0002, 0x0010):
            transfer_syntax = dicom_text(value)
        if tag[0] != 0x0002:
            break

    explicit_vr = transfer_syntax != "1.2.840.10008.1.2"
    little_endian = transfer_syntax != "1.2.840.10008.1.2.2"
    values = {}
    pixel_data = None
    while pos < len(data):
        parsed = read_dicom_value(data, pos, explicit_vr=explicit_vr, little_endian=little_endian)
        if parsed is None:
            break
        tag, _vr, value, pos = parsed
        values[tag] = value
        if tag == (0x7FE0, 0x0010):
            pixel_data = value
            break

    rows = dicom_uint(values.get((0x0028, 0x0010), b""), little_endian)
    cols = dicom_uint(values.get((0x0028, 0x0011), b""), little_endian)
    samples = dicom_uint(values.get((0x0028, 0x0002), b"\x01\x00"), little_endian) or 1
    bits_allocated = dicom_uint(values.get((0x0028, 0x0100), b""), little_endian)
    photometric = dicom_text(values.get((0x0028, 0x0004), b""))
    planar_config = dicom_uint(values.get((0x0028, 0x0006), b"\x00\x00"), little_endian) or 0

    if not rows or not cols or bits_allocated != 8 or pixel_data is None:
        raise ValueError("Unsupported DICOM report image.")

    expected = rows * cols * samples
    pixel_data = pixel_data[:expected]
    if samples == 3 and photometric == "RGB":
        if planar_config == 1:
            plane_size = rows * cols
            interleaved = bytearray(expected)
            for i in range(plane_size):
                interleaved[i * 3:i * 3 + 3] = (
                    pixel_data[i],
                    pixel_data[i + plane_size],
                    pixel_data[i + plane_size * 2],
                )
            pixel_data = bytes(interleaved)
        return cols, rows, pixel_data

    if samples == 1 and photometric in {"MONOCHROME1", "MONOCHROME2"}:
        if photometric == "MONOCHROME1":
            pixel_data = bytes(255 - value for value in pixel_data)
        rgb = bytearray(rows * cols * 3)
        for index, value in enumerate(pixel_data[:rows * cols]):
            offset = index * 3
            rgb[offset:offset + 3] = (value, value, value)
        return cols, rows, bytes(rgb)

    raise ValueError("Unsupported DICOM report color format.")


def load_reviews():
    if not os.path.isfile(REVIEWS_PATH):
        return {}
    try:
        with open(REVIEWS_PATH, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        reviews = payload.get("reviews", payload) if isinstance(payload, dict) else {}
        return reviews if isinstance(reviews, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def clean_review(value):
    if not isinstance(value, dict):
        value = {}
    return {
        "notes": str(value.get("notes") or ""),
        "case_status": str(value.get("case_status") or ""),
        "flag_for_review": bool(value.get("flag_for_review")),
        "needs_processing_qc": bool(value.get("needs_processing_qc")),
    }


def write_reviews_atomically(reviews):
    payload = {"reviews": reviews}
    directory = os.path.dirname(REVIEWS_PATH)
    fd, temp_path = tempfile.mkstemp(prefix="reviews.", suffix=".json.tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, REVIEWS_PATH)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        if self.path.startswith("/api/subjects/") and "/volume" in self.path:
            return
        super().log_message(format, *args)

    def send_json(self, obj, status=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_text(self, text, content_type="text/plain; charset=utf-8", status=200):
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        parts = [unquote(part) for part in parsed.path.split("/") if part]

        if parsed.path == "/api/subjects":
            return self.send_json({"subjects": discover_subjects()})

        if parsed.path == "/api/reviews":
            reviews = {
                sid: clean_review(review)
                for sid, review in load_reviews().items()
                if get_subject(sid)
            }
            return self.send_json({"reviews": reviews})

        if len(parts) == 6 and parts[:2] == ["api", "subjects"] and parts[3] == "series" and parts[5] == "volume":
            return self.send_nifti_volume(parts[2], parts[4])

        if len(parts) == 4 and parts[:2] == ["api", "subjects"] and parts[3] == "report":
            return self.send_report(parts[2])

        if len(parts) == 4 and parts[:2] == ["api", "subjects"] and parts[3] == "report-pages":
            return self.send_report_pages(parts[2])

        if len(parts) == 5 and parts[:2] == ["api", "subjects"] and parts[3] == "report-pages":
            return self.send_report_page(parts[2], parts[4])

        return self.serve_frontend(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/reviews":
            return self.send_error(404, "Not Found")

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length).decode("utf-8", errors="replace")
            payload = json.loads(raw_body) if raw_body else {}
        except (ValueError, json.JSONDecodeError):
            return self.send_json({"ok": False, "error": "Invalid JSON body."}, status=400)

        reviews = payload.get("reviews", payload)
        if not isinstance(reviews, dict):
            return self.send_json({"ok": False, "error": "reviews must be an object."}, status=400)

        valid_subjects = set(subject_index().keys())
        unknown = sorted((str(sid) for sid in reviews.keys() if str(sid) not in valid_subjects), key=natural_key)
        if unknown:
            return self.send_json({"ok": False, "error": "Unknown subject ID.", "unknown": unknown}, status=400)

        cleaned = {
            str(sid): clean_review(review)
            for sid, review in reviews.items()
            if str(sid) in valid_subjects
        }
        try:
            write_reviews_atomically(cleaned)
        except OSError as exc:
            return self.send_json({"ok": False, "error": str(exc)}, status=500)

        return self.send_json({"ok": True, "count": len(cleaned)})

    def send_nifti_volume(self, subject_id, series_key):
        files = get_nifti_files(subject_id, series_key)
        if files is None:
            return self.send_error(404, "Unknown subject or series")
        if not files:
            return self.send_json({"error": "No NIfTI file found for this modality."}, status=404)
        if len(files) > 1:
            return self.send_json(
                {"error": "Multiple NIfTI files found for this modality; keep exactly one .nii or .nii.gz file."},
                status=409,
            )

        filename = files[0]
        subject = get_subject(subject_id)
        path = os.path.realpath(os.path.join(subject_dir(subject), series_key, filename))
        root = os.path.realpath(os.path.join(subject_dir(subject), series_key))
        if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
            return self.send_error(404, "Unknown volume")

        content_type = "application/gzip" if filename.casefold().endswith(".gz") else "application/octet-stream"
        return self.send_file(path, content_type)

    def send_report(self, subject_id):
        subject = get_subject(subject_id)
        if not subject or not subject["available"]["pdf"]:
            return self.send_error(404, "No report PDF for this subject")
        path = os.path.realpath(os.path.join(subject_dir(subject), "report.pdf"))
        root = os.path.realpath(subject_dir(subject))
        if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
            return self.send_error(404, "No report PDF for this subject")
        return self.send_file(path, "application/pdf")

    def send_report_pages(self, subject_id):
        files = get_report_page_files(subject_id)
        if files is None:
            return self.send_error(404, "Unknown subject")
        if not files:
            return self.send_error(404, "No DICOM report pages for this subject")

        pages = [
            {
                "index": index,
                "name": filename,
                "url": f"/api/subjects/{quote(subject_id, safe='')}/report-pages/{index}.png",
            }
            for index, filename in enumerate(files)
        ]
        return self.send_json({"pages": pages})

    def send_report_page(self, subject_id, page_name):
        match = re.fullmatch(r"(\d+)\.png", page_name)
        if not match:
            return self.send_error(404, "Unknown report page")
        files = get_report_page_files(subject_id)
        if files is None:
            return self.send_error(404, "Unknown subject")
        index = int(match.group(1))
        if index < 0 or index >= len(files):
            return self.send_error(404, "Unknown report page")

        subject = get_subject(subject_id)
        filename = files[index]
        path = os.path.realpath(os.path.join(subject_dir(subject), "pdf", filename))
        root = os.path.realpath(os.path.join(subject_dir(subject), "pdf"))
        if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
            return self.send_error(404, "Unknown report page")

        try:
            width, height, rgb = dicom_report_image(path)
            data = rgb_png_bytes(width, height, rgb)
        except (OSError, ValueError):
            return self.send_error(415, "Unsupported report page DICOM")

        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, path, content_type):
        try:
            size = os.path.getsize(path)
            with open(path, "rb") as handle:
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(size))
                self.end_headers()
                while True:
                    chunk = handle.read(1024 * 128)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except OSError:
            return self.send_error(404, "File not found")

    def serve_frontend(self, request_path):
        if request_path in {"", "/"}:
            rel_path = "index.html"
        else:
            rel_path = posixpath.normpath(unquote(request_path).lstrip("/"))
            if rel_path.startswith("../"):
                return self.send_error(404, "Not Found")

        path = os.path.realpath(os.path.join(DIST_DIR, rel_path))
        dist_root = os.path.realpath(DIST_DIR)
        if os.path.commonpath([dist_root, path]) != dist_root or not os.path.isfile(path):
            path = os.path.join(DIST_DIR, "index.html")
            if not os.path.isfile(path):
                return self.send_text(
                    "Prebuilt frontend files are missing. Download a complete FastReads JCB shipment.\n",
                    status=503,
                )

        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        return self.send_file(path, content_type)


if __name__ == "__main__":
    warn_if_data_unavailable()
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Serving on http://127.0.0.1:{PORT}/")
    httpd.serve_forever()
