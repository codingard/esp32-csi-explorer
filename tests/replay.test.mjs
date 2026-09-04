import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareClip,indexAt,windowIndices,validateClip} from '../replay.mjs';
const fixture={t:[0,.25,.5,.75,1,1.25,1.5],amplitudes:[[1,2],[1,2],[1,2],[1,2],[1,2],[2,3],[3,4]]};
test('replay transforms never alter recorded amplitude rows',()=>{const before=JSON.stringify(fixture),c=prepareClip(fixture);assert.equal(JSON.stringify(fixture),before);assert.deepEqual(c.amplitudes,fixture.amplitudes);assert.equal(c.variation[3],0);assert.ok(c.variation.at(-1)>0);assert.equal(c.dt,.25)});
test('seeking uses the last existing timestamp, never creates interpolated samples',()=>{assert.equal(indexAt(fixture.t,.6),2);assert.equal(indexAt(fixture.t,-1),0);assert.equal(indexAt(fixture.t,10),6);const w=windowIndices(prepareClip(fixture),.6,1);assert.equal(w.end,2);assert.equal(w.from,0)});
test('malformed logs fail rather than silently generating data',()=>{assert.throws(()=>validateClip({...fixture,t:[0,1]}));assert.throws(()=>validateClip({t:[0,0],amplitudes:[[1,2],[2,3]]}));assert.throws(()=>validateClip({t:[0,1],amplitudes:[[1,2],[NaN,3]]}));});
test('sample-index variation excludes the 21st-oldest row',()=>{const t=Array.from({length:21},(_,i)=>i),amplitudes=t.map(i=>i===0?[10,10]:[1,1]);const c=prepareClip({t,amplitudes,timeKind:'sample_index'});assert.ok(c.variation[19]>0);assert.equal(c.variation[20],0)});
