#!/usr/bin/env bash
# Preflight for the versionup workflows: proves GH_PAT can drive the GitHub API
# before the job does any real work, and leaves enough evidence in the log to
# diagnose it when it cannot.
#
# Shared by versionup-extension.yml and versionup-desktop.yml. It is CI tooling,
# not module code -- the two modules still share nothing.
#
# Usage: GH_TOKEN=<pat> verify-pat.sh <owner/repo> <release-workflow-name>
set -uo pipefail

REPO="$1"
RELEASE_WF="$2"
API="https://api.github.com"

if [ -z "${GH_TOKEN:-}" ]; then
  echo "::error::secrets.GH_PAT is empty or unset. Add it under Settings > Secrets and variables > Actions. GITHUB_TOKEN cannot be used: tags it pushes do not trigger ${RELEASE_WF}."
  exit 1
fi

# Length only, never the value. ghp_-style classic PAT = 40, fine-grained ~93.
# Anything else -- notably 41 -- means whitespace or a newline came along when
# the secret was pasted.
echo "GH_PAT length: ${#GH_TOKEN}"
gh --version | head -1
echo

# Same request three ways. The comparison is the point: a failure that also hits
# the anonymous probe is the network or GitHub, while one that spares it is tied
# to this token. gh sends `Authorization: token` for classic PATs and `Bearer`
# for fine-grained ones, so both schemes are probed rather than assumed.
declare -A code
probe() {
  local label="$1" ; shift
  local body hdr rid c
  body=$(mktemp) ; hdr=$(mktemp)
  c=$(curl -sS -o "$body" -D "$hdr" -w '%{http_code}' \
        -H "Accept: application/vnd.github+json" "$@" || echo "000")
  rid=$(grep -i '^x-github-request-id:' "$hdr" | tr -d '\r\n' || true)
  code[$label]=$c
  printf '  %-22s HTTP %s   %s\n' "$label" "$c" "$rid"
  if [ "$c" != "200" ]; then
    printf '      body: %s\n' "$(tr -d '\n' < "$body" | head -c 160)"
  fi
}

echo "Probes against $API:"
probe "anon   /repos"  "$API/repos/$REPO"
probe "bearer /repos"  -H "Authorization: Bearer $GH_TOKEN" "$API/repos/$REPO"
probe "token  /repos"  -H "Authorization: token $GH_TOKEN"  "$API/repos/$REPO"
probe "bearer /user"   -H "Authorization: Bearer $GH_TOKEN" "$API/user"
echo

# git-over-HTTPS to github.com is a different service from api.github.com, and
# the tag could be pushed that way instead (which is what this workflow did
# before it moved to the API). Worth knowing whether that door is open when the
# API one is not. Output is suppressed so the URL-embedded token cannot leak.
if git ls-remote "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" HEAD >/dev/null 2>&1; then
  git_ok=yes
else
  git_ok=no
fi
printf '  %-22s %s\n' "git ls-remote" "$([ "$git_ok" = yes ] && echo 'OK -- git accepts the PAT' || echo 'FAILED')"
echo

anon=${code["anon   /repos"]}
bearer=${code["bearer /repos"]}
tok=${code["token  /repos"]}

if [ "$bearer" = "200" ] || [ "$tok" = "200" ]; then
  echo "PAT accepted."
  exit 0
fi

echo "::error::GH_PAT cannot drive the API (bearer=$bearer token=$tok anon=$anon)."
case "$anon:$bearer" in
  200:5*)
    echo "::error::The anonymous probe succeeded from this same runner, so the network and GitHub are fine and the 5xx is tied to this token. A 503 is not an auth rejection -- GitHub is erroring while handling this credential. Regenerate the PAT and update the secret; if it persists, quote the x-github-request-id above to GitHub Support."
    if [ "$git_ok" = yes ]; then
      echo "::notice::git accepts the same PAT, so only api.github.com is affected. If regenerating does not help, the tag can be pushed over git instead of the REST API."
    fi
    ;;
  5*:5*)
    echo "::error::Every probe 5xx'd, including the anonymous one, so this is GitHub or the runner's network rather than the token. Check githubstatus.com and retry."
    ;;
  *:401)
    echo "::error::401 means the secret's value is wrong or stale. Regenerating a PAT mints a new value; extending an expiry does not. The secret must hold the current value."
    ;;
  *:403)
    echo "::error::403 means the token is valid but lacks the scope. A classic PAT needs 'repo'."
    ;;
esac
exit 1
