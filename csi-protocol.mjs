// Espressif csi_recv CSV framing only; no generated or interpolated samples.
export const LEGACY_HEADER = 'type,id,mac,rssi,rate,sig_mode,mcs,bandwidth,smoothing,not_sounding,aggregation,stbc,fec_coding,sgi,noise_floor,ampdu_cnt,channel,secondary_channel,local_timestamp,ant,sig_len,rx_format,len,first_word,data';
export const MODERN_HEADER = 'type,seq,mac,rssi,rate,noise_floor,fft_gain,agc_gain,channel,local_timestamp,sig_len,rx_format,len,first_word,data';
export const MAX_IQ_VALUES = 1024;
export const MAX_LINE_LENGTH = 32768;

function csvLine(line) {
  const result = [];
  let value = '', quoted = false, closed = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === ',') { result.push(value); value = ''; closed = false; }
    else if (closed) {
      if (char !== ' ' && char !== '\t') throw new Error('Unexpected text after a CSV quote');
    } else if (char === '"') {
      if (value.length) throw new Error('Quote inside an unquoted CSV field');
      quoted = true;
    } else value += char;
    if (result.length > 64) throw new Error('Too many CSV fields');
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  result.push(value);
  return result;
}

function integer(value, label) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) throw new Error(`Invalid ${label}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`Invalid ${label}`);
  return number;
}

function validateHeader(fields) {
  const header = fields.map(value => value.trim());
  if (new Set(header).size !== header.length || !header.every(value => /^[a-z_]+$/.test(value))) throw new Error('Invalid CSI header');
  if (!['type', 'mac', 'rssi', 'local_timestamp', 'len', 'data'].every(value => header.includes(value)) ||
      !header.some(value => value === 'seq' || value === 'id') ||
      !header.some(value => value === 'first_word' || value === 'first_word_invalid')) throw new Error('Incomplete CSI header');
  return header;
}

/** One parser per serial connection. The first valid frame fixes the channel layout. */
export class CsiProtocol {
  constructor() { this.header = null; this.signature = null; }

  parse(input) {
    const line = input.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\uFEFF/, '').trim();
    if (!/^(?:CSI_DATA|type)(?:,|$)/.test(line)) return {type: 'log'};
    try {
      if (line.length > MAX_LINE_LENGTH) throw new Error('CSI line exceeds the size limit');
      const fields = csvLine(line);
      if (fields[0] === 'type') {
        this.header = validateHeader(fields);
        return {type: 'header', rawHeader: this.header.join(',')};
      }
      const header = this.header ?? (fields.length === 25 ? LEGACY_HEADER.split(',') : fields.length === 15 ? MODERN_HEADER.split(',') : null);
      if (!header || fields.length !== header.length) throw new Error('Unknown CSI CSV layout');
      const entry = Object.fromEntries(header.map((key, index) => [key, fields[index]]));
      if (entry.type !== 'CSI_DATA') throw new Error('Not a CSI packet');
      const length = integer(entry.len, 'len');
      if (length < 8 || length > MAX_IQ_VALUES || length % 2) throw new Error('Unsupported I/Q array length');
      const values = JSON.parse(entry.data);
      if (!Array.isArray(values) || values.length !== length || !values.every(value => Number.isSafeInteger(value) && value >= -32768 && value <= 32767)) throw new Error('Invalid signed 16-bit I/Q array or len mismatch');
      const firstWord = integer(entry.first_word_invalid ?? entry.first_word, 'first-word flag');
      if (firstWord !== 0 && firstWord !== 1) throw new Error('Invalid first-word flag');
      const sourceTimestamp = integer(entry.local_timestamp, 'local_timestamp');
      const packetId = integer(entry.seq ?? entry.id, 'packet ID');
      const rssi = integer(entry.rssi, 'RSSI');
      if (rssi < -128 || rssi > 127) throw new Error('RSSI is outside the signed 8-bit range');
      const mac = entry.mac.trim().toLowerCase();
      if (!/^(?:[\da-f]{2}:){5}[\da-f]{2}$/.test(mac)) throw new Error('Invalid transmitter MAC');
      const phy = {};
      for (const key of ['sig_mode', 'bandwidth', 'rx_format', 'stbc', 'channel', 'secondary_channel', 'ant']) {
        if (entry[key] !== undefined) phy[key] = integer(entry[key], key);
      }
      // Do not stitch different packet layouts or transmitters into one surface.
      const signature = JSON.stringify([header, length, mac, phy]);
      if (this.signature !== null && signature !== this.signature) throw new Error('CSI layout or transmitter changed; reconnect to start a new capture');
      const binIds = Array.from({length: length / 2 - 2}, (_, index) => index + 2);
      // Always discard four scalar values (two complex slots), even when this
      // packet's flag is zero. Keep zero-valued bins so widths never oscillate.
      const amplitudes = binIds.map(index => Math.hypot(values[index * 2], values[index * 2 + 1]));
      this.signature = signature;
      return {type: 'frame', frame: {
        amplitudes, binIds, sourceTimestamp, rssi, packetId, mac,
        rawLine: line, rawHeader: header.join(','), invalidFirstWord: firstWord === 1,
        layout: {name: header.length === 25 ? 'Espressif 25-column' : header.length === 15 ? 'Espressif 15-column' : 'Espressif header-defined', arrayLength: length, binCount: binIds.length, droppedSlots: [0, 1], phy},
      }};
    } catch (error) { return {type: 'invalid', reason: error.message}; }
  }
}

/** Bound incomplete text; after an oversized line discard through its newline. */
export class CsiLineBuffer {
  constructor(maxLength = MAX_LINE_LENGTH) { this.maxLength = maxLength; this.pending = ''; this.dropping = false; }
  push(text) {
    const result = [];
    let start = 0;
    while (start < text.length) {
      const end = text.indexOf('\n', start), complete = end !== -1;
      const part = text.slice(start, complete ? end : text.length);
      if (!this.dropping) {
        if (this.pending.length + part.length > this.maxLength) {
          this.pending = ''; this.dropping = true;
          result.push({type: 'invalid', reason: 'Serial line exceeds the size limit'});
        } else this.pending += part;
      }
      if (complete) {
        if (!this.dropping) result.push({type: 'line', line: this.pending.replace(/\r$/, '')});
        this.pending = ''; this.dropping = false;
        start = end + 1;
      } else break;
    }
    return result;
  }
}
