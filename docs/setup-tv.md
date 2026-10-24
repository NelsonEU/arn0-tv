# Putting it on a TV

This guide has two halves. The first installs the launcher as an ordinary web app, which is
reversible by uninstalling it. The second changes which app the TV treats as Home and starts at
power-on, which is reversible only if you keep a baseline. Read the second half completely before
running any part of it.

**The original method was tested on one reference TV; a second exact build is listed below.**
The native helpers require a 32-bit process, UID 901 and one of the listed firmware strings.
They do not check the TV's retail model, and matching firmware text does not prove another
model is compatible. Do not add a firmware string without reading the exact TV, saving its
baseline and verifying recovery first.

## Reference device

| | |
| --- | --- |
| Model | QE65Q70BATXXC (Samsung Q70B, 2022) |
| Firmware | T-PTMDEUC-1720.7 |
| Platform | Tizen 6.5, armv7 / 32-bit |
| Launcher app id | `Arn0Lnchr0.Launcher` |
| Developer user | UID 901, no root |

No compatibility claim for other models, years or firmware. Tizen 7/8/9 TVs, The Frame, and
unlisted regional variants remain untested here.

### Additional observed build (not a universal compatibility promise)

On `QN70Q65BAGXZD` with `T-NKLBUABC-1720.7` (32-bit/UID 901), a guarded,
per-device runner completed read-only query, saved and verified an off-TV
snapshot, performed an idempotent restore of the original settings, then
applied the Home redirect once. An independent read-back confirmed the new
`main` operation and Home-related keys; the owner tested the physical Home
button from another app and it opened Arn0. Cold-boot behavior and a full
rollback **from the redirected state** were not tested. The runner is not
included in this repository, and the retail model is not checked inside
`Query.cs`/`Control.cs`—verify it independently before running either helper.
The firmware guard for this build is intentionally exact; do not generalize
it to a version family. See the [validation checklist](native-home-validation.md).

## Part 1 — install the launcher

Prerequisites: Node.js 20+, and the TV in Developer Mode on the same network.

1. Build the package:

   ```sh
   npm run build          # -> dist/arn0-launcher.wgt
   ```

2. Install it. Either Apps2Samsung's **Custom WGT File** option, or Tizen Studio's CLI. Use the
   same Samsung author certificate/profile used for the existing installation when updating.
   Apps2Samsung certificate options depend on its version and signing setup; do not assume that
   **Force Samsung certificate** should always be on or always be off. If an update reports an
   author-certificate mismatch, preserve the current install and resolve signing consistency
   before uninstalling, since uninstalling clears the launcher's saved settings.

3. Open it from the Samsung app list and check it works: apps launch, HDMI tiles switch inputs,
   Settings saves across a restart.

Stop here if you only want the dashboard. You can open it manually from the app list forever and
nothing about the TV's own behaviour has changed. **Part 2 is not required for the launcher to
work** — it only removes the manual step.

## Part 2 — Home button and power-on

### What this actually does

There is no public web-app API for assigning the remote's Home button. On the tested setup, the
existing Developer Mode connection provided a way to run the guarded helper on the TV as UID 901
(not root). The helper uses platform C APIs to read and update the preferences associated with
the `main` app-control operation and Home app id. This is undocumented TV behavior, not a
supported consumer API.

Two small .NET console assemblies in [native/](../native/) do exactly that and nothing else:

- **`Query.cs`** → `Arn0HomeQuery`. Read-only. Prints the current values and exits. It cannot
  write anything; there is no write call in the file.
- **`Control.cs`** → `Arn0HomeControl`. Takes `query`, `verify`, `apply` or `restore`.

Both refuse to start unless all three guards pass: the process is 32-bit, `getuid()` is 901, and
`/etc/prd_info.ini` contains the expected firmware string. Any mismatch aborts before a single
value is read.

`apply` changes the Home operation and `home_appid`; it also writes the saved `auto_start` value
back unchanged:

| Setting | From | To |
| --- | --- | --- |
| `main` app-control operation (via `app_operation_set_current_app`) | `com.samsung.tv.csfs` | `Arn0Lnchr0.Launcher` |
| `db/appfw/home_appid` | `com.samsung.tv.csfs` | `Arn0Lnchr0.Launcher` |
| `db/menu/smart_hub/ontvsetting/auto_start` | saved baseline (`1` on reference TV) | same value |

It reads three further keys (`db/appfw/startup_appid`, `db/appfw/booting_appid_backup`,
`db/first_screen/type`) into the baseline but does not write them. On the reference TV,
`auto_start` was already `1` and remains `1`. The Home-button behavior was tested; the helper does
not itself configure power-on behavior. Do not infer that setting `auto_start` to `1` is sufficient
for startup on another model or firmware. If the saved value is `0`, stop before applying and
research that configuration separately. On another TV, an independent query observed
`startup_appid` and `booting_appid_backup` changing as a platform side effect when the
`main` operation changed, despite `apply` not writing those keys directly. Do not assume
those values stay at the baseline: query all keys again after apply and account for the
actual values in the recovery plan. See the [cross-device validation checklist](native-home-validation.md).

Safety properties worth knowing before you trust it:

- Every write is followed by a read-back, and a mismatch throws.
- `apply` refuses to run unless the current values match your saved baseline exactly, so it will
  not stack on top of a half-finished previous run.
- If anything fails mid-apply, it restores the baseline automatically and says so. If that restore
  also fails it prints `URGENT:` and the underlying error.
- `restore` refuses if a value changed to something that is neither the baseline nor the launcher,
  on the grounds that something else has been editing these keys and you should look first.

### Order of operations

Do these in order. Do not skip step 2.

1. **Connect.** `sdb connect <TV_IP>`, then `sdb devices` to confirm the TV accepted it. This is
   a connection and changes nothing; `sdb disconnect` undoes it.

2. **Query, read-only.** Build and run `Arn0HomeQuery` first, before `Arn0HomeControl` exists on
   the TV at all. You are checking three things: the guards pass, the keys read back values you
   recognise, and `launcher_boot_supported=1`. If that last one is `0`, the TV is telling you the
   app is not eligible for boot and `apply` will refuse anyway — stop and investigate.

   The repository contains the query source and project file, but does not include the private
   SDB runner used for the reference-device session. A normal `sdb shell` is not sufficient on
   this Samsung TV. Do not improvise a command or substitute a different execution method. Until
   you have a reviewed runner that stages the helper, runs it under the expected UID, captures its
   output, and cleans up temporary files, treat the native helper as source for review rather
   than a ready-to-run procedure. The runner must verify the exact device and firmware before any
   invocation.

3. **Save the baseline.** Write the query output to a JSON file off the TV, in the shape
   `Control.cs` expects:

   The following is only the reference TV's baseline. **Do not copy these values as your own**;
   use the exact values returned by your TV's query.

   ```json
   {
     "Home": "com.samsung.tv.csfs",
     "Strings": {
       "db/appfw/home_appid": "com.samsung.tv.csfs",
       "db/appfw/startup_appid": "com.samsung.tv.csfs",
       "db/appfw/booting_appid_backup": "com.samsung.tv.csfs",
       "db/first_screen/type": "com.samsung.tv.csfs"
     },
     "Autostart": 1
   }
   ```

   Keep it somewhere you will still have it after a bad evening — not only on the TV, and not only
   in the repo. `.gitignore` deliberately excludes these files; a baseline is per-device and
   publishing mine would help nobody.

4. **Verify the baseline.** Run `Arn0HomeControl verify <baseline.json>`. It compares the live
   values against the file and prints `ARN0_BASELINE_MATCH=` on success. This proves the file is
   readable, correctly shaped, and actually matches the TV before anything is written.

5. **Apply.** Only after query and baseline verification, run `Arn0HomeControl apply
   <baseline.json>` through the reviewed, device-guarded runner. A successful result prints
   `ARN0_APPLIED=` and includes a read-back of the Home operation, `home_appid`, and `auto_start`.
   Test Home from another app. The helper does not change power-on settings; validate cold-start
   behavior separately before claiming it works.

6. **Know your way back.** `Arn0HomeControl restore <baseline.json>` restores all saved Home and
   startup values and prints `ARN0_RESTORED=`. Use the same reviewed runner that ran the query and
   apply operations.

## Recovery

In rough order of how much you have to lose:

- **Home goes somewhere unexpected, TV otherwise fine.** Run `restore` through the same reviewed
  runner. This is the normal recovery path and is why the baseline must be saved off the TV.
- **The launcher misbehaves.** Restore the baseline before uninstalling the launcher, if the
  developer connection and runner are available. Do not rely on uninstalling an app that is still
  assigned as Home to make the TV recover automatically.
- **You cannot reach the TV over `sdb`.** Developer Mode is toggled from the TV's own menus, which
  are reachable through Samsung's Home — which is what you just redirected. Expect to work via the
  launcher's **Settings → Samsung Home** entry, which opens `com.samsung.tv.csfs` and puts TV
  settings one press away. Leaving that path in the launcher is not decoration; it is the reason
  a bad apply is survivable.
- If neither the launcher nor the developer connection is usable, use Samsung's documented
  consumer support/recovery path for the exact model. Do not enter the service menu or perform a
  factory reset based only on this guide.

A firmware update can change or undo any of this. These are undocumented platform preferences,
not an API with a compatibility promise. Re-run the read-only query after any firmware update
before assuming the state is what you left.

## If you are forking this

The honest summary: Part 1 transfers to any Tizen TV with modest effort. Part 2 does not transfer —
it transfers as a *method*. The method is: find the keys read-only, save a baseline, write the two
values with read-back, keep an automatic rollback, and keep a route back to the TV's own menus.
The listed firmware strings and app id are examples tied to the observed builds; adding yours
requires the same deliberate, device-specific validation.

A coding agent is genuinely useful for the browser-preview and launcher work. For Part 2 it needs
access to your actual TV on your local network, so a hosted chat that can only read this repo
cannot do it. Ask it to query before it controls, and do not let it skip the baseline.
