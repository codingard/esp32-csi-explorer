// Recorded data transformations only. No signal generator or pose model.
export const quantile=(xs,q)=>{const a=[...xs].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor((a.length-1)*q))]??0};
export function validateClip(clip){
 if(!clip||!Array.isArray(clip.amplitudes)||!Array.isArray(clip.t)||clip.t.length!==clip.amplitudes.length||clip.t.length<2)throw new Error('Recording has no usable sample sequence');
 const n=clip.amplitudes[0].length;if(n<2)throw new Error('Recording has too few CSI bins');
 for(let i=0;i<clip.t.length;i++){if(!Number.isFinite(clip.t[i])||(i&&clip.t[i]<=clip.t[i-1]))throw new Error('Recording timestamps must increase');if(clip.amplitudes[i].length!==n||!clip.amplitudes[i].every(v=>Number.isFinite(v)&&v>=0))throw new Error('Invalid recorded amplitude');}
 return clip;
}
export function prepareClip(input){
 const c=validateClip(input),frames=c.amplitudes,all=frames.flat();const lo=quantile(all,.01),hi=quantile(all,.99);
 const dts=c.t.slice(1).map((t,i)=>t-c.t[i]),dt=quantile(dts,.5);
 // Rolling average of across-bin temporal standard deviations, all channels equally weighted.
 const windowSize=c.timeKind==='sample_index'?19:1;
 const variation=[];let first=0;const sums=new Array(frames[0].length).fill(0),sq=[...sums];
 for(let i=0;i<frames.length;i++){
  for(let k=0;k<sums.length;k++){sums[k]+=frames[i][k];sq[k]+=frames[i][k]**2;}
  while(first<i&&c.t[first]<c.t[i]-windowSize){for(let k=0;k<sums.length;k++){sums[k]-=frames[first][k];sq[k]-=frames[first][k]**2;}first++;}
  const n=i-first+1;
  variation.push(n<3?null:sums.reduce((total,sum,k)=>total+Math.sqrt(Math.max(0,sq[k]/n-(sum/n)**2)),0)/sums.length);
 }
 const max=all.reduce((a,b)=>Math.max(a,b),0),vmax=variation.reduce((a,b)=>Math.max(a,b??0),0);
 return {...c,lo,hi:Math.max(lo+.0001,hi),max,dt,variation,vmax:Math.max(.001,vmax),end:c.t.at(-1),indices:[Math.floor(sums.length*.12),Math.floor(sums.length*.37),Math.floor(sums.length*.63),Math.floor(sums.length*.88)]};
}
export function indexAt(timestamps,time){let lo=0,hi=timestamps.length-1;while(lo<hi){const m=Math.ceil((lo+hi)/2);if(timestamps[m]<=time)lo=m;else hi=m-1;}return lo}
export function windowIndices(c,time,window=10){return {start:indexAt(c.t,Math.max(c.t[0],time-window)),end:indexAt(c.t,time),from:Math.max(c.t[0],time-window),to:Math.max(c.t[0]+window,time)}}
export function colorAt(value,lo,hi,alpha=1){const stops=[[8,18,49],[33,65,135],[38,137,169],[114,199,179],[236,220,151]];const q=Math.max(0,Math.min(4,(value-lo)/(hi-lo)*4)),i=Math.min(3,Math.floor(q)),f=q-i;return `rgba(${stops[i].map((v,k)=>Math.round(v+(stops[i+1][k]-v)*f)).join(',')},${alpha})`}
