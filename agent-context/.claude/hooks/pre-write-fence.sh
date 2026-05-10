#!/usr/bin/env bash
# Pre-Write fence: reject Write tool calls whose target path doesn't match
# the harness-supplied EXPECTED_TEST_FILE. The harness sets that env var
# before spawning claude; absence of the var means we're not running under
# the harness, so allow the write through.
#
# Hook contract (PreToolUse):
#   stdin:  JSON with tool_input.file_path
#   exit 0: allow
#   exit 2: reject; stderr is shown to Claude as a corrective message

set -euo pipefail

INPUT="$(cat)"

# Extract file_path from the JSON. We avoid jq to keep the hook portable
# (hooks fire in many environments and jq isn't always present).
FILE_PATH=$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)

EXPECTED="${EXPECTED_TEST_FILE:-}"

if [ -z "$EXPECTED" ]; then
  # Not running under the harness — let the write through. The harness's
  # post-hoc file-existence check is the only enforcement in that case.
  exit 0
fi

if [ -z "$FILE_PATH" ]; then
  echo "pre-write-fence: could not extract file_path from tool input; rejecting" >&2
  exit 2
fi

# Allow if the absolute or relative file_path ends with the expected
# repo-relative path. The harness sets EXPECTED_TEST_FILE to something like
# packages/app/src/SignInPage.beh.renders.test.tsx — comparing as a suffix
# means we accept both absolute and relative paths.
case "$FILE_PATH" in
  *"$EXPECTED")
    exit 0
    ;;
esac

cat <<EOF >&2
Refusing Write to $FILE_PATH.

The medplum-coverage-harness expects exactly one test file at:
  $EXPECTED

Write to that path instead. Do not modify any other file.
EOF
exit 2
