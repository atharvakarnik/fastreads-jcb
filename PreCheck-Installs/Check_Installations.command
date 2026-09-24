#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_FILE="$SCRIPT_DIR/install_this.txt"
TEMP_FILE="$OUTPUT_FILE.tmp"

python_ok=0
python_details="Not detected"
browser_ok=0
browser_details="Not detected"
package_ok=0
needs_action=0

check_python() {
  local candidate

  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
        python_ok=1
        python_details="$($candidate --version 2>&1) ($candidate)"
        return
      fi
      python_details="$($candidate --version 2>&1) ($candidate)"
    fi
  done
}

check_browser() {
  local platform command_name
  platform="$(uname -s 2>/dev/null || printf 'Unknown')"

  if [ "$platform" = "Darwin" ]; then
    if [ -d "/Applications/Google Chrome.app" ]; then
      browser_ok=1
      browser_details="Google Chrome"
    elif [ -d "/Applications/Microsoft Edge.app" ]; then
      browser_ok=1
      browser_details="Microsoft Edge"
    elif [ -d "/Applications/Firefox.app" ]; then
      browser_ok=1
      browser_details="Mozilla Firefox"
    elif [ -d "/Applications/Safari.app" ] || [ -d "/System/Applications/Safari.app" ]; then
      browser_ok=1
      browser_details="Safari"
    fi
    return
  fi

  for command_name in google-chrome chromium chromium-browser microsoft-edge firefox; do
    if command -v "$command_name" >/dev/null 2>&1; then
      browser_ok=1
      browser_details="$command_name"
      return
    fi
  done
}

check_python
check_browser

if [ -f "$PROJECT_DIR/ui/dist/index.html" ]; then
  package_ok=1
fi

if [ "$python_ok" -ne 1 ] || [ "$browser_ok" -ne 1 ] || [ "$package_ok" -ne 1 ]; then
  needs_action=1
fi

{
  printf 'FASTREADS-JCB PRECHECK\n\n'

  if [ "$needs_action" -eq 0 ]; then
    printf 'READY - no software installation is needed.\n'
    printf 'Found: %s; %s\n' "$python_details" "$browser_details"
    printf 'Node.js/npm: not required.\n\n'
    printf 'Next: return to the main folder and open Start_Viewer.\n'
  else
    printf 'ACTION NEEDED\n\n'

    if [ "$python_ok" -ne 1 ] || [ "$browser_ok" -ne 1 ]; then
      printf 'IT: Install or update:\n'
      if [ "$python_ok" -ne 1 ]; then
        printf -- '- Python 3.10+; make python3 or python available on PATH.\n'
        printf '  Found: %s\n' "$python_details"
      fi
      if [ "$browser_ok" -ne 1 ]; then
        printf -- '- Current Chrome, Edge, Firefox, or Safari with WebGL2.\n'
      fi
      printf 'Node.js/npm: not required.\n'
      printf '\n'
    else
      printf 'No software installation is needed.\n\n'
    fi

    if [ "$package_ok" -ne 1 ]; then
      printf 'VIEWER PACKAGE ISSUE:\n'
      printf -- '- Missing ui/dist/index.html. Replace this with a complete shipment.\n\n'
    fi

    printf 'After resolving the items above, run this checker again.\n'
  fi
} > "$TEMP_FILE"

mv "$TEMP_FILE" "$OUTPUT_FILE"

printf '\n'
cat "$OUTPUT_FILE"
printf '\nReport written to:\n%s\n' "$OUTPUT_FILE"

if [ -t 0 ]; then
  printf '\nPress Return to close...'
  read -r _
fi

exit "$needs_action"
