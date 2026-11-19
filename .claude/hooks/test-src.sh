#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): after any change to a file in src/, run the
# unit tests. Passing tests stay silent. Failing tests block, and the failure
# summary goes back to Claude so it fixes them right away.
#
# Input: the hook's JSON payload on stdin. Output on failure:
#   {"decision": "block", "reason": "...", "systemMessage": "..."}
set -u

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')

case "$file" in
  "$root"/src/*) ;;            # absolute path inside src/
  src/*) ;;                    # relative path
  *) exit 0 ;;                 # anything else: not our business
esac

cd "$root" || exit 0
if out=$(node --test tests/*.test.js 2>&1); then
  exit 0
fi

rel="${file#"$root"/}"
failed=$(printf '%s\n' "$out" | sed -n 's/^# fail //p' | tail -1)
# Keep the useful lines: which tests failed and why, plus the totals.
summary=$(printf '%s\n' "$out" \
  | grep -E "^[[:space:]]*not ok |^[[:space:]]*error:|^# (tests|pass|fail) " \
  | head -40)

jq -n --arg rel "$rel" --arg n "${failed:-?}" --arg s "$summary" '{
  decision: "block",
  reason: ("node --test tests/*.test.js FAILED after editing " + $rel + " (" + $n + " failing). Fix it before doing anything else:\n" + $s),
  systemMessage: ("Unit tests: " + $n + " failing after editing " + $rel)
}'
exit 0
