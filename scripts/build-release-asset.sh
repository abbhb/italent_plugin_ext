#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 <version> <browser> <os> <output-dir>" >&2
  exit 1
fi

VERSION="$1"
BROWSER="$2"
OS_NAME="$3"
OUTPUT_DIR="$4"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
STAGE_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${STAGE_DIR}"
}
trap cleanup EXIT

case "${BROWSER}" in
  chrome|edge)
    ;;
  *)
    echo "Unsupported browser: ${BROWSER}" >&2
    exit 1
    ;;
esac

case "${OS_NAME}" in
  linux|macos|windows)
    ;;
  *)
    echo "Unsupported os: ${OS_NAME}" >&2
    exit 1
    ;;
esac

mkdir -p "${OUTPUT_DIR}"

cp "${REPO_DIR}/manifest.json" "${STAGE_DIR}/manifest.json"
cp -R "${REPO_DIR}/content_scripts" "${STAGE_DIR}/content_scripts"
cp -R "${REPO_DIR}/popup" "${STAGE_DIR}/popup"
cp -R "${REPO_DIR}/icons" "${STAGE_DIR}/icons"

ASSET_NAME="italent_plugin_ext-${VERSION}-${BROWSER}-${OS_NAME}.zip"
ASSET_PATH="$(cd "${OUTPUT_DIR}" && pwd)/${ASSET_NAME}"

python - "${STAGE_DIR}" "${ASSET_PATH}" <<'PY'
import pathlib
import sys
import zipfile

source_dir = pathlib.Path(sys.argv[1])
asset_path = pathlib.Path(sys.argv[2])

with zipfile.ZipFile(asset_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for item in sorted(source_dir.rglob("*")):
        if item.is_file():
            archive.write(item, item.relative_to(source_dir))
PY

echo "${ASSET_PATH}"
