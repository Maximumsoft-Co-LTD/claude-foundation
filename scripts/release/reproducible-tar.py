#!/usr/bin/env python3
"""Create a byte-reproducible gzip-compressed tar archive."""

import gzip
import pathlib
import sys
import tarfile


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit(f"usage: {sys.argv[0]} <source-directory> <archive>")
    source = pathlib.Path(sys.argv[1]).resolve()
    archive = pathlib.Path(sys.argv[2]).resolve()
    if not source.is_dir():
        raise SystemExit(f"source is not a directory: {source}")
    entries = [source, *sorted(source.rglob("*"), key=lambda item: item.as_posix())]
    with archive.open("wb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.GNU_FORMAT) as bundle:
                for item in entries:
                    relative = pathlib.Path(source.name) / item.relative_to(source)
                    info = bundle.gettarinfo(str(item), arcname=relative.as_posix())
                    info.uid = 0
                    info.gid = 0
                    info.uname = "root"
                    info.gname = "root"
                    info.mtime = 0
                    if info.isfile():
                        with item.open("rb") as payload:
                            bundle.addfile(info, payload)
                    else:
                        bundle.addfile(info)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
