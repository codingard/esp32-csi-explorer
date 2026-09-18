import test from 'node:test';
import assert from 'node:assert/strict';
import {CsiSerial} from '../serial.mjs';
import {LEGACY_HEADER, MAX_LINE_LENGTH} from '../csi-protocol.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const line = 'CSI_DATA,42,1a:00:00:00:00:00,-54,11,1,0,1,1,1,0,0,0,0,-96,0,11,2,123456,0,100,1,10,1,"[9,9,9,9,3,4,0,0,-300,400]"';

function mockPort({opening, openError} = {}) {
  return {
    openCalls: [], closeCalls: 0, cancelCalls: 0,
    async open(options) {
      this.openCalls.push(options);
      if (openError) throw openError;
      if (opening) await opening;
      this.readable = new ReadableStream({
        start: controller => { this.controller = controller; },
        cancel: () => { this.cancelCalls++; },
      });
    },
    async close() { assert.equal(this.readable?.locked, false); this.closeCalls++; },
    send(value) { this.controller.enqueue(value instanceof Uint8Array ? value : new TextEncoder().encode(value)); },
    // The reader must never obtain a writer or toggle a receiver's boot pins.
    get writable() { throw new Error('Must not request serial writes'); },
    setSignals() { throw new Error('Must not toggle signals'); },
  };
}

function mockSerial(port) {
  const target = new EventTarget();
  target.requestCalls = 0;
  target.requestPort = async () => { target.requestCalls++; return typeof port === 'function' ? port() : port; };
  target.unplug = device => { const event = new Event('disconnect'); Object.defineProperty(event, 'port', {value: device}); target.dispatchEvent(event); };
  return target;
}

test('read-only acquisition decodes byte fragments and distinguishes connection from valid CSI', async () => {
  const port = mockPort(), serial = mockSerial(port), frames = [], statuses = [], errors = [];
  const receiver = new CsiSerial({serial, onFrame: frame => frames.push(frame), onStatus: status => statuses.push(status), onError: error => errors.push(error)});
  await receiver.connect();
  assert.equal(receiver.connected, true);
  assert.equal(statuses.at(-1).state, 'connected');
  assert.equal(statuses.at(-1).hasData, false);
  assert.equal(serial.requestCalls, 1);
  assert.equal(port.openCalls[0].baudRate, 921600);
  const bytes = new TextEncoder().encode(`boot café ✓\r\n${LEGACY_HEADER}\r\n${line}\r\n`);
  for (let i = 0; i < bytes.length; i++) port.send(bytes.slice(i, i + 1));
  await tick();
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].amplitudes, [5, 0, 500]);
  assert.equal(statuses.at(-1).state, 'receiving');
  assert.deepEqual(receiver.stats, {received: 1, invalid: 0, logs: 1, bytes: bytes.length});
  await receiver.disconnect();
  await receiver.disconnect();
  assert.equal(receiver.connected, false);
  assert.equal(port.closeCalls, 1);
  assert.equal(port.readable.locked, false);
  assert.equal(statuses.at(-1).state, 'disconnected');
  assert.deepEqual(errors, []);
});

test('corruption and overlong lines never fabricate samples and resynchronize on newline', async () => {
  const port = mockPort(), frames = [];
  const receiver = new CsiSerial({serial: mockSerial(port), onFrame: frame => frames.push(frame)});
  await receiver.connect();
  port.send(`${line.replace(',10,1,', ',9,1,')}\n${'x'.repeat(MAX_LINE_LENGTH + 1)}`);
  port.send(`not a new line yet\n${line}\n${line.slice(0, -8)}`);
  await tick();
  assert.equal(frames.length, 1);
  assert.equal(receiver.stats.invalid, 2);
  await receiver.disconnect();
  assert.equal(frames.length, 1);
});

test('port open failure can be retried and retains no connection', async () => {
  const failed = mockPort({openError: new Error('Port is busy')}), good = mockPort();
  let count = 0;
  const receiver = new CsiSerial({serial: mockSerial(() => ++count === 1 ? failed : good)});
  await assert.rejects(receiver.connect(), /Port is busy/);
  assert.equal(receiver.connected, false);
  await receiver.connect();
  assert.equal(receiver.connected, true);
  await receiver.disconnect();
});

test('unplug cancels the reader, releases the lock and ignores unrelated ports', async () => {
  const port = mockPort(), serial = mockSerial(port), errors = [];
  const receiver = new CsiSerial({serial, onError: error => errors.push(error)});
  await receiver.connect();
  serial.unplug({});
  await tick();
  assert.equal(receiver.connected, true);
  serial.unplug(port);
  await tick();
  assert.equal(receiver.connected, false);
  assert.equal(port.closeCalls, 1);
  assert.equal(port.readable.locked, false);
  assert.match(errors[0].message, /disconnected/);
  await receiver.disconnect();
  assert.equal(port.closeCalls, 1);
});

test('stream errors close the port and leave no synthetic continuation', async () => {
  const port = mockPort(), frames = [], errors = [];
  const receiver = new CsiSerial({serial: mockSerial(port), onFrame: frame => frames.push(frame), onError: error => errors.push(error)});
  await receiver.connect();
  port.send(`${line}\n`);
  await tick();
  port.controller.error(new Error('USB read failed'));
  await tick();
  assert.equal(receiver.connected, false);
  assert.equal(port.closeCalls, 1);
  assert.equal(frames.length, 1);
  assert.equal(errors[0].message, 'USB read failed');
});

test('disconnect during an open waits for it and closes exactly once', async () => {
  const gate = deferred(), port = mockPort({opening: gate.promise});
  const receiver = new CsiSerial({serial: mockSerial(port)});
  const connection = receiver.connect();
  const rejected = assert.rejects(connection, {name: 'AbortError'});
  await tick();
  const disconnection = receiver.disconnect();
  gate.resolve();
  await Promise.all([rejected, disconnection]);
  assert.equal(receiver.connected, false);
  assert.equal(port.closeCalls, 1);
  assert.equal(port.readable.locked, false);
});

test('a stale chooser never opens or closes the newer connection', async () => {
  const gate = deferred(), stale = mockPort(), current = mockPort();
  let count = 0;
  const receiver = new CsiSerial({serial: mockSerial(() => ++count === 1 ? gate.promise : current)});
  const first = receiver.connect();
  const rejected = assert.rejects(first, {name: 'AbortError'});
  await receiver.disconnect();
  await receiver.connect();
  gate.resolve(stale);
  await rejected;
  assert.equal(stale.openCalls.length, 0);
  assert.equal(current.closeCalls, 0);
  assert.equal(receiver.connected, true);
  await receiver.disconnect();
});

test('unsupported browser and chooser cancellation do not create data', async () => {
  const unsupported = new CsiSerial({serial: null});
  await assert.rejects(unsupported.connect(), /Web Serial is unavailable/);
  const receiver = new CsiSerial({serial: mockSerial(() => { throw new DOMException('No port selected', 'NotFoundError'); })});
  await assert.rejects(receiver.connect(), {name: 'NotFoundError'});
  assert.equal(receiver.connected, false);
  assert.deepEqual(receiver.stats, {received: 0, invalid: 0, logs: 0, bytes: 0});
});
