# Measurement and display method

## Measurement display

The viewer displays Wi-Fi channel-state information (CSI) received over USB or
opened from a file. It starts with empty plots. Published example buffers are
loaded only when explicitly selected; they are never substituted for a silent
or disconnected receiver.

The 3D coordinates are **sample index, stored CSI bin, amplitude**. They are not
room coordinates, human occupancy or a point cloud of a body. The surface is a
visual interpolation between samples; point mode shows individual plotted samples.
For rendering speed, the 3D view takes every second row when more than 110 rows
are visible, retaining the final row. The 2D plots and statistic use all rows.

## Evidence and limits

- [Espressif's official examples](https://github.com/espressif/esp-csi) provide CSI
  collection and calibrated motion/presence detection. They do not supply a body
  reconstruction model for this viewer.
- [DensePose From WiFi](https://arxiv.org/html/2301.00250v1) uses multiple antenna
  links and a camera-supervised learned network. The paper reports failures on
  unusual poses and multiple people, and reduced performance in new layouts.
  Its body output cannot be attributed to this single-receiver viewer.
- [ESP32 csi-pose experiment](https://github.com/sel00000/csi-pose) describes six
  ESP32-S3 boards (3TX × 3RX) and camera labels, with evaluation restricted to its
  recorded subject/session/room. It is a different system, not code run here.

Pose research exists, but this project includes neither a trained pose model nor
the matched multi-link recordings and ground truth needed to validate one.

## USB input and raw CSI files

The primary input is the pinned Espressif receiver over Web Serial. The client
validates incoming CSI CSV and retains up to 512 received packets. Status
distinguishes an open port, valid CSI, silence and disconnection. It does not
generate replacement measurements when packets stop arriving.

For USB input and imported raw CSI CSV, successive imaginary/real components
become magnitudes through `Math.hypot(imaginary, real)`. The first four scalar
components (two complex slots) are always discarded conservatively, keeping
original slot indices. Every remaining slot is retained, including all-zero
columns, so the layout stays stable during capture and raw CSV round trips.
Signed 16-bit components are accepted: the pinned receiver applies its own gain
compensation before printing. The viewer neither reverses that compensation nor
adds calibration or converts the values to dBm.

Received sample indices continue across the retained window. Device timestamps
remain raw counters; the client does not infer elapsed acquisition time from
packet count, repair counter rollover or fill missing samples. Session JSON
preserves the first retained sample index. Already-converted JSON and magnitude
CSV retain their supplied bins and are not filtered again.

Firmware, antenna placement and physical USB/RF acceptance are documented in
[FIRMWARE.md](docs/FIRMWARE.md), [HARDWARE.md](docs/HARDWARE.md) and
[TESTING.md](docs/TESTING.md). Successful compilation is recorded separately from
physical acceptance, which remains pending.

## Published example buffers

[RF_ESP32_Dataset by Mohammed-Baqir](https://github.com/Mohammed-Baqir/RF_ESP32_Dataset)
is described by its author as self-collected ESP32 CSI data. We use three stored
complex buffers under CC BY 4.0. [Attribution and exact revision](data/ATTRIBUTION.md).
We did not collect or independently validate the physical experiment.

The NPY files contain 200 × 64 complex values, not the full long sessions. Session
metadata also contains sparse event timestamps; these are not per-row timestamps
for the saved buffers. Therefore **all horizontal axes use sample index**. File
playback speed is a presentation setting, not a claim about the acquisition rate.

The author's [published collection tool](https://github.com/Mohammed-Baqir/RF_ESP32_CSI_Tools/blob/main/GUI_CSI-Dataset_Collection.py)
shifts a rolling complex buffer, appends each decoded imaginary/real byte pair,
and exports that buffer directly with `np.save`. This is consistent with the
stored 200-row arrays, ordered oldest to newest, without AGC correction. The
exact collector revision used for these sessions is not recorded by the dataset.

The author labels the sessions walking, standing and sitting. These are session
annotations, not automatically detected classes or frame-level pose truth. The
selected sessions also carry the broad object label `multiple_people`; no exact
person count is inferred or displayed.

## Example-buffer conversion and graph calculations

1. Load numeric NPY with pickle disabled and check finite complex values.
2. Remove the first two stored complex slots conservatively because ESP32's first
   CSI word may be invalid. The saved arrays do not preserve per-row validity flags.
3. Remove slots that are zero for the entire buffer. Retain original slot numbers;
   do not pretend these are known signed frequency offsets.
4. Compute `abs(stored complex value)` and round to six decimals. Units are raw
   stored magnitude units, not calibrated dBm. No AGC calibration is invented.
5. The traces, heatmap and 3D plot use exactly these values. A rolling 20-sample
   statistic averages each bin's temporal standard deviation. It is **amplitude
   variation**, not a human-motion probability or validated detector.
6. Colors and 3D height use each buffer's 1st–99th amplitude percentiles. Extremes
   are visually clipped; trace plots retain the complete amplitude range. Different
   buffers have separate display scales and are not calibrated cross-room comparisons.

No procedural noise or body generator is loaded. A missing data file produces an
error, never a synthetic fallback. USB input and raw CSI imports use the distinct
stable-bin policy described above; the converted example buffers are not altered
again on import.

## Device geometry and pose

The dataset README identifies a TP-Link access point with three antennas and an
ESP32 receiver with one antenna. This does **not** establish three resolved TX
spatial streams in the saved arrays. Its nominal band is 2.4 GHz. The README says
20 MHz, but selected event metadata contains bandwidth/secondary-channel values
that need interpretation; the UI does not assert a verified channel width.

The session `distance` field is preserved as supplied but is not assumed to be
TX–RX spacing. TX/RX coordinates, orientation, body trajectories and synchronized
pose video are not supplied for these buffers. The equipment diagram is relational
and explicitly not to scale. There is no fabricated room map or person location.

To demonstrate actual body reconstruction later, acquire a documented multi-link
setup, synchronized pose labels, a trained model and held-out validation. For an
ESP32 motion demo, first collect one's own timestamped CSI and documented trials,
then validate detection and false positives against those trials.

## Reproduce the example buffers

`tools/prepare_recordings.py <path/to/pinned/01_human_activity.zip>` requires NumPy.
The script does not run any upstream software. Run `node --test tests/replay.test.mjs`
for renderer data invariants. Serve this folder over HTTP to open the UI.

## Interface video

The accompanying video records the actual browser interface in **Presentation
view**, which hides playback controls. The interface has no wordmark. There is no separate movie
renderer. The selected input is the published walking buffer
`session_20260118_224252`, displayed at **5 samples/s** through a rolling
**64-sample window**. These are presentation settings; the buffer has no per-row
timestamps establishing its acquisition rate.

The video shows previously collected dataset measurements, not a connected
receiver or a physical trial of the reference hardware. Display motion does not
create new signal samples or demonstrate activity recognition. Source attribution
and this capture provenance accompany the video.

The 26-second capture contains 295 native 1600×900 browser frames at measured
intervals (about 11.3 frames/s). The MP4 is scaled to 1920×1080 and encoded at
30 fps with duplicate frames. Encoding does not add measured CSI samples.
