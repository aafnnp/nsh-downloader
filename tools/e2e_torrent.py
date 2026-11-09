#!/usr/bin/env python3
"""Serves a real BitTorrent swarm on this machine, so the magnet path can be tested.

    python3 tools/e2e_torrent.py --dir /tmp/nshdl-e2e/bt --port 8130 --peer-port 6881

It writes a deterministic payload and its `.torrent`, prints the magnet link that
points at its own tracker, then acts as tracker and seeder. A client that accepts
that magnet can only finish by talking to this seeder.
"""

import argparse
import hashlib
import http.server
import pathlib
import socketserver
import subprocess
import time
import urllib.parse

PAYLOAD_SIZE = 512 * 1024
PIECE_LENGTH = 16 * 1024


def bencode(value) -> bytes:
    if isinstance(value, int):
        return b"i%de" % value
    if isinstance(value, bytes):
        return b"%d:%s" % (len(value), value)
    if isinstance(value, str):
        return bencode(value.encode("utf-8"))
    if isinstance(value, list):
        return b"l" + b"".join(bencode(item) for item in value) + b"e"
    if isinstance(value, dict):
        items = sorted((key.encode("utf-8") if isinstance(key, str) else key, val) for key, val in value.items())
        return b"d" + b"".join(bencode(key) + bencode(val) for key, val in items) + b"e"
    raise TypeError(f"cannot bencode {type(value)}")


def build(root: pathlib.Path, trackers: list[str]) -> tuple[pathlib.Path, str, bytes]:
    """Writes the payload (deterministic bytes) and its single-file torrent."""
    root.mkdir(parents=True, exist_ok=True)
    payload = root / "payload.bin"
    data = bytes(range(256)) * (PAYLOAD_SIZE // 256)
    payload.write_bytes(data)
    pieces = b"".join(
        hashlib.sha1(data[index : index + PIECE_LENGTH]).digest()
        for index in range(0, len(data), PIECE_LENGTH)
    )
    info = {"length": len(data), "name": payload.name, "piece length": PIECE_LENGTH, "pieces": pieces}
    info_hash = hashlib.sha1(bencode(info)).hexdigest()
    torrent = root / "payload.torrent"
    torrent.write_bytes(bencode({"announce": trackers[0], "info": info}))
    magnet = (
        f"magnet:?xt=urn:btih:{info_hash}&dn={urllib.parse.quote(payload.name)}"
        + "".join(f"&tr={urllib.parse.quote(tracker)}" for tracker in trackers)
    )
    return torrent, magnet, data


class Tracker(http.server.BaseHTTPRequestHandler):
    peer = ("127.0.0.1", 6881)

    def log_message(self, *args) -> None:
        return

    def do_GET(self) -> None:
        peers = bytes([127, 0, 0, 1]) + self.peer[1].to_bytes(2, "big")
        body = bencode({"interval": 5, "min interval": 5, "peers": peers})
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default="/tmp/nshdl-e2e/bt")
    parser.add_argument("--port", type=int, default=8130)
    parser.add_argument("--peer-port", type=int, default=6881)
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()

    root = pathlib.Path(args.dir)
    announce = f"http://127.0.0.1:{args.port}/announce"
    torrent, magnet, data = build(root, [announce])
    print(f"MAGNET {magnet}", flush=True)
    print(f"PAYLOAD {hashlib.sha256(data).hexdigest()}", flush=True)
    if args.prepare_only:
        return

    Tracker.peer = ("127.0.0.1", args.peer_port)
    socketserver.TCPServer.allow_reuse_address = True
    tracker = socketserver.ThreadingTCPServer(("127.0.0.1", args.port), Tracker)

    seeder = subprocess.Popen(
        [
            "aria2c",
            f"--dir={root}",
            f"--listen-port={args.peer_port}",
            "--seed-time=600",
            "--check-integrity=true",
            "--bt-enable-lpd=false",
            "--enable-dht=false",
            "--console-log-level=warn",
            f"--bt-tracker={announce}",
            str(torrent),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"seeding {torrent.name} on port {args.peer_port}", flush=True)
    try:
        tracker.serve_forever()
    finally:
        seeder.terminate()
        time.sleep(0.2)


if __name__ == "__main__":
    main()
