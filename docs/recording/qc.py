"""Automated quality control for an unattended recording.

WHY THIS EXISTS. The video-producer agent's standing instruction is to extract frames
and look at them, because a blank frame, a stuck wizard step or an unexpectedly French
UI never show up in a frame count or an exit code. Level 3 removes the person who does
that looking, so the checks have to be mechanical or they do not happen.

Every check below is a failure that actually occurred while making the first two videos
by hand:

  STUCK      the French run looped on "Pieces par niveau" for three minutes because the
             room steppers were matched by English label. The frames barely changed.
  BLANK      a driver attached to about:blank films a white rectangle very convincingly.
  LANGUAGE   a French brief filmed in English, or the reverse.
  SHORT      the drive fell over early and encoded whatever it had.

A failure does NOT discard the video. It is uploaded anyway and the request is marked
declined with the reason, because a human needs to see what went wrong far more than
they need a clean queue.
"""
import os, subprocess, sys, json
import imageio_ffmpeg
from PIL import Image, ImageStat

# French words common in the UI chrome; ASCII-safe substrings so encoding cannot matter.
FRENCH_MARKERS = ['Tableau de bord', 'Mes projets', 'Se d', 'Param', 'Continuer',
                  'Connexion', 'tapes', 'Paiements']
ENGLISH_MARKERS = ['Dashboard', 'My Projects', 'Log out', 'Settings', 'Continue',
                   'Sign in', 'Stages', 'Payments']


def sample_frames(video, out_dir, every=2.0):
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        os.remove(os.path.join(out_dir, f))
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([ff, '-y', '-i', video, '-vf', f'fps=1/{every},scale=480:-1',
                    f'{out_dir}/s_%04d.png'], check=True, capture_output=True)
    return sorted(os.path.join(out_dir, f) for f in os.listdir(out_dir))


def check(video, expect_lang, frames_dir=None, min_seconds=25.0, page_text=''):
    """Returns (ok, [problems], stats)."""
    problems, stats = [], {}
    # Into the system temp dir by default. Passing '.' wrote a `_qc/` folder of sample
    # frames into the repository root, which is the sort of thing that gets committed by
    # accident and then lives there forever.
    import tempfile
    base = frames_dir or tempfile.mkdtemp(prefix='gwqc-')
    shots = sample_frames(video, os.path.join(base, '_qc'))
    stats['samples'] = len(shots)

    if len(shots) * 2.0 < min_seconds:
        problems.append(f'video is only about {len(shots)*2}s — expected at least {int(min_seconds)}s')

    grays = [Image.open(p).convert('L') for p in shots]

    # BLANK — a frame with almost no variation is a white or black rectangle.
    blank = sum(1 for g in grays if ImageStat.Stat(g).stddev[0] < 6)
    stats['blank_frames'] = blank
    if blank > max(1, len(grays) * 0.15):
        problems.append(f'{blank} of {len(grays)} sampled frames are blank')

    # STUCK — consecutive samples 2s apart where almost no PIXELS changed.
    #
    # Measured as the fraction of pixels that moved appreciably, not as the mean
    # difference over the frame. Mean difference is the obvious metric and it is wrong
    # here: this UI changes in small regions — a field filling, a tab switching, a
    # number updating — so a real change moves few pixels a long way and leaves the mean
    # near zero. Scoring by mean flagged 26 seconds of a perfectly good French
    # walkthrough as a stall.
    from PIL import ImageChops
    same, worst, run = 0, 0, 0
    for a, b in zip(grays, grays[1:]):
        diff = ImageChops.difference(a, b)
        moved = sum(1 for v in diff.getdata() if v > 12) / (a.width * a.height)
        if moved < 0.002:                       # under 0.2% of the frame
            run += 1; same += 1; worst = max(worst, run)
        else:
            run = 0
    stats['static_pairs'] = same
    stats['longest_static_run_seconds'] = worst * 2
    if worst * 2 >= 24:
        problems.append(f'{worst*2}s of the video does not change — the driver looks stuck')

    # LANGUAGE — from what the page actually said during the run, which the runner
    # records per scene. Exact, and free; pixel-only detection would need OCR.
    seen = (page_text or '').lower()
    if seen:
        fr = sum(1 for m in FRENCH_MARKERS  if m.lower() in seen)
        en = sum(1 for m in ENGLISH_MARKERS if m.lower() in seen)
        stats['french_markers'], stats['english_markers'] = fr, en
        if expect_lang == 'fr' and fr == 0 and en > 1:
            problems.append('brief asked for French but the pages read English')
        if expect_lang == 'en' and en == 0 and fr > 1:
            problems.append('brief asked for English but the pages read French')

    return (len(problems) == 0), problems, stats


if __name__ == '__main__':
    ok, problems, stats = check(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'en')
    print(json.dumps({'ok': ok, 'problems': problems, 'stats': stats}, indent=2))
    sys.exit(0 if ok else 1)
