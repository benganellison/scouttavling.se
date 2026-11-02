#!/usr/bin/env bash
# Pull-based deploy, run on the server by a systemd timer (deploy/systemd/). Nothing outside the server
# can trigger it: it looks for a newer release tag on GitHub and, Monday to Thursday only, deploys it with
# scripts/deploy.sh (backup → migrate → replace the app). Friday to Sunday it never deploys on its own.
#
#   scripts/auto-deploy.sh                    # what the timer runs: newest release, Mon–Thu only
#   scripts/auto-deploy.sh --now              # by hand: newest release, any day
#   scripts/auto-deploy.sh --version 0.1.0    # by hand: exactly this release, any day (also to roll back)
#   scripts/auto-deploy.sh --dry-run          # only say what would happen
#
# Per release it: pulls the image, checks that the image was built from the release tag (OCI revision
# label = tag commit), checks out that tag (so compose files and migrations match the image), pins
# APP_IMAGE in .env.prod to the image digest and runs scripts/deploy.sh. If that fails it puts the
# previous checkout and APP_IMAGE back, redeploys them, and skips the failed version until a newer one.
#
# Settings (environment, e.g. in the systemd unit): ENV_FILE (.env.prod), DEPLOY_DAYS (ISO weekdays,
# "1 2 3 4" = Mon–Thu), DEPLOY_TZ (Europe/Stockholm), DEPLOY_NOTIFY_URL (optional: each deploy result
# is POSTed there as plain text, e.g. an ntfy.sh topic). Guide: docs/dev/DEPLOY.md.
set -euo pipefail

IMAGE=ghcr.io/benganellison/scouttavling
ENV_FILE="${ENV_FILE:-.env.prod}"
DEPLOY_DAYS="${DEPLOY_DAYS:-1 2 3 4}"
DEPLOY_TZ="${DEPLOY_TZ:-Europe/Stockholm}"
STATE=.deploy-state
SEMVER='^[0-9]+\.[0-9]+\.[0-9]+$'

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
notify() { [ -z "${DEPLOY_NOTIFY_URL:-}" ] || curl -fsS -m 10 -d "$1" "$DEPLOY_NOTIFY_URL" >/dev/null || true; }
die() { log "✗ $*"; notify "scouttavling: $*"; exit 1; }
# Values are read, never sourced (same as deploy.sh).
envval() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -E 's/^["'"'"']|["'"'"']$//g'; }
set_env() {
	local tmp
	tmp="$(mktemp "$ENV_FILE.XXXXXX")"
	awk -v k="$1" -v v="$2" '$0 ~ "^"k"=" { if (!done) print k"="v; done = 1; next } { print } END { if (!done) print k"="v }' "$ENV_FILE" > "$tmp"
	chmod 600 "$tmp"
	mv "$tmp" "$ENV_FILE"
}
newer() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]; }

# Everything runs inside main, which bash has read in full before it starts: the checkout below
# replaces this very file, and bash would otherwise go on reading the new version mid-run.
main() {
	local now=0 dry=0 want=""
	while [ $# -gt 0 ]; do
		case "$1" in
			--now) now=1 ;;
			--dry-run) dry=1 ;;
			--version) want="${2:-}"; now=1; shift ;;
			*) echo "unknown option: $1" >&2; exit 2 ;;
		esac
		shift
	done
	[ -z "$want" ] || [[ "$want" =~ $SEMVER ]] || die "--version wants X.Y.Z, got '$want'"

	cd "$(dirname "$0")/.."
	mkdir -p "$STATE"
	exec 9>"$STATE/lock"
	flock -n 9 || { log "another deploy is running"; exit 0; }
	[ -f "$ENV_FILE" ] || die "missing $ENV_FILE (docs/dev/DEPLOY.md)"

	local day
	day="$(TZ="$DEPLOY_TZ" date +%u)"
	if [ "$now" = 0 ] && [[ " $DEPLOY_DAYS " != *" $day "* ]]; then
		log "no automatic deploy today (weekday $day, allowed: $DEPLOY_DAYS)"
		exit 0
	fi

	local current_image current target
	current_image="$(envval APP_IMAGE)"
	current="$(sed -nE 's/^[^@]*:([0-9]+\.[0-9]+\.[0-9]+)(@.*)?$/\1/p' <<< "$current_image")"
	if [ -n "$want" ]; then
		target="$want"
	else
		target="$(git ls-remote --tags --refs origin 'v*' | sed -nE 's#.*refs/tags/v([0-9]+\.[0-9]+\.[0-9]+)$#\1#p' | sort -V | tail -1)"
		[ -n "$target" ] || die "found no release tags vX.Y.Z on origin"
		if [ -n "$current" ] && ! newer "$target" "$current"; then
			log "up to date ($current)"
			exit 0
		fi
		if grep -qx "$target" "$STATE/failed" 2>/dev/null; then
			log "skipping $target: it failed before (deploy it by hand with --version $target once fixed)"
			exit 0
		fi
	fi
	log "deploying $target (running: ${current:-nothing})"
	[ "$dry" = 0 ] || { log "dry run: stopping here"; exit 0; }

	[ -z "$(git status --porcelain --untracked-files=no)" ] || die "the server checkout has local changes (git status); not deploying"

	# The image is published a few minutes after its tag: not there yet means try again next run.
	if ! docker pull --quiet "$IMAGE:$target" >/dev/null; then
		[ -z "$want" ] || die "could not pull $IMAGE:$target"
		log "image $IMAGE:$target is not published yet; trying again later"
		exit 0
	fi
	local digest revision tag_commit
	digest="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$IMAGE:$target" | grep -m1 "^$IMAGE@")" ||
		die "no registry digest for $IMAGE:$target"
	revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE:$target")"
	git fetch --quiet --force --tags origin
	tag_commit="$(git rev-parse --verify --quiet "v$target^{commit}")" || die "no tag v$target on origin"
	if [ "$revision" != "$tag_commit" ]; then
		echo "$target" >> "$STATE/failed"
		die "$IMAGE:$target was built from ${revision:-unknown}, not from tag v$target ($tag_commit); not deploying"
	fi

	local prev_ref new_image="$IMAGE:$target@${digest#*@}"
	prev_ref="$(git rev-parse HEAD)"
	git checkout --quiet --detach "v$target"
	set_env APP_IMAGE "$new_image"

	if scripts/deploy.sh; then
		sed -i "/^${target//./\\.}\$/d" "$STATE/failed" 2>/dev/null || true
		log "✓ deployed $target ($new_image)"
		notify "scouttavling: deployed $target"
		exit 0
	fi

	echo "$target" >> "$STATE/failed"
	git checkout --quiet --detach "$prev_ref"
	set_env APP_IMAGE "$current_image"
	if [ -n "$current_image" ]; then
		log "deploy of $target failed; redeploying the previous release ${current:-$current_image}"
		scripts/deploy.sh || die "deploy of $target failed AND redeploying ${current:-$current_image} failed: check now"
	fi
	die "deploy of $target failed; ${current:-the previous release} is running. Logs: journalctl -u scouttavling-deploy"
}

main "$@"; exit
