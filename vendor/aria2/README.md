# aria2c sidecar

The app can ship a self-contained `aria2c` next to its own code instead of
requiring the user to install it.

- `tools/prepare-aria2.sh` prepares the binary for this machine, or for the
  target named on its command line (`macos-arm64`, `macos-x86_64`,
  `linux-x86_64`, `windows-x86_64`). `tools/package.sh <target>` runs it
  before `nsh package` and imports only that target's sidecar.
- Prepared files live in `vendor/aria2/current/`, which is a build artifact
  and is gitignored. `lib/aria2-asset.ts` lists what `nsh package` carries;
  the committed stub lists nothing, so a fresh clone still builds and falls
  back to a system `aria2c`. `ARIA2_ONLY=<triple>` narrows the generated
  list to one sidecar.
- macOS builds are relocatable (`@executable_path/lib`) and ad-hoc signed
  again after `install_name_tool`. Windows downloads the official
  self-contained `aria2c.exe` zip and extracts only that file (using Python,
  so Git Bash does not need `unzip`). Linux bundles the shared libraries with
  an `$ORIGIN/lib` rpath, or accepts a static binary through `ARIA2_BIN`.
- At run time the app extracts/copies the sidecar into its data directory and
  starts it through the granted shell (`sh` on macOS/Linux, `cmd.exe` on
  Windows), because `nsh`'s `process.execute` grants exact paths only.

aria2 is licensed under the GNU GPL v2. The source is
<https://github.com/aria2/aria2>. The app imports `COPYING` and
`LICENSE.OpenSSL` from this directory; prepared sidecars contain only the
executable and its libraries, so the licenses are not duplicated inside each
archive. `LICENSE.OpenSSL` covers the OpenSSL libraries aria2 links against.
