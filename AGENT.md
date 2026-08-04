You are working with two repositories:

1. `fastreads` — read-only reference
2. `fastreads-jcb` — the new application and the only repository you may modify

You are currently in `fastreads-jcb` folder. The `fastreads` repository is stored laterally to this folder, under the same parent folder ("Codes and Repos").

Do not modify `fastreads`.

Inspect `fastreads/server.py`, `fastreads/viewer.html`, and its launch scripts before editing. Reuse working subject traversal, slice navigation, zoom, reset zoom, crosshair, resizing, status messages, and review persistence where practical.

Remove all PET-, MNI-, atlas-, VOI-, Centiloid-, and PET-filename-specific behavior.

Implement a minimum viable local DICOM review viewer. Keep the code small and avoid configuration layers, frameworks, abstractions, and files that are not necessary.

## Local data layout

Medical data is stored locally inside the ignored directory:

```text
fastreads-jcb/
└── data/
    └── <subject_id>/
        ├── t1/
        ├── flair/
        ├── t1_overlay/
        ├── flair_overlay/
        └── report.pdf
```

Use a fixed data directory in `server.py`:

```python
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
```

Do not add:

* environment variables
* `.env`
* `.env.example`
* command-line configuration for the data path
* automatic data-folder creation

The existing `data/` entry must remain in `.gitignore`.

DICOM files may have any extension or no extension. Treat every regular file inside a series folder as a possible DICOM file.

## Application behavior

Each subject may have five selectable views:

1. T1
2. FLAIR
3. T1 + Overlay
4. FLAIR + Overlay
5. PDF

The two overlay views are already-created RGB DICOM series. Treat them as independent DICOM series. Do not implement runtime overlay composition.

Display only the selected view.

Missing resources must disable only their corresponding tabs. The subject should remain available.

## Frontend approach

Use vanilla HTML, CSS, and JavaScript.

Use:

* `@niivue/niivue`
* `@niivue/dicom-loader`

A small Vite setup is acceptable because the DICOM loader uses npm, WebAssembly, and a Web Worker. Do not introduce React, Vue, Angular, TypeScript, or another framework.

Keep the number of files minimal. A suitable structure is:

```text
fastreads-jcb/
├── data/
├── index.html
├── main.js
├── styles.css
├── server.py
├── package.json
├── package-lock.json
├── vite.config.js
├── Start_Viewer.sh
├── Start_Viewer.bat
├── .gitignore
├── LICENSE
└── README.md
```

Do not create a separate form-schema file unless it clearly reduces code rather than adding structure.

Remove the copied `viewer.html` once its useful code has been transferred into the new frontend.

## Backend

Implement:

```text
GET /api/subjects
```

Return naturally sorted subject IDs and availability:

```json
{
  "subjects": [
    {
      "id": "TEST001",
      "available": {
        "t1": true,
        "flair": true,
        "t1_overlay": true,
        "flair_overlay": true,
        "pdf": true
      }
    }
  ]
}
```

Implement a DICOM-series manifest endpoint:

```text
GET /api/subjects/<subject_id>/series/<series_key>/manifest
```

Allowed series keys:

```text
t1
flair
t1_overlay
flair_overlay
```

The manifest must use the format required by `@niivue/dicom-loader` and list files in deterministic order.

Implement a safe endpoint for serving individual DICOM files.

Implement:

```text
GET /api/subjects/<subject_id>/report
```

Serve `report.pdf` with:

```text
Content-Type: application/pdf
```

Prevent directory traversal. Do not accept arbitrary filesystem paths. Validate subject IDs and series keys against discovered local data.

Implement:

```text
GET /api/reviews
POST /api/reviews
```

Store review data in:

```text
fastreads-jcb/reviews.json
```

`reviews.json` is already ignored by Git.

Write review changes atomically using a temporary file followed by replacement. Reject unknown subject IDs.

Bind only to:

```text
127.0.0.1
```

Serve the built frontend from `dist/`.

## Interface

Preserve the useful layout of `fastreads`:

* left sidebar
* main viewer area
* subject ID
* subject index and count
* Previous
* Next
* Go to subject ID
* Go to index
* status and error messages
* top viewer toolbar

Add five tab buttons:

* T1
* FLAIR
* T1 + Overlay
* FLAIR + Overlay
* PDF

Remember the selected tab while moving between subjects when that resource exists. Otherwise, select the first available tab.

## DICOM viewer

Create one NiiVue instance and register the DICOM loader.

When loading a series:

1. Clear the previous volume.
2. Fetch the manifest.
3. Load the DICOM series.
4. Show a loading message.
5. Prevent stale asynchronous loads from replacing a newer subject or tab.
6. Show a useful error if loading or conversion fails.
7. Release previous volume resources where practical.

Do not cache decoded volumes for every subject.

If conversion produces no volume, show an error.

If conversion produces multiple candidate volumes, do not use a browser prompt. Show a diagnostic error unless there is a clearly safe deterministic choice.

Do not display or log identifying DICOM metadata.

Actual RGB compatibility must be tested with the supplied de-identified data. Do not claim that RGB works merely because grayscale T1 or FLAIR works.

## PDF view

When PDF is selected:

* hide the NiiVue canvas
* show a full-size iframe or object
* load the subject’s PDF endpoint
* restore the canvas when returning to a DICOM tab

## Viewer controls

Retain or adapt:

* slice navigation
* zoom
* reset zoom
* crosshair visibility
* responsive resizing

Add one brightness control using NiiVue gamma:

```text
Brightness slider: 0.5–2.0
Default: 1.0
Reset button: 1.0
```

Do not implement overlay opacity yet.

## Dummy review form

Add these temporary fields directly in the sidebar:

Assessment:

* Unset
* Option A
* Option B
* Uncertain

Image quality:

* Unset
* Acceptable
* Limited
* Non-diagnostic

Needs follow-up:

* checkbox

Notes:

* multiline text

Include:

* Save button
* saved/unsaved indicator
* independent state per subject
* loading from `/api/reviews`
* saving through `POST /api/reviews`
* preservation of unsaved edits while changing tabs or subjects

These are dummy fields and must not be presented as clinically meaningful.

## Privacy and repository safety

Do not:

* remove `data/` from `.gitignore`
* commit medical files
* create sample DICOM files
* create sample PDFs
* display patient metadata
* add analytics or telemetry
* upload data anywhere
* make external API calls
* expose arbitrary filesystem access
* claim clinical or diagnostic validation

Do not use `git add -f`.

## Launch workflow

Support:

```bash
npm install
npm run build
python server.py
```

Also provide a simple development command using Vite and a proxy to the Python server.

Do not automatically run `npm install` from the launch scripts.

## Required checks

Run:

```bash
python -m py_compile server.py
npm run build
git ls-files data
```

`git ls-files data` must produce no output.

Verify:

* `data/` is resolved relative to `server.py`
* missing `data/` produces a clear error
* subject discovery works
* missing resources disable only their tabs
* invalid subjects and path traversal are rejected
* PDF uses `application/pdf`
* reviews save and reload
* rapid subject or tab changes cannot display stale data
* no PET, MNI, atlas, VOI, or Centiloid labels remain

Do not invent fake DICOM data for tests.

At completion, report:

1. files created, removed, and changed
2. build and syntax-check results
3. commands to run the viewer
4. assumptions made
5. manual tests required for the real RGB series
6. any non-identifying RGB/YBR loading error
