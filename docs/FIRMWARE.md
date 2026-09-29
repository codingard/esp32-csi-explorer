# Pinned Espressif firmware

The browser viewer is this project's original work; its reference hardware runs
Espressif's `csi_send` and `csi_recv`. The fetcher downloads source only. Building
and flashing are explicit steps below. Physical operation has not been tested here.

| Item | Pin |
| --- | --- |
| ESP-CSI | [`8633d67152db2808f141cc1595970aa9cf406045`](https://github.com/espressif/esp-csi/tree/8633d67152db2808f141cc1595970aa9cf406045) |
| ESP-IDF | `v6.0.2`, commit `7101770dc6db2667b3c477cc31365dd1acd6db4e` |
| Target / board | `esp32c3` / ESP32-C3-DevKitM-1 |
| Gain component | `espressif/esp_csi_gain_ctrl` 0.1.4 |
| Transitive build helper | `espressif/cmake_utilities` 0.5.3 |
| Upstream license | Apache-2.0; original per-file notices retained |

Upstream component manifests allow IDF `>=4.4.1`. This build recipe instead pins
IDF and component versions. The gain component contains a precompiled C3 library
for IDF 6.0; it is not entirely source code. Its license is retained in
`managed_components/` after Component Manager downloads it.

## Fetch the source

Install and activate [ESP-IDF v6.0.2](https://github.com/espressif/esp-idf/tree/v6.0.2)
using Espressif's platform instructions. Check `idf.py --version` reports 6.0.2.
On macOS/Linux activate its `export.sh`; on Windows use the ESP-IDF terminal.
Then, from this project's root:

```sh
python3 scripts/fetch_firmware.py
python3 scripts/fetch_firmware.py --verify
```

The fetcher checks the official archive's SHA256 against
[manifest.json](../firmware/manifest.json) before extracting the get-started
examples and upstream license into `firmware/esp-csi/`. Exact IDF/component pins
replace open version ranges; their originals remain as `idf_component.yml.upstream`.
A minimal IDF 6 compatibility patch renames `WIFI_BW_HT20` to `WIFI_BW20` and
`WIFI_BW_HT40` to `WIFI_BW40` in both C entrypoints. The fetcher checks each original
C file's SHA256 and requires exactly four HT20 and three HT40 replacements per file.
Original C files remain as `app_main.c.upstream`, with a change notice in the patched
files. Radio settings, UART settings and program logic are unchanged. The extracted
directory is a source archive, not a Git checkout; verification uses file hashes.

A repeat invocation verifies existing source without replacing edited or unknown
files. `--archive path/to/pinned.zip` uses the same checksum check on a local ZIP.
The script never runs downloaded code, installs packages, resets an existing
checkout or flashes a board. The first build downloads pinned components using
ESP-IDF Component Manager; retain each generated `dependencies.lock` with captures.

## Build and flash TX

Connect and identify the transmitter first. Replace `TX_PORT` with its actual
serial port, such as `/dev/cu.usbserial-…`, `/dev/ttyUSB0` or `COM5`. The following
commands use a POSIX shell. Flashing replaces the existing program on that board.

```sh
cd firmware/esp-csi/examples/get-started/csi_send
idf.py set-target esp32c3
idf.py -D PROJECT_VER=csi-8633d67152db build
idf.py -p TX_PORT -b 921600 flash
idf.py -p TX_PORT -b 115200 monitor
```

Exit the monitor with Ctrl+]. Keep TX powered. Its startup log identifies the
configured channel and target send frequency. If flashing at 921600 is unreliable,
use 460800 for flashing only. Flash baud and runtime console baud are independent.

## Build and flash RX

From the sender directory:

```sh
cd ../csi_recv
idf.py set-target esp32c3
idf.py -D PROJECT_VER=csi-8633d67152db build
idf.py -p RX_PORT -b 921600 flash
```

Use the receiver's actual port. Its defaults select UART0 at **921600 baud**;
IDF's C3 defaults map TX to GPIO21 and RX to GPIO20, already connected to the
DevKitM-1 onboard USB-UART bridge. Use its Micro-USB connector. Native-USB-only
boards are not equivalent to this hardware recipe.

The explicit `PROJECT_VER` makes the application version identify this source pin
even when the source archive is extracted inside another Git repository. The full
revision and archive checksum remain in the firmware manifest.

If checking output first, use `idf.py -p RX_PORT -b 921600 monitor`. Look for
complete `CSI_DATA` lines, then exit the monitor before connecting the browser.
The upstream Python/Qt viewer is not required. Follow [HARDWARE.md](HARDWARE.md)
to connect through the browser; it reads serial data and sends no tuning commands.

## Radio and component settings

Both stock examples use **2.4 GHz, channel 11, HT40 with secondary channel below,
MCS0 LGI**, and unencrypted ESP-NOW broadcast. TX targets **100 transmissions/s**;
this is not a guaranteed received rate. RX filters the configured transmitter MAC
`1a:00:00:00:00:00`. Use one TX/RX pair for this baseline. Several stock senders
with the same MAC cannot be distinguished. Configuration changes require matching
firmware changes on both boards; the browser does not retune them.

The receiver records an initial gain baseline and applies Espressif's gain
compensation when printing components. Forced gain is disabled. A printed
component can exceed the signed 8-bit range, so the viewer accepts signed 16-bit
values rather than clipping the measurement.

## CSV emitted by the C3 pin

This header is emitted once, on the first matching packet:

```csv
type,id,mac,rssi,rate,sig_mode,mcs,bandwidth,smoothing,not_sounding,aggregation,stbc,fec_coding,sgi,noise_floor,ampdu_cnt,channel,secondary_channel,local_timestamp,ant,sig_len,rx_format,len,first_word,data
```

The quoted final field alternates imaginary and real components. `len` is the
number of serialized components, not the byte length of their decimal text.
`first_word` flags invalid initial bytes. The viewer conservatively omits the
first two complex slots while preserving the remaining original slot indices.
The Wi-Fi timestamp is not a host wall clock. Older firmware uses `rx_state`
instead of `rx_format`; keep each capture's own header.

Pinned references: [sender source](https://github.com/espressif/esp-csi/blob/8633d67152db2808f141cc1595970aa9cf406045/examples/get-started/csi_send/main/app_main.c),
[receiver source](https://github.com/espressif/esp-csi/blob/8633d67152db2808f141cc1595970aa9cf406045/examples/get-started/csi_recv/main/app_main.c),
[receiver defaults](https://github.com/espressif/esp-csi/blob/8633d67152db2808f141cc1595970aa9cf406045/examples/get-started/csi_recv/sdkconfig.defaults),
[gain component](https://components.espressif.com/components/espressif/esp_csi_gain_ctrl/versions/0.1.4/readme).
Validation and physical acceptance are separate in [TESTING.md](TESTING.md).
