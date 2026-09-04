# Recorded data attribution

Author: Mohammed-Baqir. Dataset: **RF_ESP32_Dataset**.
Source: https://github.com/Mohammed-Baqir/RF_ESP32_Dataset
License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Upstream notice is preserved in LICENSE.txt. No endorsement is implied.

Pinned revision: `648702d266de0586de1ec0a01154968f8b379a5d`.
Archive: `01_human_activity.zip`.
SHA-256: `0a518e47e7efc25ebb351e084a9aef35d8427ac6b97a27601988da06b2f8ae1a`.

Included buffers (unchanged .npy files):
- `session_20260118_224252/csi_data.npy` → `session_20260118_224252.npy`
- `session_20260130_151815/csi_data.npy` → `session_20260130_151815.npy`
- `session_20260118_224110/csi_data.npy` → `session_20260118_224110.npy`

Adaptations by ardchain / this prototype: convert stored complex values to
magnitudes, conservatively exclude slots 0 and 1 (potential invalid first word)
and slots that remain zero throughout each buffer, round magnitudes to six decimals,
and visualize. Included per-clip hashes and retained slot IDs allow checking the
transformation. No noise, fabricated people or extra recorded samples were added.

Each NPY file contains only 200 rows, although session metadata lists many more
frames. Per-row timestamps are not included. We use sample index, not invented
time. The playback rate of 20 rows/s is for presentation. Session activity labels
are author annotations; this application does not classify activities.
