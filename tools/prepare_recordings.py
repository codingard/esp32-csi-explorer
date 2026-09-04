"""Read trusted NPY numeric buffers without pickle. No downloaded code is executed."""
import hashlib,io,json,pathlib,sys,zipfile
import numpy as np
root=pathlib.Path(__file__).resolve().parents[1]
archive=pathlib.Path(sys.argv[1])
expected='648702d266de0586de1ec0a01154968f8b379a5d'
archive_hash=hashlib.sha256(archive.read_bytes()).hexdigest()
if archive_hash!='0a518e47e7efc25ebb351e084a9aef35d8427ac6b97a27601988da06b2f8ae1a':
 raise SystemExit('Archive checksum does not match the pinned source; refusing to mislabel data.')
choices=[('session_20260118_224252','Walking · hallway'),('session_20260130_151815','Standing · furnished room'),('session_20260118_224110','Sitting · hallway')]
clips=[]
with zipfile.ZipFile(archive) as z:
 for ident,label in choices:
  base='01_human_activity/'+ident+'/'
  raw=z.read(base+'csi_data.npy')
  a=np.load(io.BytesIO(raw),allow_pickle=False)
  assert a.ndim==2 and a.shape[1]==64 and np.iscomplexobj(a) and np.isfinite(a).all()
  # Conservative removal of first two complex slots (potential invalid first word),
  # followed by slots that are zero throughout this buffer. No active-bin remapping.
  kept=[i for i in range(2,a.shape[1]) if np.any(a[:,i]!=0)]
  amplitude=np.abs(a[:,kept].astype(np.complex128))
  info=json.loads(z.read(base+'session_info.json'));events=info['events']
  notes={'environment':events[-1]['environment'],'activity':events[-1]['activity'],'object_type':events[-1]['object_type'],'distance_field':events[-1]['distance'],'distance_definition':'Not assumed to be TX–RX spacing','raw_shape':list(a.shape),'total_frames_field':info['total_frames']}
  (root/'data'/f'{ident}.npy').write_bytes(raw)
  clips.append({'id':ident,'label':label,'t':list(range(len(a))),'timeLabel':'Sample index','timeKind':'sample_index','rateLabel':'Not timestamped','sourceNote':f'{len(a)} stored rows · playback 20 rows/s, not acquisition time. Session annotation only.','geometryNote':f"Session: {notes['environment'].replace('_',' ')}; author label: {notes['activity']}. The distance field is {notes['distance_field']}, but its reference and device coordinates are not specified. Exact body position, antenna orientation and pose are unavailable.",'binIds':kept,'amplitudes':np.round(amplitude,6).tolist(),'metadata':notes,'raw_file':ident+'.npy','raw_sha256':hashlib.sha256(raw).hexdigest(),'removedSlots':[i for i in range(64) if i not in kept]})
(root/'data'/'recordings.json').write_text(json.dumps({'source':'https://github.com/Mohammed-Baqir/RF_ESP32_Dataset','commit':expected,'license':'CC BY 4.0','author':'Mohammed-Baqir','archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'transformation':'abs(complex stored values); drop slots 0,1 and all-zero slots; round to 6 decimals; sample index only.','clips':clips},separators=(',',':'))+'\n')
for c in clips:print(c['id'],len(c['t']),len(c['binIds']),c['metadata'])
