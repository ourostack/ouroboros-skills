#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(pwd)}"

run_with_timeout() {
  local seconds="$1"
  shift

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$seconds" "$@" <<'PY'
import subprocess
import sys

timeout = float(sys.argv[1])
cmd = sys.argv[2:]

try:
    result = subprocess.run(cmd, timeout=timeout, text=True, capture_output=True)
except subprocess.TimeoutExpired:
    print(f"timeout after {timeout:g}s: {' '.join(cmd)}")
    sys.exit(124)

sys.stdout.write(result.stdout)
sys.stderr.write(result.stderr)
sys.exit(result.returncode)
PY
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$seconds" "$@"
  elif command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  else
    echo "timeout unavailable because python3/timeout are missing: $*" >&2
    return 124
  fi
}

echo "== Apple native preflight =="
echo "repo: $ROOT"

if command -v xcodebuild >/dev/null 2>&1; then
  xcodebuild -version
else
  echo "missing: xcodebuild"
fi

if command -v swift >/dev/null 2>&1; then
  swift --version | head -n 1
else
  echo "missing: swift"
fi

if command -v xcrun >/dev/null 2>&1; then
  echo "available runtimes:"
  if runtimes="$(run_with_timeout 10 xcrun simctl list runtimes 2>&1)"; then
    echo "$runtimes" | sed -n '1,24p'
  else
    echo "$runtimes" | sed -n '1,24p'
    echo "warning: unable to list simulator runtimes within timeout"
  fi
else
  echo "missing: xcrun"
fi

echo
echo "project files:"
find "$ROOT" -maxdepth 3 \( -name '*.xcodeproj' -o -name '*.xcworkspace' -o -name Package.swift \) -print | sort

echo
echo "workflow protected-check candidates:"
if [ -d "$ROOT/.github/workflows" ]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$ROOT/.github/workflows" <<'PY'
from pathlib import Path
import re
import sys

workflow_dir = Path(sys.argv[1])

for path in sorted(workflow_dir.glob("*.y*ml")):
    in_jobs = False
    current_job = None
    emitted_current = False

    for line in path.read_text().splitlines():
        if re.match(r"^jobs:\s*$", line):
            in_jobs = True
            continue

        if in_jobs and line and not line.startswith((" ", "#")):
            if current_job and not emitted_current:
                print(f"{path}:{current_job} -> {current_job}")
            in_jobs = False
            current_job = None
            emitted_current = False

        if not in_jobs:
            continue

        job_match = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if job_match:
            if current_job and not emitted_current:
                print(f"{path}:{current_job} -> {current_job}")
            current_job = job_match.group(1)
            emitted_current = False
            continue

        name_match = re.match(r"^    name:\s*[\"']?(.+?)[\"']?\s*$", line)
        if current_job and name_match:
            print(f"{path}:{current_job} -> {name_match.group(1)}")
            emitted_current = True

    if current_job and not emitted_current:
        print(f"{path}:{current_job} -> {current_job}")
PY
  else
    echo "python3 unavailable; cannot parse workflow job names safely"
  fi
else
  echo "missing: .github/workflows"
fi

echo
echo "git state:"
git -C "$ROOT" status --short --branch || true
