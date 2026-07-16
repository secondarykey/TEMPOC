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
# GITHUB_TOKEN is a GitHub App installation token. Since the April 2026 rollout
# these are ~520 chars (ghs_APPID_JWT) rather than 40, so the two credentials
# below also happen to differ in format -- worth noting if only the 40-char one
# fails.
[ -n "${ACTIONS_TOKEN:-}" ] && echo "GITHUB_TOKEN length: ${#ACTIONS_TOKEN}"
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
    # head first, then strip newlines: piping tr into head makes head close the
    # pipe early and tr report a broken pipe into the log.
    printf '      body: %s\n' "$(head -c 160 "$body" | tr -d '\n')"
  fi
}

echo "Probes against $API:"
probe "anon    /repos" "$API/repos/$REPO"
probe "bearer  /repos" -H "Authorization: Bearer $GH_TOKEN" "$API/repos/$REPO"
probe "token   /repos" -H "Authorization: token $GH_TOKEN"  "$API/repos/$REPO"
probe "bearer  /user"  -H "Authorization: Bearer $GH_TOKEN" "$API/user"

# The decisive comparison: GITHUB_TOKEN is a second, unrelated credential that
# every workflow gets for free, so it separates "authenticated requests from
# this runner fail" from "this PAT fails". Anonymous vs PAT cannot separate
# those two, because authenticated traffic may be served by different backends
# than anonymous traffic -- and a partial failure there need not show up on
# githubstatus.com.
if [ -n "${ACTIONS_TOKEN:-}" ]; then
  probe "actions /repos" -H "Authorization: Bearer $ACTIONS_TOKEN" "$API/repos/$REPO"
fi
echo

# git-over-HTTPS to github.com is a different service from api.github.com, so
# the tag could be pushed that way instead (as this workflow did before it moved
# to the REST API). This asks git's *write* endpoint whether it would accept the
# PAT, without pushing anything. It must be receive-pack: the read endpoint
# answers 200 to anyone on a public repo -- the same trap as checkout appearing
# to succeed with a bad token. Verified: anonymous and invalid tokens both 401
# here, so a 200 really does mean push-capable.
git_code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -u "x-access-token:${GH_TOKEN}" \
  "https://github.com/${REPO}.git/info/refs?service=git-receive-pack" || echo "000")
printf '  %-22s HTTP %s   %s\n' "git receive-pack" "$git_code" \
  "$([ "$git_code" = 200 ] && echo '(push would be accepted)' || echo '(push would be rejected)')"
[ "$git_code" = "200" ] && git_ok=yes || git_ok=no
echo

anon=${code["anon    /repos"]}
bearer=${code["bearer  /repos"]}
tok=${code["token   /repos"]}
actions=${code["actions /repos"]:-skipped}

if [ "$bearer" = "200" ] || [ "$tok" = "200" ]; then
  echo "PAT accepted."
  exit 0
fi

echo "::error::GH_PAT cannot drive the API (anon=$anon bearer=$bearer token=$tok actions=$actions git=$git_code)."
case "$bearer" in
  401)
    echo "::error::401 means the secret's value is wrong or stale. Regenerating a PAT mints a new value; extending an expiry does not. The secret must hold the current value."
    ;;
  403)
    echo "::error::403 means the token is valid but lacks the scope. A classic PAT needs 'repo'."
    ;;
  5*)
    # A 5xx is GitHub failing, not GitHub rejecting. Which credential still
    # works tells us how far the failure reaches.
    if [ "$anon" != "200" ]; then
      echo "::error::Even the anonymous probe failed, so api.github.com is unreachable or down from this runner rather than this being about credentials. Retry later."
    elif [ "$actions" = "200" ]; then
      echo "::error::GITHUB_TOKEN works from this same runner while GH_PAT 5xx's, so the authenticated path is healthy and the failure follows this specific credential. Regenerate the PAT; if a fresh one behaves the same, it is a GitHub-side problem with this account's tokens -- report it with the x-github-request-id values above."
    elif [ "${actions#5}" != "$actions" ]; then
      echo "::error::Both GH_PAT and GITHUB_TOKEN 5xx while the anonymous probe returns 200. Two unrelated credentials failing rules out the token: authenticated requests from this runner are being served something broken. This is GitHub-side and worth reporting with the x-github-request-id values above, even if githubstatus.com is green -- a partial failure need not appear there."
    else
      echo "::error::GH_PAT 5xx'd while anonymous requests succeed. Re-run to compare against GITHUB_TOKEN, which separates a bad credential from a broken authenticated path."
    fi
    if [ "$git_ok" = yes ]; then
      echo "::notice::The same PAT is accepted by git's write endpoint, so github.com is fine and only api.github.com is affected."
    fi
    ;;
esac
exit 1
