#!/bin/sh
# Refuses a commit that contains anything shaped like a Stripe or OpenAI secret key.
# Install once: git config core.hooksPath scripts/hooks
if git diff --cached -U0 | grep -E '^\+' | grep -Eq '(sk|rk)_(test|live)_[0-9A-Za-z]{10,}|sk-(proj-)?[A-Za-z0-9_-]{20,}|whsec_[0-9A-Za-z]{10,}'; then
  echo "BLOCKED: this commit contains what looks like a secret key. Keys belong in .env / Render only." >&2
  exit 1
fi
