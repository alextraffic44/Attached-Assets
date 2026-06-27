---
name: ffmpeg in production deploy — EIO on extraction
description: Why ffmpeg frame extraction (SCROLLANIM / video-frames) intermittently failed in the deployed env and the spawn-based pattern that fixes it.
---

# ffmpeg frame extraction in the deployed environment

Symptom seen in production only: the Kling scroll-anim video rendered AND downloaded
fine (e.g. 11.5 MB mp4 written to /tmp), then frame extraction died with
`ffmpeg extraction failed: EIO: i/o error, read` and produced 0 frames — so the site
shipped without the animation even though the (paid) video existed.

**Root cause:** the failure was on OUR side, not Kling. `EIO: i/o error, read` is a
libuv read() error, NOT ffmpeg stderr. Using `fluent-ffmpeg` to run ffmpeg means
fluent-ffmpeg drains the child's stderr pipe; in the deployed (restricted/overlay)
filesystem that pipe read intermittently throws EIO, killing the whole extraction.
(Exec'ing the `ffmpeg-static` binary straight from `node_modules` on a read-only deploy
layer can similarly throw EIO/ETXTBSY.) Dev never reproduces it — only the deploy FS.

**The fix (pattern to keep):** extract frames with a DIRECT `child_process.spawn`,
`stdio: ["ignore","ignore","ignore"]` — no pipes means no pipe-read EIO. Judge success
by `exit code 0 AND >0 frame files` (not by reading stderr). Retry up to 3×; on retry,
copy the ffmpeg-static binary to a writable `os.tmpdir()` path (chmod 0o755) and exec
from THERE to dodge read-only/overlay exec EIO. Re-running extraction is FREE here — the
mp4 is already rendered and billed — so retries never risk a double-charge.

**How to apply:**
- Helper `extractFramesWithFfmpeg(videoPath, framesDir, fps, shouldStop)` is the single
  extraction path; `getFfmpegBinary(forceTmpCopy)` resolves the binary (ffmpeg-static →
  system `which ffmpeg` fallback) and does the tmp-copy escalation.
- Do NOT route frame extraction back through fluent-ffmpeg `.run()` — that reintroduces
  the pipe-read EIO. fluent-ffmpeg is fine ONLY for the `ffprobe` duration probe (whose
  errors are already swallowed → default duration).
- Trade-off accepted: ignoring stderr loses ffmpeg diagnostics (failures collapse to
  `ffmpeg exited N`). Stability > verbose logs here. If you ever need detail, capture only
  the last few KB of stderr behind a flag — never a long-lived drained pipe.
- `ffmpeg-static` IS bundled and resolves in both dev and deploy
  (`node_modules/ffmpeg-static/ffmpeg`); a missing-binary theory is wrong — don't chase it.
