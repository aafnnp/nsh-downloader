#!/usr/bin/env python3
"""Adds the capabilities the engine end-to-end tests need, around one `nsh test`.

The app ships without `capabilities` (a standalone download manager may write
wherever its user says and reach whatever host a link names). A headless test
engine grants no file system at all, so the e2e run grants the two roots the
fixtures use, and `tools/run-e2e.sh` puts `nsh.json` back afterwards.
"""

import json
import sys

CAPABILITIES = {
    "network": {"hosts": ["*"]},
    "clipboard": True,
    "openUrl": {"schemes": ["http", "https"]},
    "process": {
        "execute": ["curl", "aria2c", "sh", "cmd", "open", "explorer.exe", "xdg-open"],
        "exit": False,
    },
    # macOS resolves /tmp to /private/tmp, and a grant names the canonical path.
    "fs": {"read": ["/tmp", "/private/tmp"], "write": ["/tmp", "/private/tmp"]},
}


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else "nsh.json"
    with open(path, encoding="utf-8") as handle:
        manifest = json.load(handle)
    manifest["capabilities"] = CAPABILITIES
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()
