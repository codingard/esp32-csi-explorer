import test from 'node:test';
import assert from 'node:assert/strict';
import {CsiProtocol, CsiLineBuffer, LEGACY_HEADER, MODERN_HEADER, MAX_LINE_LENGTH} from '../csi-protocol.mjs';

function packet(header = LEGACY_HEADER, overrides = {}) {
  const fields = {type: 'CSI_DATA', id: 42, seq: 42, mac: '1a:00:00:00:00:00', rssi: -54, rate: 11, sig_mode: 1, mcs: 0, bandwidth: 1, smoothing: 1, not_sounding: 1, aggregation: 0, stbc: 0, fec_coding: 0, sgi: 0, noise_floor: -96, ampdu_cnt: 0, channel: 11, secondary_channel: 2, local_timestamp: 123456, ant: 0, sig_len: 100, rx_format: 1, fft_gain: -5, agc_gain: 3, len: 10, first_word: 1, first_word_invalid: 1, data: '[99,-99,12,-12,3,4,0,0,-300,400]', ...overrides};
  return header.split(',').map(key => key === 'data' ? `"${fields[key].replaceAll('"', '""')}"` : fields[key]).join(',');
}

test('parses actual 25-column schema without a header and retains signed16 magnitude and zero slots', () => {
  const result = new CsiProtocol().parse(packet());
  assert.equal(result.type, 'frame');
  assert.deepEqual(result.frame.amplitudes, [5, 0, 500]);
  assert.deepEqual(result.frame.binIds, [2, 3, 4]);
  assert.equal(result.frame.sourceTimestamp, 123456);
  assert.equal(result.frame.packetId, 42);
  assert.equal(result.frame.rssi, -54);
  assert.equal(result.frame.rawHeader, LEGACY_HEADER);
  assert.equal(result.frame.rawLine, packet());
  assert.equal(result.frame.invalidFirstWord, true);
});

test('accepts C5/C6 schema and an explicit legacy header with first_word_invalid alias', () => {
  const modern = new CsiProtocol();
  assert.equal(modern.parse(MODERN_HEADER).type, 'header');
  assert.equal(modern.parse(packet(MODERN_HEADER)).frame.packetId, 42);
  const header = LEGACY_HEADER.replace('first_word,', 'first_word_invalid,').replace('rx_format,', 'rx_state,');
  const legacy = new CsiProtocol();
  assert.equal(legacy.parse(`\x1b[0;32m${header}\x1b[0m`).type, 'header');
  assert.equal(legacy.parse(packet(header, {rx_state: 0})).type, 'frame');
});

test('always discards first two complex slots; changing flags does not change layout', () => {
  const parser = new CsiProtocol();
  assert.equal(parser.parse(packet()).type, 'frame');
  const result = parser.parse(packet(LEGACY_HEADER, {first_word: 0, id: 43, data: '[0,0,0,0,0,0,0,0,0,0]'}));
  assert.equal(result.type, 'frame');
  assert.deepEqual(result.frame.amplitudes, [0, 0, 0]);
  assert.deepEqual(result.frame.binIds, [2, 3, 4]);
  assert.equal(result.frame.invalidFirstWord, false);
});

test('rejects malformed or incompatible packets without poisoning the first valid layout', () => {
  const parser = new CsiProtocol();
  for (const overrides of [
    {len: 11}, {len: 12}, {data: '[1,2,3,4,5,6,7,8,9,32768]'},
    {data: '[1,2,3,4,5,6,7,8,9,1.5]'}, {first_word: 2}, {rssi: ''},
    {mac: 'device 1'}, {local_timestamp: 'NaN'}, {id: '9007199254740992'},
  ]) assert.equal(parser.parse(packet(LEGACY_HEADER, overrides)).type, 'invalid');
  assert.equal(parser.parse(packet()).type, 'frame');
  for (const overrides of [{len: 8, data: '[1,2,3,4,5,6,7,8]'}, {bandwidth: 0}, {channel: 6}, {mac: '1a:00:00:00:00:01'}]) {
    assert.equal(parser.parse(packet(LEGACY_HEADER, overrides)).type, 'invalid');
  }
  assert.equal(parser.parse(packet(LEGACY_HEADER, {id: 44})).type, 'frame');
});

test('tolerates boot logs but rejects malformed quoting and headers', () => {
  const parser = new CsiProtocol();
  assert.equal(parser.parse('I (234) boot: CSI_DATA capture enabled').type, 'log');
  assert.equal(parser.parse('').type, 'log');
  assert.equal(parser.parse(packet().slice(0, -1)).type, 'invalid');
  assert.equal(parser.parse(`${packet()}junk`).type, 'invalid');
  assert.equal(parser.parse('type,id,data').type, 'invalid');
  assert.equal(parser.parse(LEGACY_HEADER.replace('rate,', 'rssi,' )).type, 'invalid');
});

test('bounded framing handles arbitrary chunks, CRLF, and overlong resynchronization', () => {
  const lines = new CsiLineBuffer();
  assert.deepEqual(lines.push('boot\r'), []);
  assert.deepEqual(lines.push('\nCSI_'), [{type: 'line', line: 'boot'}]);
  assert.deepEqual(lines.push('DATA\n\n'), [{type: 'line', line: 'CSI_DATA'}, {type: 'line', line: ''}]);
  assert.deepEqual(lines.push('x'.repeat(MAX_LINE_LENGTH)), []);
  assert.equal(lines.pending.length, MAX_LINE_LENGTH);
  assert.equal(lines.push('overflow')[0].type, 'invalid');
  assert.equal(lines.pending.length, 0);
  assert.deepEqual(lines.push('tail\nnext\n'), [{type: 'line', line: 'next'}]);
});
