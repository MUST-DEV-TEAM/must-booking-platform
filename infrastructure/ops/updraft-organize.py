#!/usr/bin/env python3
"""Sort UpdraftPlus uploads in Google Drive into one folder per website and keep
only the newest copy of each backup part.

UpdraftPlus (WordPress) uploads every site's backup into one shared Drive folder,
named like `backup_2026-10-05-0357_Hako_84e065d35af4-uploads2.zip`. This script:

1. moves each top-level file into `<root>/<Site>/` once it is older than
   --min-age (so a set still being uploaded is left alone);
2. per site and per part (db, plugins, themes, uploads, others, mu-plugins, ...)
   keeps the newest backup set containing that part and moves older copies of
   that part to the Drive trash (recoverable for 30 days).

A part is only pruned when the newest copy is at least half the size of the
older one: a much smaller newest copy usually means an upload that failed
part-way, and deleting the older complete copy would lose data.

UpdraftPlus's "Restore" button only sees files in its own folder: to restore a
site, move that site's files back up to the root folder first.

Requires an rclone remote with full Drive scope. Usage:
  updraft-organize.py [--remote gdrive:UpdraftPlus] [--min-age-hours 3] [--dry-run]
"""

import argparse
import collections
from concurrent.futures import ThreadPoolExecutor
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone

NAME_RE = re.compile(
    r"^backup_(?P<ts>\d{4}-\d{2}-\d{2}-\d{4})_(?P<site>.+)_(?P<nonce>[0-9a-f]{12})"
    r"-(?P<part>[a-z-]+?)(?P<chunk>\d*)\.(?:zip|gz|crypt)$"
)


def rclone(*args, capture=False):
    cmd = ["rclone", "--drive-use-trash=true", *args]
    if capture:
        return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
    subprocess.run(cmd, check=True)


def run_all(jobs):
    """Run rclone commands 8 at a time; each Drive call takes ~20 s with rclone 1.60."""
    with ThreadPoolExecutor(max_workers=8) as pool:
        for future in [pool.submit(rclone, *job) for job in jobs]:
            future.result()


def list_files(remote):
    out = rclone("lsjson", "-R", "--files-only", "--no-mimetype", remote, capture=True)
    return json.loads(out)


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote", default="gdrive:UpdraftPlus")
    ap.add_argument("--min-age-hours", type=float, default=3)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--move-only", action="store_true", help="sort into folders, delete nothing")
    args = ap.parse_args()
    remote = args.remote.rstrip("/")
    cutoff = datetime.now(timezone.utc) - timedelta(hours=args.min_age_hours)
    act = "WOULD" if args.dry_run else "DID"

    files = list_files(remote)

    # 1. Move settled top-level backups into their site folder.
    moves = []
    for f in files:
        m = NAME_RE.match(f["Name"])
        if "/" in f["Path"] or not m or parse_time(f["ModTime"]) > cutoff:
            continue
        print(f"{act} move {f['Name']} -> {m['site']}/")
        moves.append(("moveto", f"{remote}/{f['Name']}", f"{remote}/{m['site']}/{f['Name']}"))
        f["Path"] = f"{m['site']}/{f['Name']}"
    if not args.dry_run:
        # Create each site folder once first: parallel moves into a missing folder
        # each create their own (Drive allows duplicate folder names).
        for site in sorted({job[2].rsplit("/", 2)[1] for job in moves}):
            rclone("mkdir", f"{remote}/{site}")
        run_all(moves)
    if args.move_only:
        return 0

    # 2. Keep only the newest copy of each part, per site.
    # site -> part -> set key (timestamp, nonce) -> [files]
    tree = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(list)))
    for f in files:
        m = NAME_RE.match(f["Name"])
        folder = f["Path"].split("/")[0] if "/" in f["Path"] else None
        if not m or folder != m["site"]:
            continue
        tree[m["site"]][m["part"]][(m["ts"], m["nonce"])].append(f)

    trash = []
    for site, parts in sorted(tree.items()):
        for part, sets in sorted(parts.items()):
            if len(sets) < 2:
                continue
            newest_key = max(sets)
            newest_size = sum(f["Size"] for f in sets[newest_key])
            for key, group in sorted(sets.items()):
                if key == newest_key:
                    continue
                old_size = sum(f["Size"] for f in group)
                if newest_size * 2 < old_size:
                    print(f"KEEP {site} {part} {key[0]}: newest copy ({newest_size} B) is under half "
                          f"of this one ({old_size} B), possibly an incomplete upload")
                    continue
                for f in group:
                    print(f"{act} trash {f['Path']}")
                    trash.append(("deletefile", f"{remote}/{f['Path']}"))
    if not args.dry_run:
        run_all(trash)
    return 0


if __name__ == "__main__":
    sys.exit(main())
