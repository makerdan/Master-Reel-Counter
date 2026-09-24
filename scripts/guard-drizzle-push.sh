#!/bin/bash

push_log=$(mktemp) || exit 1
trap 'rm -f "$push_log"' EXIT

# Post-merge setup cannot safely answer create/rename or data-loss questions.
# Drizzle can exit 0 after receiving EOF at a prompt, so the exit code alone
# does not prove that the schema push completed.
npm run db:push </dev/null 2>&1 | tee "$push_log"
statuses=("${PIPESTATUS[@]}")
if (( statuses[1] != 0 )); then
  echo "Post-merge schema push output could not be checked; setup cannot confirm success." >&2
  exit 1
fi

if grep -Fq '❯' "$push_log" ||
   grep -Eq 'Is .+ column in .+ table created or renamed from another column\?|Do you (want to truncate|still want to push changes)\?' "$push_log"; then
  echo "Post-merge schema push requires schema review and an explicit choice; Drizzle displayed an interactive prompt. No choice was submitted. Resolve the prompt against the development database before setup can complete." >&2
  exit 1
fi

exit "${statuses[0]}"