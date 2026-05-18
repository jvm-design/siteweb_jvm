#!/usr/bin/env bash
set -euo pipefail

# Issue a new magickey for the lock manager.
# Usage:  npm run issue-key -- "Label du destinataire"
#         (or directly: ./tools/issue-key.sh "Label du destinataire")
#
# Output: a random 24-char URL-safe key (to give to the recipient)
#         and its SHA-256 hash (to paste into LOCK_MAGICKEY_HASHES in main.js).
#
# The plaintext key is never written to disk — copy it now, store it in a
# private vault (1Password, Apple Notes, etc.). If you lose it, issue another.

LABEL="${1:-$(date +%Y-%m-%d)}"

# 18 random bytes → 24 base64 chars. URL-safe: replace +/ with -_, strip padding.
# ~108 bits of entropy — uniform-random, immune to dictionary/brute-force.
KEY=$(openssl rand -base64 18 | tr '/+' '_-' | tr -d '=')
HASH=$(printf '%s' "$KEY" | shasum -a 256 | awk '{print $1}')

cat <<EOF

  ──────────────────────────────────────────────────────────────
   Recipient label : ${LABEL}
   Plaintext key   : ${KEY}
  ──────────────────────────────────────────────────────────────

   1. Send the plaintext key to the recipient (email, signed message).
   2. Save it in your private vault under "${LABEL}".
   3. Paste this line into LOCK_MAGICKEY_HASHES in site/assets/js/main.js :

      "${HASH}", // ${LABEL}

   To revoke later: delete that hash line.

EOF
