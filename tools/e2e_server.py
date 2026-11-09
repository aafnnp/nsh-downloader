#!/usr/bin/env python3
"""Serves the fixtures the engine end-to-end tests download.

Run it, then `tools/run-e2e.sh` (which starts it for you):

    python3 tools/e2e_server.py --port 8123 --dir /tmp/nshdl-e2e
"""

import argparse
import functools
import http.server
import os
import pathlib
import secrets
import socketserver
import subprocess

SEGMENT = b""
SEGMENTS = 3


def encrypted(data: bytes, key: bytes, iv: bytes) -> bytes:
    return subprocess.run(
        ["openssl", "enc", "-aes-128-cbc", "-K", key.hex(), "-iv", iv.hex()],
        input=data,
        capture_output=True,
        check=True,
    ).stdout


def build(root: pathlib.Path) -> None:
    """Writes the files once: two plain files, a clear HLS stream, an AES-128 one."""
    if (root / "big.bin").exists():
        return
    root.mkdir(parents=True, exist_ok=True)
    (root / "small.bin").write_bytes(secrets.token_bytes(1024 * 1024))
    (root / "proxy-target.bin").write_bytes(secrets.token_bytes(256 * 1024))
    (root / "big.bin").write_bytes(secrets.token_bytes(12 * 1024 * 1024))

    segments = [secrets.token_bytes(100 * 1024) for _ in range(SEGMENTS)]
    clear = root / "hls" / "v0"
    clear.mkdir(parents=True, exist_ok=True)
    for index, data in enumerate(segments):
        (clear / f"seg{index}.ts").write_bytes(data)
    (clear / "index.m3u8").write_text(
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n"
        + "".join(f"#EXTINF:4.0,\nseg{index}.ts\n" for index in range(SEGMENTS))
        + "#EXT-X-ENDLIST\n"
    )
    (root / "hls" / "master.m3u8").write_text(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nv0/index.m3u8\n"
    )

    key = secrets.token_bytes(16)
    iv = bytes(range(16))
    protected = root / "hls" / "enc"
    protected.mkdir(parents=True, exist_ok=True)
    (protected / "key.bin").write_bytes(key)
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:4",
        "#EXT-X-MEDIA-SEQUENCE:0",
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x' + iv.hex(),
    ]
    for index, data in enumerate(segments):
        (protected / f"seg{index}.ts").write_bytes(encrypted(data, key, iv))
        lines += ["#EXTINF:4.0,", f"seg{index}.ts"]
    lines.append("#EXT-X-ENDLIST")
    (protected / "index.m3u8").write_text("\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8123)
    parser.add_argument("--dir", default="/tmp/nshdl-e2e")
    args = parser.parse_args()
    root = pathlib.Path(args.dir)
    build(root)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", args.port), handler) as server:
        print(f"serving {root} at http://127.0.0.1:{args.port}/", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
