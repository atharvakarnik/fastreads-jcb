#!/usr/bin/env python3
import argparse
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
UI_DIR = BASE_DIR / "ui"
DIST_DIR = UI_DIR / "dist"
SHIPMENT_DIR = BASE_DIR / "shipment"
ZIP_PATH = SHIPMENT_DIR / "fastreads-jcb.zip"
BUILD_INFO_PATH = SHIPMENT_DIR / "BUILD_INFO.txt"
RUNTIME_FILES = (
    "server.py",
    "Start_Viewer.sh",
    "Start_Viewer.command",
    "Start_Viewer.bat",
    "INSTALLATIONS.md",
)


def run(command, cwd=BASE_DIR, capture=False):
    result = subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    return result.stdout.strip() if capture else ""


def require_command(name):
    path = shutil.which(name)
    if not path:
        raise RuntimeError(f"Required build command not found: {name}")
    return path


def git_output(git, *args):
    return run([git, *args], capture=True)


def validate_source_tree():
    missing = [name for name in RUNTIME_FILES if not (BASE_DIR / name).is_file()]
    for name in ("package.json", "package-lock.json"):
        if not (UI_DIR / name).is_file():
            missing.append(f"ui/{name}")
    if missing:
        raise RuntimeError("Missing required source files: " + ", ".join(missing))


def validate_dist():
    index_path = DIST_DIR / "index.html"
    assets_dir = DIST_DIR / "assets"
    if not index_path.is_file() or not assets_dir.is_dir():
        raise RuntimeError("Frontend build did not produce ui/dist/index.html and ui/dist/assets/.")
    if not any(path.is_file() for path in assets_dir.rglob("*")):
        raise RuntimeError("Frontend build produced an empty ui/dist/assets/ directory.")
    symlinks = [path for path in DIST_DIR.rglob("*") if path.is_symlink()]
    if symlinks:
        raise RuntimeError("Frontend build contains unsupported symbolic links.")


def copy_runtime_tree(destination):
    app_dir = destination / "fastreads-jcb"
    app_dir.mkdir()
    for name in RUNTIME_FILES:
        shutil.copy2(BASE_DIR / name, app_dir / name)
    shutil.copytree(DIST_DIR, app_dir / "ui" / "dist")
    return app_dir


def write_zip(staging_dir, target):
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(staging_dir.rglob("*")):
            relative = path.relative_to(staging_dir)
            if path.is_dir():
                info = zipfile.ZipInfo(relative.as_posix().rstrip("/") + "/")
                info.external_attr = (path.stat().st_mode & 0xFFFF) << 16
                archive.writestr(info, b"")
            else:
                archive.write(path, relative.as_posix())


def verify_zip(path):
    forbidden = {"prepare_shipment.py", "package.json", "package-lock.json", "AGENT.md"}
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        required = {
            "fastreads-jcb/server.py",
            "fastreads-jcb/Start_Viewer.sh",
            "fastreads-jcb/Start_Viewer.command",
            "fastreads-jcb/Start_Viewer.bat",
            "fastreads-jcb/INSTALLATIONS.md",
            "fastreads-jcb/ui/dist/index.html",
        }
        missing = required - names
        unexpected = [name for name in names if Path(name).name in forbidden or "/data/" in name]
        if missing:
            raise RuntimeError("Shipment ZIP is missing: " + ", ".join(sorted(missing)))
        if unexpected:
            raise RuntimeError("Shipment ZIP contains excluded files: " + ", ".join(sorted(unexpected)))


def atomic_write_text(path, text):
    temp_path = path.with_name(path.name + ".tmp")
    temp_path.write_text(text, encoding="utf-8")
    os.replace(temp_path, path)


def main():
    parser = argparse.ArgumentParser(description="Build and package the FastReads JCB viewer.")
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="Allow packaging uncommitted source changes for development testing.",
    )
    args = parser.parse_args()

    if sys.version_info < (3, 10):
        raise RuntimeError("Python 3.10 or newer is required to prepare a shipment.")

    validate_source_tree()
    git = require_command("git")
    npm = require_command("npm")
    commit = git_output(git, "rev-parse", "HEAD")
    status = git_output(git, "status", "--porcelain", "--untracked-files=all")
    is_dirty = bool(status)
    if is_dirty and not args.allow_dirty:
        raise RuntimeError("Git working tree is not clean. Commit the release changes before preparing a shipment.")
    if is_dirty:
        print("WARNING: Preparing a development shipment from a dirty Git working tree.", flush=True)

    print("Installing locked frontend dependencies...", flush=True)
    run([npm, "--prefix", str(UI_DIR), "ci"])
    print("Building fresh frontend distribution files...", flush=True)
    run([npm, "--prefix", str(UI_DIR), "run", "build"])
    validate_dist()

    print("Checking Python backend syntax...", flush=True)
    run([sys.executable, "-m", "py_compile", str(BASE_DIR / "server.py")])

    if git_output(git, "rev-parse", "HEAD") != commit:
        raise RuntimeError("Git commit changed while the shipment was being prepared. Run it again.")
    if not is_dirty and git_output(git, "status", "--porcelain", "--untracked-files=all"):
        raise RuntimeError("The build changed tracked source files. Review them before preparing a shipment.")

    package = json.loads((UI_DIR / "package.json").read_text(encoding="utf-8"))
    built_at = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()

    SHIPMENT_DIR.mkdir(exist_ok=True)
    temp_zip = SHIPMENT_DIR / "fastreads-jcb.zip.tmp"
    try:
        with tempfile.TemporaryDirectory(prefix="fastreads-jcb-shipment-") as temp_dir:
            staging_dir = Path(temp_dir)
            copy_runtime_tree(staging_dir)
            write_zip(staging_dir, temp_zip)
        verify_zip(temp_zip)
        checksum = hashlib.sha256(temp_zip.read_bytes()).hexdigest()
        os.replace(temp_zip, ZIP_PATH)
    finally:
        if temp_zip.exists():
            temp_zip.unlink()

    build_info = (
        f"Application: FastReads JCB\n"
        f"Version: {package.get('version', 'unknown')}\n"
        f"Git commit: {commit}\n"
        f"Git working tree: {'dirty development build' if is_dirty else 'clean'}\n"
        f"Built at (UTC): {built_at}\n"
        f"Archive: {ZIP_PATH.name}\n"
        f"SHA-256: {checksum}\n"
        f"Data included: no\n"
    )
    atomic_write_text(BUILD_INFO_PATH, build_info)

    print("")
    print(f"Shipment ready: {ZIP_PATH}")
    print(f"Build information: {BUILD_INFO_PATH}")
    print("Subject data is not included and must be supplied separately.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
