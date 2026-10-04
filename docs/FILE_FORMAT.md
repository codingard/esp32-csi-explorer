# Import and export formats

The viewer reads files in the browser. Importing never uploads a file or substitutes
generated data. Use UTF-8 JSON or CSV, up to **20 MiB**, **20,000 total sample rows**,
**512 bins per row**, **1,000,000 amplitude values across all clips** and
**100 clips per file**. Every clip needs at least two rows
and two bins. Values must be finite, nonnegative magnitudes; every row must have
the same width. Zero is a valid measured value; an empty CSV cell is an error.

The API in `data-io.mjs` is:

```js
const { clips, source, author, license } = parseDataFile(text, filename);
const csvText = serializeCsv(clips[0]);
```

Both functions throw an `Error` with a readable message on invalid input. There
is no signal generator, classifier, sample interpolation or live acquisition in
this module. `FILE_LIMITS` exposes the limits listed above.

## JSON

Use one clip or a package containing a `clips` array. A minimal clip is:

```json
{
  "id": "desk-01",
  "label": "Desk capture",
  "binIds": [5, 6],
  "t": [123.4, 123.5],
  "amplitudes": [[12.3, 9.4], [12.1, 9.8]]
}
```

These numbers demonstrate the file format; they are not a supplied measurement.
`binIds` may be omitted, in which case columns are numbered from zero. When
provided, IDs must be distinct safe integers. They are slot identifiers; the
viewer does not infer carrier frequencies or antenna coordinates from them.

Packages may include attribution:

```json
{
  "source": "https://example.org/original-dataset",
  "author": "Dataset author",
  "license": "Dataset license",
  "clips": []
}
```

Add one or more complete clips to `clips`; an empty package is rejected. A clip
may also include `metadata`, `sourceNote`, `geometryNote`, `raw_file`,
`raw_sha256` and integer `removedSlots`. IDs are sanitized to letters, digits,
underscores and hyphens, and duplicate IDs receive a suffix. Labels are retained
as text, limited to 160 characters. Metadata is informational, never executable
configuration.

All imported display coordinates become `t: [0, 1, …]`, with
`timeKind: "sample_index"` and `timeLabel: "Sample index"`. An input `t` is
preserved separately as `sourceTimes`. If `sourceTimes` already exists, it takes
precedence and survives a JSON round trip. `sourceTimeLabel` is retained when
present. The importer does **not** assume seconds, derive a capture rate, sort
rows by timestamp or correct device-counter rollover. Source coordinates may
therefore be nonmonotonic; row order is preserved.

An optional `sampleOffset` retains the original sample numbering of a bounded USB
capture. Internal `t` still starts at zero; plotted labels use `sampleOffset + t`.
The offset must be a nonnegative safe integer, and the last displayed index must
also remain a safe integer. Missing offsets mean zero. JSON export/import retains
this value, so a buffer containing samples 1000–1511 reopens with those labels.
The importer does not infer an offset from arbitrary metadata or device timestamps.

## Magnitude CSV

```csv
sample,bin_5,bin_6
0,12.3,9.4
1,12.1,9.8
```

The first column must be `sample`, `time` or `timestamp`. Remaining columns use
`bin_<integer>` names. Original first-column values are retained in `sourceTimes`
with their original column name; displayed coordinates always start at zero.
Quoted fields, escaped quotes, CRLF and LF line endings, and a UTF-8 BOM are
supported. Blank lines are ignored. Duplicate headers, empty numeric cells,
non-finite values and differing row widths are errors.

`serializeCsv(clip)` exports `sample,bin_<id>,…` using sample indices and the
unrounded JavaScript numeric values. The CSV round trip preserves magnitude
values and bin IDs. It intentionally does not include attribution, geometry or
original timestamps. Preserve the original file or export the JSON package when
those fields matter.

## Espressif `CSI_DATA` CSV

The importer also accepts header-based CSI exports with a `data` column containing
a **quoted JSON array** of signed integer I/Q components. The header should contain
`type`, and each record must have `CSI_DATA` in that column. A simplified example:

```csv
type,local_timestamp,len,first_word_invalid,data
CSI_DATA,1000,8,0,"[3,4,5,12,8,15,7,24]"
CSI_DATA,1010,8,0,"[0,1,2,0,3,4,5,12]"
```

The current official example calls the validity column `first_word`; both
`first_word` and `first_word_invalid` are accepted. `len`, if present, must match
the number of scalar array entries. The original `local_timestamp`, if present,
is retained as `sourceTimes`; no time unit or capture rate is inferred. Export
only the header and CSI rows: boot logs and other serial messages are not CSV
records for this importer.

Conversion is explicit:

1. Interpret successive pairs as imaginary/real components and compute
   `Math.hypot(imaginary, real)` without gain compensation or normalization.
2. Always discard the first four scalar components (two complex slots), including
   when all first-word flags are `0` or the flag is absent. This conservative rule
   matches USB acquisition. Supplied flags must be `0` or `1`; metadata records
   whether the flag was present and whether any row reported an invalid first word.
3. Keep every remaining slot, including columns that are zero in **every** row.
   Retain original slot IDs beginning at `2`. This keeps the same displayed bins
   when a raw USB CSV export is reopened. At least eight scalar I/Q entries per
   row are required to leave two complex slots after filtering.

This path supports conventional alternating I/Q arrays, including integer values
already gain-compensated upstream, within a signed 16-bit range. It does not decode
packed 12-bit layouts, infer LTF sections, extract one antenna from multiplexed
data, apply AGC correction or concatenate packets of changing widths. Export one
consistent packet layout per file. A zero-valued slot is retained as received;
its value does not identify it as an active or inactive RF subcarrier.

**Save CSV** for a USB session stores the retained original `CSI_DATA` rows and
their header, including the first-word flags and device timestamps. Reimport
recomputes the same magnitudes with the policy above. Raw CSV has no capture-level
`sampleOffset` or start time; use JSON to preserve those fields. Bundled sample
JSON keeps its original documented preprocessing and is not filtered again.

See Espressif's [CSI receive example](https://github.com/espressif/esp-csi/blob/master/examples/get-started/csi_recv/main/app_main.c)
for its output header and [ESP-IDF CSI documentation](https://docs.espressif.com/projects/esp-idf/en/v5.0.4/esp32/api-guides/wifi.html#wi-fi-channel-state-information)
for the component ordering and invalid-first-word flag.

## Rendering imported metadata

Labels, attribution and metadata are untrusted file content. UI callers must use
`textContent` or equivalent text-only rendering, never `innerHTML`. A source
string is not a trusted link: permit only `http:`/`https:` URLs before assigning
it to an `href`. Parsing does not fetch source URLs. The numerical export creates
only fixed headers and finite numeric cells, not spreadsheet formulas.
