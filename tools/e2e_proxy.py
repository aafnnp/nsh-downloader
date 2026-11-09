#!/usr/bin/env python3
"""A tiny HTTP proxy for the proxy end-to-end test.

    python3 tools/e2e_proxy.py --port 8127 --serve /tmp/nshdl-e2e

It forwards plain `http://` requests (the absolute-URI form curl and aria2c send
to a proxy) and serves `http://blocked.test/…` from `--serve` itself. That host
does not resolve, so a download of it can only succeed through this proxy — the
test needs no log file to prove the route.
"""

import argparse
import http.server
import pathlib
import socketserver
import urllib.error
import urllib.request

LOG: pathlib.Path
ROOT = pathlib.Path("/tmp/nshdl-e2e")
BLOCKED_HOST = "blocked.test"


def record(line: str) -> None:
    with LOG.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


class Proxy(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args) -> None:  # noqa: D102 - silence the default log
        return

    def serve_blocked(self, target: str) -> bool:
        """Serves `blocked.test` from the fixtures: a host that only exists behind this proxy."""
        if f"//{BLOCKED_HOST}/" not in target + "/" and f"//{BLOCKED_HOST}:" not in target:
            return False
        name = target.split(f"//{BLOCKED_HOST}", 1)[1].split("?", 1)[0].lstrip("/")
        path = (ROOT / name).resolve()
        if not str(path).startswith(str(ROOT.resolve())) or not path.is_file():
            self.send_error(404, "no such fixture")
            return True
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        return True

    def forward(self) -> None:
        target = self.path
        record(f"{self.command} {target}")
        if not target.startswith("http://"):
            self.send_error(400, "only http:// targets are forwarded")
            return
        if self.serve_blocked(target):
            return
        request = urllib.request.Request(target, method=self.command)
        for name, value in self.headers.items():
            if name.lower() in {"host", "proxy-connection", "connection"}:
                continue
            request.add_header(name, value)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read()
                self.send_response(response.status)
                for name, value in response.headers.items():
                    if name.lower() in {"transfer-encoding", "connection"}:
                        continue
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)
        except urllib.error.HTTPError as error:
            self.send_error(error.code, error.reason)
        except Exception as error:  # noqa: BLE001 - the test only needs the failure
            self.send_error(502, str(error))

    def do_GET(self) -> None:
        self.forward()

    def do_HEAD(self) -> None:
        self.forward()

    def do_CONNECT(self) -> None:
        record(f"CONNECT {self.path}")
        self.send_error(501, "CONNECT is not used by these fixtures")


def main() -> None:
    global LOG, ROOT
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8127)
    parser.add_argument("--log", default="/tmp/nshdl-proxy.log")
    parser.add_argument("--serve", default=str(ROOT))
    args = parser.parse_args()
    ROOT = pathlib.Path(args.serve)
    LOG = pathlib.Path(args.log)
    LOG.write_text("", encoding="utf-8")
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", args.port), Proxy) as server:
        print(f"proxy on http://127.0.0.1:{args.port}/ logging to {LOG}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
