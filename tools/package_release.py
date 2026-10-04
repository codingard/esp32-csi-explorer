"""Create a local source release without exports or historical prototypes."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
files = ['index.html', 'style.css', 'app.js', 'replay.mjs', 'renderer.mjs',
         'data-io.mjs', 'serial.mjs', 'csi-protocol.mjs', 'live-buffer.mjs',
         'package.json', 'README.md', 'METHOD.md', 'firmware/manifest.json',
         'LICENSE', '.gitignore']
for folder in ['data', 'docs', 'tests', 'tools', 'scripts', '.github']:
    files += [str(p.relative_to(root)) for p in (root / folder).rglob('*')
              if p.is_file() and '__pycache__' not in p.parts
              and p.name != '.DS_Store']
out = root / 'exports' / 'esp32-csi-explorer-source.zip'
out.parent.mkdir(exist_ok=True)
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    for name in sorted(files):
        archive.write(root / name, 'esp32-csi-explorer/' + name)
print(out)
