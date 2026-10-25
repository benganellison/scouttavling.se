# Media for the README

| File | What | Where it lives |
|---|---|---|
| `poang-pa-kontroll.gif` | Score entry on a phone (~5 s loop, 300 px wide) | Committed here |
| `01-funktionar-offline.mp4` … `04-prisutdelning.mp4` | Captioned demo clips (27–82 s, ≤ 497 KB each) | **Not in git.** Uploaded as GitHub user-attachments (2026-10-25, Scouterna profile) and linked from the root README |

All data shown is invented (seed data and UAT fixtures).

## Re-creating the media after UI changes

The README clips come from a dedicated **demo** spec, not the UAT. It runs at human pace, shows an orange ring for every tap, and logs a Swedish caption for each step. Captions are burned into a band **below** the screen, so they never cover the UI.

1. Record (from `apps/web`):

   ```sh
   npm run db:reset && ORIGIN=http://localhost:5210 npx vite build
   PORT=5210 ORIGIN=http://localhost:5210 DEV_LOGIN=1 GRANT_SIGNING_KEY="$(cat .dev-grant-key.pem)" \
     node --env-file=.env build/index.js > .uat-server.log 2>&1 & echo $! > .uat-server.pid
   npx playwright test -c e2e/demo.config.ts        # ~4 min; raw videos + captions.json in e2e/demo-results/
   kill $(cat .uat-server.pid)
   ```

2. Cut: `node scripts/demo-cut.ts` (needs Docker, uses `linuxserver/ffmpeg:9.0.2`). It writes `e2e/demo-results/final/*.mp4`:
   - 15 fps H.264 with the captions in a band below the screen;
   - clip 2 puts HQ and the phone side by side, each with its own captions;
   - **size guard:** each clip is re-encoded with stronger compression until it is no larger than its byte budget in `scripts/demo-cut.ts` (the sizes of the clips currently in the README), so the videos never grow. Raise a budget deliberately if a clip really needs it.

   To change what is shown or said, edit the `say(…)` captions and steps in `e2e/demo.e2e.ts`. Each caption stays up for ≈ 1.2 s + 55 ms per character.

3. The GIF (still cut from the UAT recording, run from the repo root). The UAT leaves its videos in `apps/web/e2e/uat-results/<test>/page@<hash>.webm`; copy the fresh ones first, or you will cut an old recording:
```sh
cd apps/web && for d in e2e/uat-results/*/; do f=$(ls -t "$d"*.webm 2>/dev/null | head -1); [ -n "$f" ] && cp "$f" "e2e/uat/videos/$(basename $d).webm"; done; cd ../..
```
Then:

```sh
docker run --rm -v $PWD:/r -w /r linuxserver/ffmpeg:9.0.2 -v error -y -ss 13.6 -t 4.8 \
  -i apps/web/e2e/uat/videos/02-volunteer-offline.webm -filter_complex \
  "fps=12,scale=300:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=1.2,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  -loop 0 docs/media/poang-pa-kontroll.gif
```

The timestamps (`-ss`, `-t`) fit the current UAT pacing. If the UAT steps change, check the new timing by making a contact sheet (`-vf "fps=1,scale=150:-1,tile=10x3" -frames:v 1 sheet.png`), then adjust.

4. Upload the new MP4s and swap the URLs in the root README. Keep the GIF under ~1 MB.

   **From the command line** (uses your `gh` login; you need push access to the repo). This goes through GitHub's undocumented `user-attachments` endpoint, the same one the web editor uses, so it may change without notice:

   ```sh
   REPO_ID=$(gh api repos/benganellison/scouttavling.se --jq .id)
   for f in apps/web/e2e/demo-results/final/*.mp4; do
     name=$(basename "$f")
     # token passed on stdin so it never shows up in the process list
     printf 'header = "Authorization: Bearer %s"\n' "$(gh auth token)" | curl -sS --config - -X POST \
       "https://uploads.github.com/user-attachments/assets?name=$name&content_type=video%2Fmp4&repository_id=$REPO_ID" \
       -H "Accept: application/json" -H "Content-Type: video/mp4" --data-binary @"$f"
     echo
   done
   ```

   Each call answers `201` with `{"url":"https://github.com/user-attachments/assets/<id>", …}`. Put each URL alone on its own line in the README; GitHub renders it as an inline player.

   **Or by hand:** edit the README on github.com and drag the files into the editor. GitHub inserts the same kind of URL. Limit: 10 MB per file.
