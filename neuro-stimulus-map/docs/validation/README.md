# Emotion model validation (VGMIDI)

Produced by `scripts/validation/vgmidi_eval.py`; every number below is in `vgmidi.json`.

**Data.** VGMIDI (Ferreira & Whitehead 2019): piano arrangements of video-game music, rendered to
audio, with valence and arousal rated continuously by about 30 online listeners per piece and
recorded once per bar. 95 pieces have both ratings and audio: 3,936 bars and 2,881 listener
ratings of whole pieces. The first 5 s of each piece are dropped while raters settle (DEAM drops
its first 15 s for the same reason).

**Target.** The mean rating of all listeners for each bar, on the raters' -1..1 scale (SD about 0.25).

**Test.** 5-fold cross-validation with **whole pieces held out**, so no bar of a test piece was seen
in fitting. Ridge regularisation was chosen inside each training fold. A stricter check holds out
whole games (different composers, arrangers and sound).

**Human benchmark.** Each listener's curve compared with the mean of the other listeners of the
same piece.

| | Valence (pleasant) r | Arousal (energy) r |
|---|---|---|
| One listener vs the other listeners | 0.51 | 0.49 |
| Literature signs only, not fitted | 0.25 | 0.54 |
| Audio cues, fitted | 0.50 | 0.68 |
| Audio cues + each cue relative to the whole track | 0.64 | 0.75 |
| musicnn mood tags only | 0.47 | 0.59 |
| **Cues + track context + mood tags (used in the app)** | **0.69** (R² 0.46) | **0.77** (R² 0.59) |
| Same, whole games held out | 0.59 | 0.81 |

Other measures for the app model (pieces held out):

- **Piece averages**: r = 0.70 (valence) and 0.79 (arousal).
- **Direction of a piece's average**: whether it is positive or negative agrees with listeners for 82% of pieces on both dimensions.
- **Changes within a piece**: tracked less well. The median per-piece r is 0.20 for valence and 0.43 for arousal; for one listener against the others it is 0.30 and 0.23.
- **Reliability of the crowd average**: 0.92 (split-half, Spearman-Brown). This is the ceiling for any model.

**Reading this.** The model is about as close to the average listener as one listener is. It is
closer for energy, and slightly closer for pleasantness. It is weaker at following moment-to-moment
changes in pleasantness. The pieces are solo piano, so accuracy on other styles is not established.
Spot checks on full-band recordings gave plausible results but are not a validation:

- upbeat funk: pleasant and energetic;
- ragtime: pleasant;
- drum & bass: the most energetic, neutral valence;
- a solo trumpet: pleasant and calm.

**Not validated here.**

- The picture cues for video.
- The brain-system levels. These apply published studies to the estimated emotion (see
  `data/emotion/systems.json`); no dataset pairs songs with measured dopamine or cortisol over time.

**Reproduce.** `python scripts/validation/vgmidi_eval.py --data <cache dir with the VGMIDI JSON files and audio_list.txt> --checkpoint <musicnn MSD_musicnn dir>`.
It downloads the audio from the VGMIDI repository, writes this folder's `vgmidi.json` and refits
`data/emotion/valence_arousal.json`.
