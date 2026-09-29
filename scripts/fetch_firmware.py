#!/usr/bin/env python3
"""Fetch and verify pinned upstream source; never build, flash or replace a tree."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "firmware" / "manifest.json"
STAMP = ".csi-source-manifest.json"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def patch_bandwidth_enums(tree, manifest):
    """Only accept the exact audited upstream files; retain each original."""
    patch = manifest["compatibility_patch"]
    for role, project in manifest["projects"].items():
        source = tree / project / "main" / "app_main.c"
        original = source.read_bytes()
        if digest(original) != patch["source_sha256"][role]:
            raise ValueError(f"Unexpected upstream C source for {role}; refusing compatibility patch.")
        modified = original.decode("utf-8")
        for replacement in patch["replacements"]:
            if modified.count(replacement["old"]) != replacement["count_per_file"]:
                raise ValueError(f"Unexpected enum replacement count for {role}: {replacement['old']}")
            modified = modified.replace(replacement["old"], replacement["new"])
        backup = source.with_suffix(".c.upstream")
        if backup.exists():
            raise ValueError(f"Original C backup already exists for {role}; refusing overwrite.")
        backup.write_bytes(original)
        notice = "/* Modified by ESP32 CSI Explorer: IDF 6 bandwidth enum names only. */\n"
        source.write_text(notice + modified)


def verify(destination, manifest):
    stamp_path = destination / STAMP
    if destination.is_symlink() or not stamp_path.is_file():
        raise ValueError("Existing destination is not a source tree made by this script; left untouched.")
    stamp = json.loads(stamp_path.read_text())
    if stamp.get("manifest_sha256") != digest(MANIFEST.read_bytes()):
        raise ValueError("Source pin differs from this manifest; existing tree left untouched.")
    for name, expected in stamp["files"].items():
        p = destination / name
        if p.is_symlink() or not p.is_file() or digest(p.read_bytes()) != expected:
            raise ValueError(f"Source changed or missing: {name}; existing tree left untouched.")
    print(f"Verified {manifest['revision']} and dependency pins: {destination}")


def prepare(args):
    manifest = json.loads(MANIFEST.read_text())
    destination = args.destination.absolute()
    if destination.exists() or destination.is_symlink():
        verify(destination, manifest)
        return
    if args.verify:
        raise ValueError("No source tree yet. Run without --verify first.")
    if args.archive:
        archive = args.archive.read_bytes()
    else:
        request = urllib.request.Request(manifest["archive_url"], headers={"User-Agent": "esp32-csi-explorer-source-fetcher"})
        with urllib.request.urlopen(request, timeout=60) as response:
            archive = response.read(64 * 1024 * 1024 + 1)
    if len(archive) > 64 * 1024 * 1024 or digest(archive) != manifest["archive_sha256"]:
        raise ValueError("Archive checksum mismatch; no source tree written.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Only the temporary directory owned by this invocation is automatically removed.
    with tempfile.TemporaryDirectory(prefix=".csi-fetch-", dir=destination.parent) as temporary:
        tree = Path(temporary) / "source"
        tree.mkdir()
        with zipfile.ZipFile(io.BytesIO(archive)) as source:
            if sum(member.file_size for member in source.infolist()) > 256 * 1024 * 1024:
                raise ValueError("Unexpected expanded archive size.")
            for member in source.infolist():
                parts = PurePosixPath(member.filename).parts
                if not parts or parts[0] != manifest["archive_root"] or ".." in parts or "\\" in member.filename:
                    raise ValueError("Unexpected archive path.")
                if len(parts) == 1:
                    continue
                relative = "/".join(parts[1:])
                if not any(relative == name or (name.endswith("/") and relative.startswith(name)) for name in manifest["include"]):
                    continue
                if stat.S_ISLNK(member.external_attr >> 16):
                    raise ValueError("Selected source contains a symlink; refusing extraction.")
                target = tree.joinpath(*parts[1:])
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(source.read(member))
        if not (tree / "LICENSE").is_file():
            raise ValueError("Upstream license missing.")
        for role, project in manifest["projects"].items():
            dependency = tree / project / "main" / "idf_component.yml"
            original = dependency.read_text()
            (dependency.with_suffix(".yml.upstream")).write_text(original)
            pinned = "# Modified by ESP32 CSI Explorer: exact dependency pins; see app_main.c compatibility notice.\n"
            pinned += "dependencies:\n  idf: \"==" + manifest["esp_idf"] + "\"\n"
            if role == "receiver":
                for name, version in manifest["components"].items():
                    pinned += f'  {name}: "=={version}"\n'
            dependency.write_text(pinned)
        patch_bandwidth_enums(tree, manifest)
        files = {str(p.relative_to(tree)): digest(p.read_bytes()) for p in sorted(tree.rglob("*")) if p.is_file()}
        (tree / STAMP).write_text(json.dumps({"manifest_sha256": digest(MANIFEST.read_bytes()), "revision": manifest["revision"], "files": files}, indent=2) + "\n")
        # No overwrite/update/reset path: a concurrently created destination wins.
        if destination.exists() or destination.is_symlink():
            raise ValueError("Destination appeared during download; it was left untouched.")
        os.rename(tree, destination)
    verify(destination, manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, default=ROOT / "firmware" / "esp-csi")
    parser.add_argument("--archive", type=Path, help="Use a local copy of the exact pinned ZIP, still checking SHA256")
    parser.add_argument("--verify", action="store_true", help="Verify the existing source and pins without network access")
    args = parser.parse_args()
    try:
        prepare(args)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print(f"Firmware source: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
