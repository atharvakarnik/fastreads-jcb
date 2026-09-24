# FastReads JCB maintenance guide

This repository is a functioning local NIfTI review viewer. Modify only this repository. The neighboring `fastreads` repository is a read-only historical reference and does not need to be inspected for routine work.

Keep the application small and local. It uses a Python standard-library server and a vanilla HTML, CSS, and JavaScript frontend built with Vite and NiiVue. Do not introduce a frontend framework or a configuration layer without a concrete need.

## Project layout

```text
fastreads-jcb/
├── data/                    # local medical data; ignored by Git
├── ui/
│   ├── index.html
│   ├── main.js
│   ├── styles.css
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.js
│   └── dist/                # generated frontend build
├── server.py
├── reviews.json             # generated locally; ignored by Git
├── prepare_shipment.py      # maintainer-only release builder
├── installations.txt        # static end-user and IT requirements
├── Start_Viewer.sh
├── Start_Viewer.command
├── Start_Viewer.bat
└── shipment/                # generated release files; ignored by Git
```

Resolve data relative to `server.py`:

```python
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
```

Do not add environment variables, `.env` files, command-line data-path configuration, or automatic data-folder creation. Keep `data/`, `reviews.json`, and `shipment/` ignored by Git.

## Data contract

Each subject uses this layout:

```text
data/<subject_folder>/
├── t1/
├── flair/
├── t1_overlay/
├── flair_overlay/
├── pdf/                     # optional DICOM report pages
└── report.pdf               # optional alternative to pdf/
```

Each imaging folder may contain exactly one `.nii` or `.nii.gz` file. Ignore unrelated files, including legacy DICOM and JSON sidecars. A folder with no NIfTI file makes its view unavailable. Multiple NIfTI files are ambiguous and must produce a useful error rather than selecting one silently.

The T1 + Overlay and FLAIR + Overlay views each load two NIfTI volumes: the corresponding base image and its overlay. An overlay view is available only when both files exist. Preserve the overlay visibility and opacity controls. Do not mutate RGB voxel bytes to create transparency; NiiVue volume opacity handles display blending.

Subject IDs are derived from the first six filename characters when they are six digits. If no imaging NIfTI filename begins with six digits, use the subject folder name. This convention is provisional until representative production filenames are available.

PDF reports may be supplied as `report.pdf` or as DICOM image pages inside `pdf/`. The DICOM parsing code in `server.py` is only for rendering those report pages as PNG. Do not route imaging modalities through the DICOM report parser.

## Application behavior

The selectable views are:

1. T1
2. FLAIR
3. T1 + Overlay
4. FLAIR + Overlay
5. PDF

Display only the selected view. Missing resources disable only their corresponding tabs. Remember the selected tab while moving between subjects when it remains available; otherwise select the first available tab. Prevent stale asynchronous loads from replacing a newer subject or tab.

The viewer retains slice navigation, per-pane zoom and reset, crosshair visibility, responsive resizing, overlay visibility and opacity, image window/level controls, and continuous report-page scrolling with PDF zoom controls.

## Backend API

`server.py` binds only to `127.0.0.1` and serves `ui/dist/`.

```text
GET  /api/subjects
GET  /api/subjects/<subject_id>/series/<series_key>/volume
GET  /api/subjects/<subject_id>/report
GET  /api/subjects/<subject_id>/report-pages
GET  /api/subjects/<subject_id>/report-pages/<index>.png
GET  /api/reviews
POST /api/reviews
```

Allowed imaging series keys are `t1`, `flair`, `t1_overlay`, and `flair_overlay`. The volume endpoint serves the single NIfTI file from the selected folder. Validate subjects and series keys against discovered local data, prevent directory traversal, and never accept arbitrary filesystem paths.

Store review data in root-level `reviews.json`. Write changes atomically with a temporary file followed by replacement, and reject unknown subject IDs.

## Frontend

Use `@niivue/niivue` to load NIfTI volumes. Do not add `@niivue/dicom-loader`; the browser should make one volume request per loaded modality. Overlay tabs intentionally make two volume requests, one for the base and one for the overlay.

Keep the current left sidebar, subject navigation, status messages, tab layout, toolbar, review controls, and local preservation of review edits. Do not expose identifying metadata or filenames in the interface or logs.

## Privacy and safety

Do not:

- commit medical files, generated reviews, or sample reports
- remove `data/` or `reviews.json` from `.gitignore`
- display or log identifying image metadata
- add analytics, telemetry, uploads, or external API calls
- expose arbitrary filesystem access
- claim clinical or diagnostic validation
- use `git add -f` for ignored medical data

## Launch, shipment, and checks

The platform launchers use the prebuilt frontend in `ui/dist/` and start `server.py`. They must not require Node.js, npm, dependency installation, or a frontend build. On macOS, `Start_Viewer.command` delegates to `Start_Viewer.sh`; Windows uses `Start_Viewer.bat`. Missing or outdated Python errors must identify the requirement and direct the user to root-level `installations.txt`.

For development builds:

```bash
npm --prefix ui install
npm --prefix ui run build
python3 server.py
```

Create user-facing releases only through:

```bash
python3 prepare_shipment.py
```

The shipment command requires a clean Git working tree, installs the exact locked frontend dependencies, builds `ui/dist/` fresh, and atomically replaces `shipment/fastreads-jcb.zip`. It writes release metadata to `shipment/BUILD_INFO.txt`. By default, the ZIP contains only the backend, platform launchers, `installations.txt`, and the prebuilt frontend. The ZIP must not contain source-only files, Node.js dependencies, Git metadata, or review files.

Use `python3 prepare_shipment.py --include-data` only when the intended shipment must contain the ignored local `data/` tree. This opt-in requires a nonempty `data/`, rejects symbolic links, records `Data included: yes` in `BUILD_INFO.txt`, and makes the resulting ZIP sensitive medical data. The default command must continue to exclude data.

`--allow-dirty` is only for development testing of the packaging process. Do not distribute a dirty shipment.

Before completing code changes, run:

```bash
python3 -m py_compile server.py
npm --prefix ui run build
git diff --check
git ls-files data
```

Also verify subject discovery, missing-tab behavior, NIfTI response content and size, invalid subject/series rejection, PDF rendering, review persistence, stale-load protection, and RGB overlay rendering with de-identified sample data when available.
