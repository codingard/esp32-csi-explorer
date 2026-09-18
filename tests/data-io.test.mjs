import test from 'node:test';
import assert from 'node:assert/strict';
import {FILE_LIMITS, parseDataFile, serializeCsv} from '../data-io.mjs';
import {CsiProtocol} from '../csi-protocol.mjs';
import {LiveBuffer} from '../live-buffer.mjs';

const sample = {id: '../Walk <script>', label: 'Desk capture', binIds: [5, 9], t: [4.2, 4.23, 4.24], amplitudes: [[1.23456789, 2], [0, 3], [4, 0]]};

test('single JSON clip preserves amplitudes and original coordinates but displays sample indices', () => {
  const {clips: [clip]} = parseDataFile(JSON.stringify(sample), 'walk.json');
  assert.deepEqual(clip.amplitudes, sample.amplitudes);
  assert.deepEqual(clip.binIds, [5, 9]);
  assert.deepEqual(clip.t, [0, 1, 2]);
  assert.deepEqual(clip.sourceTimes, sample.t);
  assert.equal(clip.timeKind, 'sample_index');
  assert.equal(clip.id, 'Walk_script');
});

test('bundled JSON retains credit and ensures unique sanitized identifiers', () => {
  const result = parseDataFile(JSON.stringify({source: 'https://example.org', author: 'A', license: 'CC BY 4.0', clips: [sample, sample]}));
  assert.equal(result.author, 'A');
  assert.equal(result.source, 'https://example.org');
  assert.equal(result.clips[1].id, `${result.clips[0].id}_2`);
});

test('amplitude CSV export/import round-trip preserves all magnitude precision and bin IDs', () => {
  const csv = serializeCsv(sample);
  const {clips: [clip]} = parseDataFile(csv, 'roundtrip.csv');
  assert.deepEqual(clip.amplitudes, sample.amplitudes);
  assert.deepEqual(clip.binIds, sample.binIds);
  assert.deepEqual(clip.t, [0, 1, 2]);
  assert.deepEqual(clip.sourceTimes, [0, 1, 2]);
  assert.ok(csv.startsWith('sample,bin_5,bin_9\r\n'));
});

test('quoted CSV, BOM, CRLF and reordered source coordinates are accepted without reordering samples', () => {
  const {clips: [clip]} = parseDataFile('\uFEFF"time","bin_-2","bin_7"\r\n"10","2.5","0"\r\n"9","1","3"\r\n', 'capture.csv');
  assert.deepEqual(clip.sourceTimes, [10, 9]);
  assert.deepEqual(clip.amplitudes, [[2.5, 0], [1, 3]]);
});

test('malformed and incomplete CSV fail instead of producing artificial zero samples', () => {
  for (const csv of [
    'sample,bin_0,bin_1\n0,1,2\n1,,3',
    'sample,bin_0,bin_1\n0,1,2\n1,3',
    'sample,bin_0,bin_1\n0,1,2\n1,"3,4',
    'sample,bin_0,bin_1\n0,1,2\n1,"3"garbage,4',
    'sample,bin_0,bin_1\n0,1,2\n1,-1,4',
    'sample,bin_0,bin_0\n0,1,2\n1,3,4',
    'sample,bin_0,bin_1\n0,1,2\n1,NaN,4',
  ]) assert.throws(() => parseDataFile(csv, 'bad.csv'));
});

test('raw Espressif CSV converts I/Q, always filters first word and retains all-zero bins', () => {
  const csv = 'type,id,local_timestamp,len,first_word,data\n'
    + 'CSI_DATA,1,1234,12,0,"[3,4,5,12,0,0,8,15,7,24,20,21]"\n'
    + 'CSI_DATA,2,1250,12,1,"[8,15,7,24,0,0,3,4,5,12,9,12]"\n';
  const {clips: [clip]} = parseDataFile(csv, 'radio.csv');
  assert.deepEqual(clip.binIds, [2, 3, 4, 5]);
  assert.deepEqual(clip.removedSlots, [0, 1]);
  assert.deepEqual(clip.amplitudes, [[0, 17, 25, 29], [0, 5, 13, 15]]);
  assert.deepEqual(clip.sourceTimes, [1234, 1250]);
  assert.equal(clip.metadata.first_word_discarded, true);
  assert.equal(clip.metadata.first_word_invalid_observed, true);
  assert.equal(clip.metadata.all_zero_bins_removed, false);
});

test('raw CSI with zero flags or no flag still discards the first two complex slots', () => {
  const csv = 'type,first_word_invalid,data\nCSI_DATA,0,"[9,9,9,9,3,4,5,12]"\nCSI_DATA,0,"[9,9,9,9,0,1,2,0]"';
  const {clips: [clip]} = parseDataFile(csv, 'radio.csv');
  assert.deepEqual(clip.binIds, [2, 3]);
  assert.deepEqual(clip.amplitudes, [[5, 13], [1, 2]]);
  assert.equal(clip.metadata.first_word_invalid_observed, false);
  const withoutFlag = parseDataFile('type,data\nCSI_DATA,"[9,9,9,9,3,4,5,12]"\nCSI_DATA,"[9,9,9,9,0,1,2,0]"', 'radio.csv').clips[0];
  assert.deepEqual(withoutFlag.amplitudes, clip.amplitudes);
  assert.deepEqual(withoutFlag.binIds, clip.binIds);
  assert.equal(withoutFlag.metadata.first_word_flag_present, false);
  assert.equal(withoutFlag.metadata.first_word_invalid_observed, null);
});

test('raw CSI rejects changing packet widths, malformed arrays and mismatched lengths', () => {
  for (const second of ['CSI_DATA,0,8,"[1,2,3]"', 'CSI_DATA,0,10,"[1,2,3,4,5,6,7,8,9,10]"', 'CSI_DATA,0,7,"[1,2,3,4,5,6,7,8]"', 'CSI_DATA,2,8,"[1,2,3,4,5,6,7,8]"', 'CSI_DATA,0,8,"[1.1,2,3,4,5,6,7,8]"', 'CSI_DATA,0,8,"[1,2,3,4,5,6,7,-32769]"']) {
    assert.throws(() => parseDataFile('type,first_word,len,data\nCSI_DATA,0,8,"[1,2,3,4,5,6,7,8]"\n' + second, 'bad.csv'));
  }
});

function retainedLiveSession() {
  const parser = new CsiProtocol(), buffer = new LiveBuffer(2);
  for (const id of [1, 2, 3]) {
    const result = parser.parse(`CSI_DATA,${id},1a:00:00:00:00:00,-54,11,1,0,1,1,1,0,0,0,0,-96,0,11,2,${id * 100},0,100,1,10,0,"[9,9,9,9,${id * 3},${id * 4},0,0,-300,400]"`);
    assert.equal(result.type, 'frame');
    buffer.append(result.frame);
  }
  return buffer;
}

test('exported live JSON preserves retained sample indices, measurements and device timestamps', () => {
  const session = retainedLiveSession().clip();
  const {lo, hi, max, dt, variation, vmax, end, indices, ...saved} = session;
  const imported = parseDataFile(JSON.stringify({source: 'Local USB capture', clips: [saved]}), 'capture.json').clips[0];
  assert.equal(imported.sampleOffset, 1);
  assert.deepEqual(imported.t, [0, 1]);
  assert.deepEqual(imported.amplitudes, session.amplitudes);
  assert.deepEqual(imported.binIds, session.binIds);
  assert.deepEqual(imported.sourceTimes, [200, 300]);
  assert.deepEqual(imported.metadata, session.metadata);
  assert.equal(imported.sampleOffset + imported.t.at(-1), 2);
});

test('raw live CSV reimport preserves displayed bins and magnitudes including zero-valued columns', () => {
  const buffer = retainedLiveSession(), session = buffer.clip();
  const imported = parseDataFile(buffer.rawCsv(), 'capture.csv').clips[0];
  assert.deepEqual(imported.binIds, [2, 3, 4]);
  assert.deepEqual(imported.binIds, session.binIds);
  assert.deepEqual(imported.amplitudes, session.amplitudes);
  assert.deepEqual(imported.sourceTimes, session.sourceTimes);
  assert.equal(imported.metadata.first_word_invalid_observed, false);
});

test('sampleOffset accepts only nonnegative safe integers with a safe final display index', () => {
  for (const sampleOffset of [-1, 1.5, '12', null, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseDataFile(JSON.stringify({...sample, sampleOffset})), /sampleOffset/);
  }
  for (const sampleOffset of [0, 1000, Number.MAX_SAFE_INTEGER - 2]) {
    const imported = parseDataFile(JSON.stringify({...sample, sampleOffset})).clips[0];
    assert.equal(imported.sampleOffset, sampleOffset);
  }
  assert.throws(() => parseDataFile(JSON.stringify({sampleOffset: Number.MAX_SAFE_INTEGER, amplitudes: [[1, 2], [3, 4]]})), /sampleOffset/);
});

test('JSON validates widths, finite magnitudes, coordinates, bin IDs and limits', () => {
  for (const value of [
    {...sample, amplitudes: [[1, 2], [3]]},
    {...sample, amplitudes: [[1, 2], [null, 3]], t: [0, 1]},
    {...sample, binIds: [5, 5]},
    {...sample, t: [0, 1]},
    {amplitudes: Array.from({length: FILE_LIMITS.rows + 1}, () => [1, 2])},
    {amplitudes: [new Array(FILE_LIMITS.bins + 1).fill(1), new Array(FILE_LIMITS.bins + 1).fill(2)]},
  ]) assert.throws(() => parseDataFile(JSON.stringify(value)));
  assert.throws(() => parseDataFile(' '.repeat(FILE_LIMITS.bytes + 1)), /20 MiB/);
});

test('source metadata is preserved as data without inherited prototype keys', () => {
  const json = '{"amplitudes":[[1,2],[2,3]],"metadata":{"__proto__":{"bad":true},"activity":"<img src=x onerror=alert(1)>"}}';
  const {clips: [clip]} = parseDataFile(json);
  assert.equal(Object.hasOwn(clip.metadata, '__proto__'), false);
  assert.equal(clip.metadata.activity, '<img src=x onerror=alert(1)>');
  assert.equal({}.bad, undefined);
});

test('cell limit counts values across all clips before preparing the display', () => {
  const amplitudes = Array.from({length: 1001}, () => new Array(500).fill(1));
  assert.throws(() => parseDataFile(JSON.stringify({clips: [{amplitudes}, {amplitudes}]})), /total amplitude values/);
});
