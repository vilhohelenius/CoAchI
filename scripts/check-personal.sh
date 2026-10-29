#!/usr/bin/env bash
# Fails if any line of the untracked .personal-strings file appears in the given files
# (default: staged files). Never prints the matched string, only file names.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[ -f .personal-strings ] || { echo "check-personal: .personal-strings missing, create it (one string per line)" >&2; exit 1; }
if [ "$#" -gt 0 ]; then files=("$@"); else files=(); while IFS= read -r f; do files+=("$f"); done < <(git diff --cached --name-only --diff-filter=ACM); fi
[ "${#files[@]}" -gt 0 ] || exit 0
bad=$(grep -rIlF -f <(grep -v '^[[:space:]]*$' .personal-strings) -- "${files[@]}" 2>/dev/null || true)
if [ -n "$bad" ]; then echo "check-personal: personal strings found in:" >&2; echo "$bad" >&2; exit 1; fi
