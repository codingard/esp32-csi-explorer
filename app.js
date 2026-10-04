import {prepareClip} from './replay.mjs';
import {drawPlots, COLORS} from './renderer.mjs';
import {parseDataFile, serializeCsv} from './data-io.mjs';
import {CsiSerial} from './serial.mjs';
import {LiveBuffer} from './live-buffer.mjs';

const $ = id => document.getElementById(id);
const cache = new Map();
const buffer = new LiveBuffer(512);
let dataset = null, clip = null, index = 0, source = 'usb';
let playing = false, frozen = false, dirty = true, liveDirty = false;
let last = 0, lastPaint = 0, lastLive = 0, selectedBins = [];
let status = {state: 'disconnected', connected: false, stats: {received: 0, invalid: 0, bytes: 0}};
let connecting = false;
let loadGeneration = 0;

function message(text, error = false) {
  $('status').textContent = text;
  $('error').hidden = !error;
  $('error').textContent = error ? text : '';
}
function controls() {
  document.body.classList.toggle('source-usb', source === 'usb');
  $('tips').textContent = source === 'usb' ? 'Drag the surface to rotate. Space freezes or resumes the view.' : 'Drag the surface to rotate. Space to play / pause. ← → step through samples.';
  $('connect').textContent = status.connected ? 'Disconnect' : connecting ? 'Connecting…' : 'Connect USB';
  $('connect').disabled = connecting;
  for (const id of ['open', 'samples']) $(id).disabled = status.connected || connecting;
  $('session').disabled = source === 'usb' || !dataset;
  for (const id of ['csv', 'json', 'pause', 'present']) $(id).disabled = !clip;
  for (const id of ['reset', 'seek']) $(id).disabled = source === 'usb' || !clip;
  $('pause').textContent = source === 'usb' ? (frozen ? 'Resume view' : 'Freeze view') :
    (playing ? 'Pause' : clip && index >= clip.t.length - 1 ? 'Play again' : 'Play');
}
function statusView() {
  const stale = status.connected && status.stats.received > 0 && performance.now() - buffer.lastArrival > 3000;
  $('connection-state').textContent = source === 'file' ? 'File source' :
    stale ? 'No recent CSI' : {connecting: 'Connecting', connected: 'Waiting for CSI', receiving: 'Receiving CSI', disconnected: 'Disconnected'}[status.state];
  $('connection-state').dataset.state = stale || source === 'file' ? 'idle' : status.state;
  $('packet-stats').textContent = source === 'usb' ? `${status.stats.received} valid · ${status.stats.invalid} rejected` : `${dataset?.clips.length||0} sessions`;
  $('connection-detail').textContent = source === 'usb' ? 'USB serial · 921600 baud' : 'Local file';
}
const receiver = new CsiSerial({
  onFrame(frame) { buffer.append(frame); liveDirty = true; },
  onStatus(next) {
    const justOpened = next.state === 'connected' && status.state === 'connecting';
    status = next;
    if (justOpened) {
      source = 'usb'; dataset = null; cache.clear(); buffer.clear(); resetView();
      $('source-info').textContent = 'USB receiver · Espressif ESP-CSI firmware';
      $('source-note').textContent = 'Latest 512 valid packets retained. Save CSV preserves the original received rows.';
      $('geometry').textContent = 'Document your transmitter/receiver placement with each experiment.';
      message('Port open. Waiting for valid CSI packets from the receiver.');
    }
    controls(); statusView(); dirty = true;
  },
  onError(error) { message(error.message || String(error), true); }
});
function resetView() {
  clip = null; index = 0; playing = false; frozen = false; selectedBins = [];
  $('bins').replaceChildren();
  $('session').replaceChildren(new Option(source === 'usb' ? 'USB receiver' : 'No source', ''));
  for (const id of ['sample-count','bin-count','amplitude-range','surface-summary','trace-label','history-label','position','last-sample']) $(id).textContent = '—';
  $('seek').value = 0; dirty = true; controls();
}
function chooseBins(c) {
  selectedBins = c.indices;
  $('bins').replaceChildren(...selectedBins.map((bin, line) => {
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Amplitude channel ${line+1}`);
    select.style.setProperty('--trace', COLORS[line]);
    select.append(...c.binIds.map((id, i) => new Option(`Bin ${id}`, i)));
    select.value = bin;
    select.onchange = () => { selectedBins[line] = Number(select.value); dirty = true; };
    return select;
  }));
}
function showMetadata() {
  if (!clip) return;
  $('sample-count').textContent = (source === 'usb' ? buffer.total : clip.t.length).toLocaleString('en');
  $('bin-count').textContent = clip.binIds.length;
  $('amplitude-range').textContent = `0–${clip.max.toFixed(1)} a.u.`;
  $('seek').max = clip.t.length-1;
  $('last-sample').textContent = (clip.sampleOffset||0)+clip.t.length-1;
  controls();
}
function prepared(c) {
  if (!cache.has(c.id)) cache.set(c.id, prepareClip(c));
  return cache.get(c.id);
}
function select(id) {
  clip = prepared(dataset.clips.find(c => c.id === id));
  index = 0; playing = false; chooseBins(clip); showMetadata();
  $('geometry').textContent = clip.geometryNote || 'Device geometry not supplied.';
  $('source-note').textContent = clip.sourceNote || 'Samples appear in stored order.';
  $('source-info').textContent = [dataset.author,dataset.source,dataset.license].filter(Boolean).join(' · ') || 'Local file';
  dirty = true;
}
function load(data, filename) {
  source = 'file'; dataset = data; cache.clear();
  $('session').replaceChildren(...data.clips.map(c => new Option(c.label,c.id)));
  select(data.clips[0].id); statusView();
  message(`${filename} · ${data.clips.length} sessions · acquisition timing is separate from display speed`);
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function currentSession() { return source === 'usb' ? buffer.clip() : clip; }
function togglePlay() {
  if (!clip) return;
  if (source === 'usb') { frozen = !frozen; if (!frozen) liveDirty = true; }
  else { if (index >= clip.t.length-1) index = 0; playing = !playing; }
  dirty = true; controls();
}
$('connect').onclick = async () => {
  loadGeneration++;
  if (status.connected) { await receiver.disconnect(); return; }
  connecting = true; controls();
  try {
    await receiver.connect({baudRate: 921600});
  } catch (error) { message(error.message || String(error), true); }
  finally { connecting = false; controls(); statusView(); }
};
$('open').onclick = () => { loadGeneration++; $('file').value = ''; $('file').click(); };
$('file').onchange = async () => {
  const f = $('file').files[0]; if (!f) return;
  if (status.connected || connecting) return;
  const generation = ++loadGeneration;
  try {
    if (f.size > 20*1024*1024) throw new Error('File exceeds 20 MiB');
    const text = await f.text();
    if (generation !== loadGeneration || status.connected || connecting) return;
    load(parseDataFile(text,f.name),f.name);
  } catch (error) { if (generation === loadGeneration) message(`Could not open ${f.name}: ${error.message}`,true); }
};
$('samples').onclick = async () => {
  if (status.connected || connecting) return;
  const generation = ++loadGeneration;
  try {
    const response = await fetch('./data/recordings.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (generation !== loadGeneration || status.connected || connecting) return;
    load(parseDataFile(text,'recordings.json'),'Bundled ESP32 data');
  } catch (error) { if (generation === loadGeneration) message(`Could not open sample data: ${error.message}`,true); }
};
$('session').onchange = () => select($('session').value);
$('csv').onclick = () => {
  const text = source === 'usb' ? buffer.rawCsv() : serializeCsv(clip);
  download(new Blob([text],{type:'text/csv'}),`${source==='usb'?'esp32-csi-capture':clip.id}.csv`);
  message(source==='usb'?'Saved retained raw CSI rows, including device metadata.':'Saved all amplitude values from this session.');
};
$('json').onclick = () => {
  const c = currentSession(); if (!c) return;
  const {lo,hi,max,dt,variation,vmax,end,indices,...saved} = c;
  const data = source === 'usb' ? {source:'Local USB capture',clips:[saved]} :
    {source:dataset.source,author:dataset.author,license:dataset.license,clips:[saved]};
  download(new Blob([JSON.stringify(data)],{type:'application/json'}),`${c.id}.json`);
  message('Saved the selected session with metadata.');
};
$('pause').onclick = togglePlay;
$('reset').onclick = () => { index=0; playing=false; dirty=true; controls(); };
$('seek').oninput = () => { index=Number($('seek').value); playing=false; dirty=true; controls(); };
for (const id of ['view','window']) $(id).onchange = () => { dirty=true; };
$('angle').oninput = () => { $('angle-value').textContent=$('angle').value+'°'; dirty=true; };
$('focus').onclick = () => {
  const focus = document.body.classList.toggle('focus');
  $('focus').textContent=focus?'Exit focus':'Focus view'; $('focus').setAttribute('aria-pressed',focus); dirty=true;
};
function present(enabled) {
  document.body.classList.toggle('present', enabled);
  dirty = true;
}
$('present').onclick = () => { present(true); $('present').blur(); };
let drag;
$('surface').onpointerdown = e => { drag={x:e.clientX,angle:Number($('angle').value)}; $('surface').setPointerCapture(e.pointerId); };
$('surface').onpointermove = e => { if (drag) { $('angle').value=Math.max(-75,Math.min(75,drag.angle+(e.clientX-drag.x)*.3)); $('angle').oninput(); } };
$('surface').onpointerup = $('surface').onpointercancel = () => { drag=null; };
document.addEventListener('keydown',e => {
  if (e.code === 'Escape' && document.body.classList.contains('present')) { present(false); return; }
  if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)) return;
  if (e.code==='Space') { e.preventDefault(); togglePlay(); }
  if (source==='file' && clip && ['ArrowLeft','ArrowRight'].includes(e.code)) {
    e.preventDefault(); playing=false;
    index=Math.max(0,Math.min(clip.t.length-1,Math.floor(index)+(e.code==='ArrowLeft'?-1:1))); dirty=true; controls();
  }
});
function render() {
  for (const name of ['surface','csi','activity','heat']) {
    const canvas=$(name), r=canvas.getBoundingClientRect(), d=Math.min(devicePixelRatio||1,2);
    const w=Math.round(r.width*d), h=Math.round(r.height*d);
    if (canvas.width!==w || canvas.height!==h) { canvas.width=w; canvas.height=h; }
    const ctx=canvas.getContext('2d'); ctx.setTransform(d,0,0,d,0,0); ctx.clearRect(0,0,r.width,r.height);
    if (clip) drawPlots(ctx,{[name]:{x:0,y:0,w:r.width,h:r.height}},
      {clip,index,angle:Number($('angle').value),view:$('view').value,windowSize:Number($('window').value),indices:selectedBins});
    else { ctx.fillStyle='#577787'; ctx.font='12px monospace'; ctx.textAlign='center';
      ctx.fillText(name==='surface'?'Waiting for CSI data':'No measurements',r.width/2,r.height/2); }
  }
  if (clip) {
    const offset=clip.sampleOffset||0;
    $('position').textContent=`${offset+Math.floor(index)} / ${offset+clip.t.length-1}`;
    $('seek').value=Math.floor(index);
    $('trace-label').textContent=selectedBins.map(i=>clip.binIds[i]).join(' · ');
    $('surface-summary').textContent=`${Math.min(Number($('window').value),Math.floor(index)+1)} samples × ${clip.binIds.length} bins`;
    $('history-label').textContent=`${Math.min(Number($('window').value),clip.t.length)} SAMPLES · |H|`;
  }
  controls();
}
new ResizeObserver(()=>{dirty=true;}).observe($('surface'));
document.addEventListener('visibilitychange',()=>{last=0;dirty=true;});
function frame(now) {
  const dt=last?Math.min((now-last)/1000,.2):0; last=now;
  if (source==='usb' && liveDirty && !frozen && now-lastLive>100 && buffer.ready) {
    const first=!clip; clip=buffer.clip(); index=clip.t.length-1;
    if (first) chooseBins(clip);
    showMetadata(); liveDirty=false; lastLive=now; dirty=true;
  }
  if (source==='file' && clip && playing) {
    index+=Number($('speed').value)*dt;
    if (index>=clip.t.length-1) { if ($('loop').checked) index=0; else {index=clip.t.length-1;playing=false;} }
    dirty=true;
  }
  if (now-lastPaint>40 && dirty) {render();dirty=false;lastPaint=now;}
  statusView(); requestAnimationFrame(frame);
}
if (!navigator.serial) message('USB needs desktop Chrome or Edge on localhost/HTTPS. File viewing is available in this browser.');
resetView(); statusView(); requestAnimationFrame(frame);

// An explicit demo URL opens attributed recordings; the hardware URL stays empty.
if (new URLSearchParams(location.search).get('demo') === 'walking') {
  await $('samples').onclick();
  if (source === 'file' && clip) {
    const walking = dataset.clips.find(c => /walking/i.test(c.label));
    if (walking) { select(walking.id); $('session').value = walking.id; }
    $('window').value = '64'; $('speed').value = '10'; $('loop').checked = true;
    index = Math.min(64, clip.t.length - 1); playing = true; dirty = true;
    controls();
  }
}
