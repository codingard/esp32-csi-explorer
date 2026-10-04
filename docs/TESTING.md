# Validation and physical acceptance

No boards were flashed and no new RF measurements were collected while preparing
this project. The bundled data belongs to the attributed external dataset, not
the two-board reference build. Compilation, protocol fixtures and USB/RF operation
are separate checks.

## Software and source checks

From the project root:

```sh
npm test
python3 scripts/fetch_firmware.py --verify
```

The first command exercises browser-independent code and parsers. The second
checks previously fetched source and pinned dependency manifests without network
access. Neither checks USB drivers or RF. Follow [FIRMWARE.md](FIRMWARE.md) to
compile both examples for `esp32c3`.

### Firmware build status

Both **csi_send** and **csi_recv** compiled successfully on 2026-10-04 for
**ESP32-C3**, using **ESP-IDF 6.0.2**, the pinned components and the documented
bandwidth-enum compatibility patch. Application version: `csi-8633d67152db`.

The source archive checksum, extracted source hashes and transformed files passed
verification. Both builds produced their application, bootloader and partition
binaries and passed the SDK's partition-size checks. [Build fingerprints and
resolved dependencies](build-verification.json) record the two application hashes;
these local build hashes are evidence of compilation, not a guarantee of identical
binaries on every host. No compiled binary is bundled in the source release.

Physical USB/RF acceptance remains **pending**: a compiler pass does not verify
antenna, UART or RF behavior.

## Physical acceptance procedure — pending

Use the reference [parts and placement](HARDWARE.md). Save firmware hashes,
`sdkconfig`, `dependencies.lock`, board identifiers, browser/OS, serial ports and
actual geometry with the capture.

1. **Startup:** flash TX and RX separately. Verify both boot without repeated
   resets or panics and RX emits the documented header followed by complete CSI
   rows. Close the serial monitor before using the browser.
2. **Input:** connect RX at 921600. Verify accepted sample count increases and the
   exported MAC/channel/layout agree with firmware. Diagnostics must not become
   samples. Rejected CSI must not be silently repaired or zero-filled.
3. **Idle trial:** observe 30 seconds with stationary boards and no deliberate
   movement. Record the change in accepted/rejected counters over the interval.
   Save a snapshot of the latest retained 512 packets; this is not the full
   30-second trial. Derive received rate from your timed counter observations,
   and inspect sequence gaps in the raw CSV if needed. A sequence gap alone cannot
   locate loss: RF, UART, reset and host processing can all contribute.
4. **Movement trial:** repeat a documented crossing at least three times and
   compare against idle data. Treat a signal change as an observation, not a
   validated person detector. Report an inconclusive result if motion cannot be
   distinguished from background variation.
5. **Unplug RX:** new samples must stop and the UI must leave its receiving state.
   Existing samples may remain visible; no generated continuation is allowed.
   Reconnect and verify a fresh capture works.
6. **Stop TX:** leave RX connected, remove TX power and verify accepted matching
   samples stop. Silence must not become a quiet-room baseline. Power TX again
   and observe recovery or reconnect explicitly.
7. **Round trip:** save the capture, disconnect and reopen it. Check several
   component pairs against `hypot(imaginary, real)`, accounting for omitted slots.
   Missing/malformed rows must not be interpolated. View settings must not change
   the underlying measurements.
8. **Sustained run:** run for five minutes and note counter totals and the app's
   retention limit. Distinguish the bounded plot/capture buffer from total packets
   received. Save before leaving the page.

## Result template

```text
Date / tester:
Board models and revisions:
ESP-CSI revision / ESP-IDF version / binary SHA256:
TX / RX configuration:
OS / browser version / UART bridge:
TX / RX positions and antenna orientations:
Trial duration / deliberate movement:
Accepted / rejected / sequence gaps / rate:
Unplug RX / stop TX / reconnect result:
Saved capture filename and SHA256:
Known limits or failures:
```

A parser fixture or successful compiler run must not change physical acceptance
to passed. Board USB drivers, power and RF behavior require the actual apparatus.
