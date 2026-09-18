import {CsiProtocol, CsiLineBuffer} from './csi-protocol.mjs';

const freshStats = () => ({received: 0, invalid: 0, logs: 0, bytes: 0});
const aborted = () => new DOMException('Connection cancelled', 'AbortError');

/** Read-only native Web Serial acquisition. A user gesture must call connect(). */
export class CsiSerial {
  constructor({serial = globalThis.navigator?.serial, onFrame = () => {}, onStatus = () => {}, onError = () => {}} = {}) {
    this.serial = serial;
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.onError = onError;
    this._session = null;
    this._lastStats = freshStats();
  }
  get connected() { return !!this._session?.opened && !this._session.cancelled; }
  get stats() { return {...(this._session?.stats ?? this._lastStats)}; }

  _error(error) { try { this.onError(error); } catch { /* A UI callback must not retain a serial lock. */ } }
  _status(session, state, reason) {
    if (this._session !== session && state !== 'disconnected') return;
    const status = {state, connected: state === 'connected' || state === 'receiving', hasData: session.stats.received > 0, stats: {...session.stats}};
    if (reason) status.reason = reason;
    try { this.onStatus(status); } catch (error) { this._error(error); }
  }

  async connect({baudRate = 921600} = {}) {
    if (!this.serial?.requestPort) throw new Error('Web Serial is unavailable. Open this page in desktop Chrome or Edge over localhost or HTTPS.');
    if (this._session) throw new Error('A serial connection is already open or being opened');
    if (!Number.isSafeInteger(baudRate) || baudRate < 1 || baudRate > 4000000) throw new Error('Invalid baud rate');
    const session = {stats: freshStats(), protocol: new CsiProtocol(), decoder: new TextDecoder(), lines: new CsiLineBuffer(), cancelled: false, opened: false};
    this._session = session;
    this._status(session, 'connecting');
    try {
      // No automatic reconnect or getPorts(): the user chooses the receiver.
      session.port = await this.serial.requestPort();
      if (session.cancelled || this._session !== session) throw aborted();
      session.opening = session.port.open({baudRate, bufferSize: 65536, flowControl: 'none'});
      await session.opening;
      session.opened = true;
      if (session.cancelled || this._session !== session) throw aborted();
      if (!session.port.readable) throw new Error('The selected serial port has no readable stream');
      session.reader = session.port.readable.getReader();
      session.onDisconnect = event => {
        if (event.port !== session.port && event.target !== session.port) return;
        if (session.cancelled) return;
        const error = new Error('The receiver was disconnected');
        this._error(error);
        void this._stop(session, error.message);
      };
      this.serial.addEventListener?.('disconnect', session.onDisconnect);
      this._status(session, 'connected');
      session.reading = this._read(session);
      return this;
    } catch (error) {
      session.cancelled = true;
      await this._finish(session, error.message);
      throw error;
    }
  }

  async _read(session) {
    let reason = 'Serial stream ended';
    try {
      while (!session.cancelled) {
        const {value, done} = await session.reader.read();
        if (session.cancelled) break;
        if (done) throw new Error('The receiver stopped sending serial data');
        if (!value) continue;
        session.stats.bytes += value.byteLength;
        const text = session.decoder.decode(value, {stream: true});
        for (const item of session.lines.push(text)) {
          if (session.cancelled) break;
          const event = item.type === 'line' ? session.protocol.parse(item.line) : item;
          if (event.type === 'frame') {
            session.stats.received++;
            try { this.onFrame(event.frame); } catch (error) { this._error(error); }
          } else if (event.type === 'invalid') session.stats.invalid++;
          else if (event.type === 'log' && item.line?.trim()) session.stats.logs++;
        }
        if (!session.cancelled) this._status(session, session.stats.received ? 'receiving' : 'connected');
      }
    } catch (error) {
      reason = error.message;
      if (!session.cancelled) this._error(error);
    } finally {
      session.cancelled = true;
      try { session.reader.releaseLock(); } catch { /* The device may already be gone. */ }
      session.reader = null;
      // An incomplete final line is deliberately not treated as a CSI packet.
      await this._finish(session, session.stopReason ?? reason);
    }
  }

  async _finish(session, reason) {
    if (session.finishing) return session.finishing;
    session.finishing = (async () => {
      this.serial.removeEventListener?.('disconnect', session.onDisconnect);
      if (session.opened) {
        try { await session.port.close(); } catch { /* Unplugged ports can reject close(). */ }
        session.opened = false;
      }
      if (this._session === session) {
        this._lastStats = {...session.stats};
        this._session = null;
        this._status(session, 'disconnected', reason);
      }
    })();
    return session.finishing;
  }

  async _stop(session, reason) {
    session.cancelled = true;
    session.stopReason = reason;
    // A chooser cannot be closed programmatically. Its eventual result is
    // cancelled before open(), even when a newer connection has been started.
    if (!session.port) return this._finish(session, reason);
    if (session.opening) { try { await session.opening; } catch { /* open() failed */ } }
    if (session.reader) { try { await session.reader.cancel(); } catch { /* Unplugged */ } }
    if (session.reading) await session.reading;
    await this._finish(session, reason);
  }

  async disconnect() {
    if (this._session) await this._stop(this._session, 'Disconnected');
  }
}
