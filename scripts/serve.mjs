import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const files = new Set(['index.html','style.css','app.js','renderer.mjs','replay.mjs',
  'data-io.mjs','serial.mjs','csi-protocol.mjs','live-buffer.mjs','README.md','METHOD.md',
  'LICENSE','data/recordings.json','data/ATTRIBUTION.md','data/LICENSE.txt',
  'docs/FILE_FORMAT.md','docs/HISTORY.md','docs/HARDWARE.md','docs/FIRMWARE.md','docs/TESTING.md',
  'docs/bom.csv','docs/setup.svg','docs/interface.jpg','docs/build-verification.json']);
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript',
  '.mjs':'text/javascript','.json':'application/json','.md':'text/plain; charset=utf-8',
  '.jpg':'image/jpeg','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.csv':'text/csv'};
const port = Number(process.env.PORT || 4175);
http.createServer(async(req,res)=>{
  try {
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
    const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname.slice(1))||'index.html';
    if (!files.has(p)) throw new Error('Not public');
    const data=await readFile(path.join(root,p));
    res.writeHead(200,{'Content-Type':types[path.extname(p)]||'text/plain',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Permissions-Policy':'serial=(self)',
      'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
    res.end(req.method==='HEAD'?undefined:data);
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`CSI receiver: http://127.0.0.1:${port}`));
