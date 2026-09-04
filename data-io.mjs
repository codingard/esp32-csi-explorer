// Local file conversion only. No acquisition, classification or generated samples.
export const FILE_LIMITS = Object.freeze({bytes: 20 * 1024 * 1024, rows: 20000, bins: 512, cells: 1000000, clips: 100});

const cleanText = (value, fallback = '', max = 2048) => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max)
  : fallback;
const identifier = value => cleanText(value, 'import', 256).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'import';
const fail = message => { throw new Error(message); };
const finite = (value, message) => typeof value === 'number' && Number.isFinite(value) ? value : fail(message);
const numericCell = (cell, message) => cell.trim() !== '' && Number.isFinite(Number(cell)) ? Number(cell) : fail(message);

function coordinateArray(value, count, name) {
  if (!Array.isArray(value) || value.length !== count) fail(`${name} must contain one finite number per row.`);
  return value.map(n => finite(n, `${name} must contain finite numbers.`));
}

function normalizeClip(input, fallback, index, seen) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Each clip must be an object.');
  const rows = input.amplitudes;
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > FILE_LIMITS.rows) fail(`Each clip needs 2–${FILE_LIMITS.rows} amplitude rows.`);
  const width = Array.isArray(rows[0]) ? rows[0].length : 0;
  if (width < 2 || width > FILE_LIMITS.bins) fail(`Each row needs 2–${FILE_LIMITS.bins} CSI bins.`);
  if (rows.length * width > FILE_LIMITS.cells) fail(`Import exceeds ${FILE_LIMITS.cells} amplitude values.`);
  const amplitudes = rows.map((row, i) => {
    if (!Array.isArray(row) || row.length !== width) fail(`Amplitude row ${i + 1} has a different number of bins.`);
    return row.map(v => {
      finite(v, `Amplitude row ${i + 1} contains a non-finite value.`);
      if (v < 0) fail(`Amplitude row ${i + 1} contains a negative magnitude.`);
      return v;
    });
  });
  const binIds = input.binIds ?? Array.from({length: width}, (_, k) => k);
  if (!Array.isArray(binIds) || binIds.length !== width || !binIds.every(Number.isSafeInteger) || new Set(binIds).size !== width) fail('binIds must contain a distinct integer for each bin.');
  const base = identifier(input.id ?? `${fallback}_${index + 1}`);
  let id = base, suffix = 2;
  while (seen.has(id)) id = `${base}_${suffix++}`;
  seen.add(id);
  let sourceTimes;
  if (input.t !== undefined) coordinateArray(input.t, rows.length, 't');
  if (input.sourceTimes !== undefined) sourceTimes = coordinateArray(input.sourceTimes, rows.length, 'sourceTimes');
  else if (input.t !== undefined) sourceTimes = coordinateArray(input.t, rows.length, 't');
  const result = {
    id,
    label: cleanText(input.label, `${fallback}${index ? ` ${index + 1}` : ''}`, 160),
    amplitudes,
    binIds: [...binIds],
    t: Array.from({length: rows.length}, (_, i) => i),
    timeKind: 'sample_index',
    timeLabel: 'Sample index',
    rateLabel: sourceTimes ? 'Sample index · original coordinates retained' : 'Not timestamped',
    sourceNote: cleanText(input.sourceNote, `${rows.length} imported samples · no acquisition rate assumed.`),
    geometryNote: cleanText(input.geometryNote, 'Device placement, antenna orientation and body position were not supplied.'),
  };
  if (input.sampleOffset !== undefined) {
    if (!Number.isSafeInteger(input.sampleOffset) || input.sampleOffset < 0 ||
        input.sampleOffset > Number.MAX_SAFE_INTEGER - (rows.length - 1)) fail('sampleOffset and the final displayed sample index must be nonnegative safe integers.');
    result.sampleOffset = input.sampleOffset;
  }
  if (sourceTimes) {
    result.sourceTimes = sourceTimes;
    result.sourceTimeLabel = cleanText(input.sourceTimeLabel ?? input.timeLabel, 'Original coordinate · unit unspecified', 160);
  }
  // Metadata is data, never HTML or configuration. Return only an own-property JSON copy.
  if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
    result.metadata = JSON.parse(JSON.stringify(input.metadata, (key, value) => ['__proto__', 'prototype', 'constructor'].includes(key) ? undefined : value));
  }
  for (const key of ['raw_file', 'raw_sha256']) if (typeof input[key] === 'string') result[key] = cleanText(input[key]);
  if (Array.isArray(input.removedSlots) && input.removedSlots.every(Number.isSafeInteger)) result.removedSlots = [...input.removedSlots];
  return result;
}

// RFC-style quoting: escaped double quotes, embedded newlines and CRLF are supported.
// Empty cells remain empty; Number('') must never silently become a measured zero.
function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const pushField = () => { row.push(field); field = ''; closed = false; };
  const pushRow = () => {
    pushField();
    if (row.some(cell => cell.trim() !== '')) rows.push(row);
    if (rows.length > FILE_LIMITS.rows + 1) fail(`CSV exceeds ${FILE_LIMITS.rows} rows.`);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ',') pushField();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else if (closed) { if (char !== ' ' && char !== '\t') fail('Malformed CSV: unexpected text after a closing quote.'); }
    else if (char === '"') { if (field.length) fail('Malformed CSV: a quote occurs inside an unquoted field.'); quoted = true; }
    else field += char;
    if (row.length > FILE_LIMITS.bins + 16) fail('CSV has too many columns.');
  }
  if (quoted) fail('Malformed CSV: an unterminated quoted field.');
  if (field.length || closed || row.length) pushRow();
  return rows;
}

function rawCsiClip(header, rows, fallback) {
  const dataIndex = header.indexOf('data'), typeIndex = header.indexOf('type');
  const invalidIndex = header.includes('first_word_invalid') ? header.indexOf('first_word_invalid') : header.indexOf('first_word');
  const timeIndex = header.indexOf('local_timestamp');
  const lengthIndex = header.indexOf('len');
  let width, invalidFirstWordObserved = false;
  const sourceTimes = [], arrays = [];
  for (const [i, row] of rows.entries()) {
    if (row.length !== header.length) fail(`CSI row ${i + 1} has ${row.length} columns; expected ${header.length}.`);
    if (typeIndex >= 0 && row[typeIndex].trim() !== 'CSI_DATA') fail(`CSI row ${i + 1} is not a CSI_DATA record. Export only CSI records and their header.`);
    let values;
    try { values = JSON.parse(row[dataIndex]); } catch { fail(`CSI row ${i + 1} has an invalid data array.`); }
    if (!Array.isArray(values) || values.length < 8 || values.length > FILE_LIMITS.bins * 2 || values.length % 2 || !values.every(Number.isSafeInteger)) fail(`CSI row ${i + 1} needs an even integer array of 8–${FILE_LIMITS.bins * 2} I/Q values.`);
    if (values.some(v => v < -32768 || v > 32767)) fail(`CSI row ${i + 1} exceeds the supported signed 16-bit I/Q range.`);
    if (lengthIndex >= 0 && numericCell(row[lengthIndex], `CSI row ${i + 1} has an invalid len.`) !== values.length) fail(`CSI row ${i + 1} len does not match its data array.`);
    width ??= values.length;
    if (values.length !== width) fail('CSI packet widths change within this file. Export one packet layout per file.');
    if (invalidIndex >= 0) {
      const flag = row[invalidIndex].trim();
      if (flag !== '0' && flag !== '1') fail(`CSI row ${i + 1} has an invalid first-word flag.`);
      invalidFirstWordObserved ||= flag === '1';
    }
    if (timeIndex >= 0) sourceTimes.push(numericCell(row[timeIndex], `CSI row ${i + 1} has an invalid local_timestamp.`));
    const magnitudes = [];
    for (let k = 0; k < values.length; k += 2) magnitudes.push(Math.hypot(values[k], values[k + 1]));
    arrays.push(magnitudes);
  }
  // Match live acquisition: discard the first four scalar components on every
  // packet, and retain every remaining slot, including an all-zero column.
  const binIds = Array.from({length: (width ?? 0) / 2 - 2}, (_, k) => k + 2);
  return {
    id: fallback, label: fallback, amplitudes: arrays.map(row => binIds.map(k => row[k])), binIds,
    ...(timeIndex >= 0 ? {sourceTimes, sourceTimeLabel: 'local_timestamp · original device values'} : {}),
    metadata: {format: 'Espressif CSI_DATA', first_word_discarded: true, first_word_flag_present: invalidIndex >= 0, first_word_invalid_observed: invalidIndex >= 0 ? invalidFirstWordObserved : null, all_zero_bins_removed: false, source_columns: header},
    removedSlots: [0, 1],
    sourceNote: 'Imported CSI I/Q magnitudes. The first two complex slots are conservatively discarded; zero-valued slots are retained, matching live acquisition. No additional gain correction is applied.',
  };
}

function parseCsv(text, fallback) {
  const [rawHeader, ...rows] = csvRows(text);
  if (!rawHeader || rows.length < 2) fail('CSV needs a header and at least two data rows.');
  const header = rawHeader.map(cell => cell.trim());
  if (new Set(header).size !== header.length) fail('CSV has duplicate column names.');
  if (header.includes('data') && (header.includes('type') || header.includes('first_word_invalid') || header.includes('first_word'))) return rawCsiClip(header, rows, fallback);
  if (!['sample', 'time', 'timestamp'].includes(header[0]) || header.length < 3 || !header.slice(1).every(name => /^bin_-?\d+$/.test(name))) fail('Amplitude CSV header must be sample,bin_0,bin_1,… (time or timestamp is also accepted).');
  const amplitudes = [], sourceTimes = [];
  for (const [i, row] of rows.entries()) {
    if (row.length !== header.length) fail(`CSV row ${i + 1} has ${row.length} columns; expected ${header.length}.`);
    sourceTimes.push(numericCell(row[0], `CSV row ${i + 1} has an invalid coordinate.`));
    amplitudes.push(row.slice(1).map(cell => numericCell(cell, `CSV row ${i + 1} contains an empty or non-finite magnitude.`)));
  }
  return {id: fallback, label: fallback, amplitudes, binIds: header.slice(1).map(name => Number(name.slice(4))), sourceTimes, sourceTimeLabel: header[0]};
}

/** Parse a UTF-8 JSON/CSV file. All displayed coordinates are sample indices. */
export function parseDataFile(text, filename = 'import.json') {
  if (typeof text !== 'string') fail('The import must contain UTF-8 text.');
  if (text.length > FILE_LIMITS.bytes || new TextEncoder().encode(text).byteLength > FILE_LIMITS.bytes) fail('File exceeds the 20 MiB import limit.');
  const content = text.replace(/^\uFEFF/, '').trim();
  if (!content) fail('The selected file is empty.');
  const fallback = cleanText(filename, 'import', 160).replace(/^.*[\\/]/, '').replace(/\.(json|csv)$/i, '') || 'import';
  let data;
  if (content.startsWith('{') || /\.json$/i.test(filename)) {
    try { data = JSON.parse(content); } catch { fail('The selected file contains invalid JSON.'); }
  } else data = parseCsv(content, fallback);
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('JSON must contain a clip object or an object with a clips array.');
  const inputs = data.clips === undefined ? [data] : data.clips;
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > FILE_LIMITS.clips) fail(`Import needs 1–${FILE_LIMITS.clips} clips.`);
  if (inputs.reduce((count, clip) => count + (Array.isArray(clip?.amplitudes) ? clip.amplitudes.length : 0), 0) > FILE_LIMITS.rows) fail(`Import exceeds ${FILE_LIMITS.rows} total sample rows.`);
  if (inputs.reduce((count, clip) => count + (Array.isArray(clip?.amplitudes) ? clip.amplitudes.reduce((sum, row) => sum + (Array.isArray(row) ? row.length : 0), 0) : 0), 0) > FILE_LIMITS.cells) fail(`Import exceeds ${FILE_LIMITS.cells} total amplitude values.`);
  const seen = new Set(), result = {clips: inputs.map((input, index) => normalizeClip(input, fallback, index, seen))};
  for (const key of ['source', 'author', 'license']) if (typeof data[key] === 'string') result[key] = cleanText(data[key]);
  return result;
}

/** Lossless magnitude CSV export; metadata and original timestamps belong in JSON. */
export function serializeCsv(clip) {
  const normalized = normalizeClip(clip, 'export', 0, new Set());
  return [`sample,${normalized.binIds.map(id => `bin_${id}`).join(',')}`, ...normalized.amplitudes.map((row, i) => `${i},${row.join(',')}`)].join('\r\n') + '\r\n';
}
