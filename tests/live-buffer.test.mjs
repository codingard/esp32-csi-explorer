import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveBuffer} from '../live-buffer.mjs';
const packet = i=>({amplitudes:[i,2*i],binIds:[2,3],sourceTimestamp:100*i,mac:'aa:bb:cc:dd:ee:ff',rawHeader:'type,data',rawLine:`CSI_DATA,"[${i},${i}]"`,layout:{name:'test'}});
test('buffer stays empty before measured input; retention never fills a gap',()=>{const b=new LiveBuffer(3);assert.equal(b.clip(),null);b.append(packet(1),1);assert.equal(b.clip(),null);for(const i of [2,4,8])b.append(packet(i),i);const c=b.clip();assert.equal(b.total,4);assert.equal(c.sampleOffset,1);assert.deepEqual(c.amplitudes,[[2,4],[4,8],[8,16]]);assert.deepEqual(c.sourceTimes,[200,400,800]);assert.equal(b.rawCsv().split('\r\n').length,5)});
test('clear removes previous hardware measurements',()=>{const b=new LiveBuffer();b.append(packet(1));b.append(packet(2));b.clear();assert.equal(b.total,0);assert.equal(b.clip(),null);assert.throws(()=>b.rawCsv(),/No CSI/)});
