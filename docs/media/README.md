# Media for the README

| File | What | Where it lives |
|---|---|---|
| `poang-pa-kontroll.gif` | Score entry on a phone (~5 s loop, 300 px wide) | Committed here |
| `01-funktionar-offline.mp4` … `04-prisutdelning.mp4` | Highlight clips (10–18 s, < 600 KB) | **Not in git.** Uploaded as GitHub user-attachments (2026-10-19) and linked from the root README |

All data shown is invented (seed data and UAT fixtures).

## Re-creating the media after UI changes

1. Run the UAT to get fresh raw recordings in `apps/web/e2e/uat/videos/` (see the header of `apps/web/e2e/uat.e2e.ts`).
2. Cut the highlights with ffmpeg in Docker. Run from `apps/web/e2e/uat/videos/`; output goes to `highlights/`, which is gitignored:

```sh
FF="docker run --rm -v $PWD:/v -w /v linuxserver/ffmpeg:9.0.2 -v error -y"
ENC="-c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart -an"
mkdir -p highlights
# 1. volunteer offline: skip the first 2 s, play at 1.5×
$FF -ss 2 -i 02-volunteer-offline.webm -vf "setpts=PTS/1.5,fps=30" $ENC highlights/01-funktionar-offline.mp4
# 2. HQ + phone side by side. The phone recording starts ~5.5 s after HQ's; these offsets line them up
$FF -ss 5 -i 05-hq-live.webm -ss 0.6 -i 05-hq-live-volunteer.webm -filter_complex \
  "[0:v]scale=-2:844,setsar=1[hq];[1:v]setsar=1[ph];[hq][ph]hstack=inputs=2:shortest=1,setpts=PTS/1.25,fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2[out]" \
  -map "[out]" $ENC highlights/02-ledningscentral-live.mp4
# 3. Mål, as recorded
$FF -i 03-mal-station.webm -vf fps=30 $ENC highlights/03-mal-alla-delar.mp4
# 4. ceremony: the reveal part only
$FF -ss 5.5 -t 10.5 -i 06-results-ceremony.webm -vf "scale=1280:-2,fps=30" $ENC highlights/04-prisutdelning.mp4
```

3. The GIF (run from the repo root):

```sh
docker run --rm -v $PWD:/r -w /r linuxserver/ffmpeg:9.0.2 -v error -y -ss 14.4 -t 4.0 \
  -i apps/web/e2e/uat/videos/02-volunteer-offline.webm -filter_complex \
  "fps=12,scale=300:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=1.2,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  -loop 0 docs/media/poang-pa-kontroll.gif
```

The timestamps (`-ss`, `-t`) fit the current UAT pacing. If the UAT steps change, check the new timing by making a contact sheet (`-vf "fps=1,scale=150:-1,tile=10x3" -frames:v 1 sheet.png`), then adjust.

4. Upload the new MP4s and swap the URLs in the root README. Keep the GIF under ~1 MB.

   **From the command line** (uses your `gh` login; you need push access to the repo). This goes through GitHub's undocumented `user-attachments` endpoint, the same one the web editor uses, so it may change without notice:

   ```sh
   REPO_ID=$(gh api repos/benganellison/scouttavling.se --jq .id)
   for f in apps/web/e2e/uat/videos/highlights/*.mp4; do
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
