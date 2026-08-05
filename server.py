#!/usr/bin/env python3
import json
import mimetypes
import os
import posixpath
import re
import tempfile
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import quote, unquote, urlparse

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DIST_DIR = os.path.join(BASE_DIR, "ui", "dist")
REVIEWS_PATH = os.path.join(BASE_DIR, "reviews.json")
ALLOWED_SERIES = ("t1", "flair", "t1_overlay", "flair_overlay")
DICOM_SERIES = ALLOWED_SERIES + ("pdf",)
SUBJECT_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


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


def derive_subject_id(entry):
    filename_ids = []
    for series_key in DICOM_SERIES:
        for filename in list_regular_files(os.path.join(entry.path, series_key)):
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

        available = {
            key: bool(list_regular_files(os.path.join(entry.path, key)))
            for key in ALLOWED_SERIES
        }
        available["pdf"] = (
            os.path.isfile(os.path.join(entry.path, "report.pdf"))
            or bool(list_regular_files(os.path.join(entry.path, "pdf")))
        )

        subjects.append({"id": subject_id, "dir_name": entry.name, "available": available})

    subjects.sort(key=lambda subject: natural_key(subject["id"]))
    return subjects


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


def get_series_files(subject_id, series_key):
    subject = get_subject(subject_id)
    if series_key not in DICOM_SERIES or not subject:
        return None
    folder = os.path.join(subject_dir(subject), series_key)
    return list_regular_files(folder)


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
        if self.path.startswith("/api/subjects/") and "/files/" in self.path:
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

        if len(parts) == 5 and parts[:2] == ["api", "subjects"] and parts[3] == "series" and parts[4] == "manifest":
            return self.send_error(404, "Missing series key")

        if len(parts) == 6 and parts[:2] == ["api", "subjects"] and parts[3] == "series" and parts[5] == "manifest":
            return self.send_manifest(parts[2], parts[4])

        if len(parts) == 7 and parts[:2] == ["api", "subjects"] and parts[3] == "series" and parts[5] == "files":
            return self.send_series_file(parts[2], parts[4], parts[6])

        if len(parts) == 4 and parts[:2] == ["api", "subjects"] and parts[3] == "report":
            return self.send_report(parts[2])

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

    def send_manifest(self, subject_id, series_key):
        files = get_series_files(subject_id, series_key)
        if files is None:
            return self.send_error(404, "Unknown subject or series")
        if not files:
            return self.send_error(404, "No DICOM files for this series")

        lines = []
        for index, filename in enumerate(files):
            url = (
                f"/api/subjects/{quote(subject_id, safe='')}/series/"
                f"{quote(series_key, safe='')}/files/{index}?name={quote(filename)}"
            )
            lines.append(url)
        return self.send_text("\n".join(lines) + "\n")

    def send_series_file(self, subject_id, series_key, index_text):
        files = get_series_files(subject_id, series_key)
        if files is None:
            return self.send_error(404, "Unknown subject or series")
        try:
            index = int(index_text)
        except ValueError:
            return self.send_error(404, "Unknown file")
        if index < 0 or index >= len(files):
            return self.send_error(404, "Unknown file")

        filename = files[index]
        subject = get_subject(subject_id)
        path = os.path.realpath(os.path.join(subject_dir(subject), series_key, filename))
        root = os.path.realpath(os.path.join(subject_dir(subject), series_key))
        if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
            return self.send_error(404, "Unknown file")

        return self.send_file(path, "application/dicom")

    def send_report(self, subject_id):
        subject = get_subject(subject_id)
        if not subject or not subject["available"]["pdf"]:
            return self.send_error(404, "No report PDF for this subject")
        path = os.path.realpath(os.path.join(subject_dir(subject), "report.pdf"))
        root = os.path.realpath(subject_dir(subject))
        if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
            return self.send_error(404, "No report PDF for this subject")
        return self.send_file(path, "application/pdf")

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
                    "Frontend build not found. Run `npm --prefix ui install` and `npm --prefix ui run build` first.\n",
                    status=503,
                )

        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        return self.send_file(path, content_type)


if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Serving on http://127.0.0.1:{PORT}/")
    httpd.serve_forever()
