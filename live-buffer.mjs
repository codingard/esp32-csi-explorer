import {prepareClip} from './replay.mjs';

/** Bounded retention of received measurements. No fabricated or gap-fill rows. */
export class LiveBuffer {
  constructor(limit = 512) { this.limit = limit; this.clear(); }
  clear() { this.rows = []; this.total = 0; this.lastArrival = 0; this.startedAt = new Date().toISOString(); }
  append(frame, arrival = performance.now()) {
    this.rows.push({...frame, arrival});
    if (this.rows.length > this.limit) this.rows.shift();
    this.total++;
    this.lastArrival = arrival;
  }
  get ready() { return this.rows.length >= 2; }
  clip() {
    if (!this.ready) return null;
    const offset = this.total - this.rows.length;
    return prepareClip({
      id: 'usb-csi', label: 'USB receiver', timeKind: 'sample_index', timeLabel: 'Sample index',
      t: this.rows.map((_, i) => i), sampleOffset: offset,
      amplitudes: this.rows.map(f => f.amplitudes), binIds: this.rows[0].binIds,
      sourceTimes: this.rows.map(f => f.sourceTimestamp),
      sourceTimeLabel: 'local_timestamp · device counter',
      metadata: {source: 'Web Serial', startedAt: this.startedAt, received: this.total,
        retained: this.rows.length, firstRetainedSample: offset, mac: this.rows[0].mac,
        layout: this.rows[0].layout},
    });
  }
  rawCsv() {
    if (!this.rows.length) throw new Error('No CSI packets have been received.');
    return [this.rows[0].rawHeader, ...this.rows.map(f => f.rawLine)].join('\r\n') + '\r\n';
  }
}
