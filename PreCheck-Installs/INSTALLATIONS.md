# FastReads JCB installation and launch

FastReads JCB runs locally on the computer and does not upload data or require an internet connection while in use.

## Required software

- Python 3.10 or newer
- A current version of Chrome, Edge, Firefox, or Safari with WebGL2 enabled

Node.js and npm are not required for the distributed viewer.

## Check this computer

Open the `PreCheck-Installs` folder and run the installation checker for this
computer. It overwrites `install_this.txt` in the same folder with either a short
list for an IT ticket or confirmation that the computer is ready:

- **macOS:** double-click `Check_Installations.command`.
- **Windows:** double-click `Check_Installations.bat`.
- **Linux:** run `bash Check_Installations.command` from a terminal.

The checker itself does not require Python, Node.js, or another installed runtime.

Raise a ticket to IT (_or DIY_) to install Python for all users (in your PC/Laptop) and make the `python3` command available on macOS/Linux or the `py`/`python` command available on Windows.

## Set up the viewer

1. Extract `fastreads-jcb.zip` into an approved, writable location. Do not run it directly from inside the ZIP file.
2. Check whether the extracted `fastreads-jcb` folder already contains `data`. If not, place the separately supplied `data` folder there beside `server.py`.
3. Keep the folder in a location approved for the supplied medical data. The viewer writes `reviews.json` into this folder when reviews are saved.

The resulting layout should begin like this:

```text
fastreads-jcb/
|-- server.py
|-- data/
|   |-- <subject-id>/
|   |   |-- t1/
|   |   |-- flair/
|   |   |-- t1_overlay/
|   |   |-- flair_overlay/
|   |   `-- pdf/
|-- ui/
|   `-- dist/
|-- Start_Viewer.command
|-- Start_Viewer.sh
|-- Start_Viewer.bat
`-- PreCheck-Installs/
    |-- INSTALLATIONS.md
    |-- Check_Installations.command
    `-- Check_Installations.bat
```

Each imaging folder may contain exactly one `.nii` or `.nii.gz` file. A subject may omit resources that are unavailable. Reports may be supplied as DICOM pages inside `pdf/` or as `report.pdf` beside the modality folders.

## Launch

- macOS: double-click `Start_Viewer.command` and keep the Terminal window open.
- Windows: double-click `Start_Viewer.bat` and keep the server window open.
- Linux: run `bash Start_Viewer.sh` from a terminal.

The viewer opens at `http://127.0.0.1:8000/`. It is available only on the local computer. Close the Terminal or server window when finished.

## Common problems

- If Python is missing or too old, send the complete terminal message to IT.
- If no subjects appear, check that `data` is beside `server.py` and follows the displayed directory structure.
- If port 8000 is already in use, close the earlier viewer/server window and launch again.
- If macOS blocks the launcher, right-click `Start_Viewer.command`, choose Open, and confirm the prompt. IT may need to approve the script under workplace security policy.
