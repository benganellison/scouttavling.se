# Installing and deploying on a server

One VPS runs everything with Docker Compose: Traefik (HTTPS via Let's Encrypt), the app, Postgres, 15-minute database dumps and encrypted offsite copies. A **systemd timer on the server** looks for new releases and deploys them itself, **Monday to Thursday, 08:00–20:00 Swedish time**. Friday to Sunday nothing is deployed automatically.

```
merge the release PR on GitHub ─▶ tag vX.Y.Z ─▶ image ghcr.io/benganellison/scouttavling:X.Y.Z
                                                          │
server, hourly Mon–Thu: scripts/auto-deploy.sh ◀──────────┘  (pull: GitHub never logs in to the server)
   pull image ▸ check it was built from the tag ▸ check out the tag ▸ pin APP_IMAGE to the digest
   ▸ scripts/deploy.sh: backup ▸ migrations ▸ replace the app ▸ on failure: put the previous release back
```

The address is set in one place, `DOMAIN` in `.env.prod`. The same image works on any domain, so what you test on `scouttavling.thengt.se` is exactly what later runs on `scouttavling.se`.

## 1. The server

- A VPS in the EU running Ubuntu 24.04. 2 vCPU and 4 GB is plenty: the load test (02 §15) ran a big competition day on less.
- Docker Engine with the Compose plugin, from Docker's own apt repository (docs.docker.com/engine/install/ubuntu).
- Firewall: allow 22 (SSH, key only), 80 and 443. Nothing else: Postgres and the app are never published.
- DNS: an A record (and AAAA if the server has IPv6) for **both** `scouttavling.thengt.se` and `www.scouttavling.thengt.se`, pointing at the server. Traefik needs them before it can get certificates.

## 2. The deploy user and the checkout

```sh
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy           # the docker group is root-equivalent: keep SSH key-only
sudo -iu deploy
git clone https://github.com/benganellison/scouttavling.se.git app
cd app
```

## 3. `.env.prod`

```sh
cp .env.example .env.prod && chmod 600 .env.prod
openssl rand -base64 36 | tr -d '/+='    # use for POSTGRES_PASSWORD (deploy.sh refuses short ones)
openssl rand -base64 36 | tr -d '/+='    # use for RESTIC_PASSWORD; keep a copy OUTSIDE the server
printf 'GRANT_SIGNING_KEY="%s"\n' "$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 | sed -z 's/\n$//; s/\n/\\n/g')" >> .env.prod
$EDITOR .env.prod
```

| Setting | Value |
|---|---|
| `DOMAIN` | `scouttavling.thengt.se` (no `https://`) |
| `ACME_EMAIL` | your email, for Let's Encrypt expiry notices |
| `POSTGRES_PASSWORD` | the first random string |
| `GRANT_SIGNING_KEY` | appended by the command above; delete the empty line from the example. **Keep a copy**: changing it later disconnects every phone. |
| `SCOUTID_ISSUER`, `SCOUTID_CLIENT_ID`, `SCOUTID_CLIENT_SECRET` | the ScoutID client for this domain. Its redirect URI is `https://scouttavling.thengt.se/auth/callback`. |
| `OPERATOR_NAME`, `OPERATOR_EMAIL` | who runs the installation (shown on `/personuppgifter`). Required. |
| `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `RESTIC_AWS_ACCESS_KEY_ID`, `RESTIC_AWS_SECRET_ACCESS_KEY` | an S3-compatible bucket in the EU at another provider or location. Required. |
| `APP_IMAGE` | leave empty; the deployer fills it in |
| `ORIGIN`, `DEV_LOGIN` | ignored in production (`ORIGIN` follows `DOMAIN`; the developer login is forced off) |

Keep `.env.prod` (with the grant key and both passwords) in your password manager too.

## 4. First deploy

```sh
scripts/auto-deploy.sh --now
```

It deploys the newest release: it pulls the image, checks out its tag, fills in `APP_IMAGE`, then backs up, migrates and starts everything. Check `https://scouttavling.thengt.se/healthz` (it answers `ok`), then log in once with ScoutID and make yourself site admin:

```sh
docker compose --env-file .env.prod -f compose.yaml -f compose.prod.yaml exec -e SITE_ADMIN_OPERATOR="$USER" \
  app npm run site-admin:grant -- <your member number> --reason "Driftansvarig"
```

## 5. Automatic deploys

As a user with sudo (not `deploy`):

```sh
sudo cp /home/deploy/app/deploy/systemd/scouttavling-deploy.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now scouttavling-deploy.timer
systemctl list-timers scouttavling-deploy.timer        # shows the next run
```

The units are copied, not linked, because the deployer checks out a different tag on every release. If a release changes them, the release notes say so; copy them again.

Optional: to get a push message for every deploy and every failure, uncomment `DEPLOY_NOTIFY_URL` in the service with an [ntfy.sh](https://ntfy.sh) topic only you know (`sudo systemctl edit scouttavling-deploy`). Without it, results are only in the journal. The uptime monitor (04 §7.8) still catches a site that is down.

## 6. Day to day

- **Releasing:** merge the release PR on GitHub. About five minutes later the image is published. On Monday to Thursday the server deploys it within the hour. A release merged Friday to Sunday is deployed on Monday from 08:00.
- **What happened:** `journalctl -u scouttavling-deploy -n 50`.
- **Deploy now, any day:** `scripts/auto-deploy.sh --now` (as `deploy`, in `~/app`).
- **Roll back:** `scripts/auto-deploy.sh --version 0.1.0`. This works because migrations are backward compatible (MIGRATIONS.md §6). The timer then sees a newer release and would bring it back on the next weekday, so first stop it with `sudo systemctl stop scouttavling-deploy.timer` until the fix is released, then start it again.
- **A failed deploy** puts the previous release back automatically, keeps it running, and skips the failed version on later runs. A newer release is tried as normal. Once you have checked what went wrong, `--version X.Y.Z` deploys the skipped version by hand.
- **See what would happen:** `scripts/auto-deploy.sh --dry-run`.

Guards: the deployer refuses if the checkout has local edits (`git status`), if the image was not built from the release tag, or if `deploy.sh`'s production checks fail (short password, missing operator, developer login on). Only one deploy runs at a time.

## 7. Moving from the test domain to scouttavling.se

1. DNS for `scouttavling.se` and `www.scouttavling.se` to the server. Register `https://scouttavling.se/auth/callback` with ScoutID.
2. In `.env.prod`, set `DOMAIN=scouttavling.se` (and the ScoutID client values, if it is a new client).
3. `scripts/deploy.sh`. This is the same image with a new address; Traefik gets the new certificates.

Invites, QR codes and links printed while testing point at the test domain, and stop working once DNS for it is removed.

## 8. Why pull, not push

GitHub Actions has no SSH key and no access to the server. The server only reads public things: the release tags and the image. The image is accepted only if its build label says it was built from that tag's commit. The weekday rule is checked by the timer **and** again by the script, so changing the timer cannot bring back weekend deploys. The trade-off is that there is no deploy log or approve button in GitHub; the journal and the optional push message replace them.
