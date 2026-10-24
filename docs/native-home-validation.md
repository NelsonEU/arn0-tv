# Validating native Home changes on another TV

This is a **method and safety checklist**, not a compatibility claim or a ready-to-run
SDB runner. Start with [the reference-TV setup guide](setup-tv.md). Do not copy a
reference firmware guard, baseline, or device-specific command to another TV.

## Why

A launcher can work as an ordinary installed app while the remote's Home button
still opens Samsung Home. Redirecting Home is a different, riskier operation:
the native helpers use undocumented platform interfaces, and a broken Home can
make the TV's own settings harder to reach. A successful `sdb connect` or a
zero-exit `sdb shell id` with **empty output** does not show that the helper
ran. The baseline and a working recovery path matter more than a successful
installer message.

On one additional device, an independent query found that changing the `main`
app-control operation also changed `startup_appid` and
`booting_appid_backup`, although `Control.cs` does **not** explicitly write
those keys in `apply`. This is an observation, not a guarantee on any other TV.
It is why a post-apply read-back must inspect **all** Home-related values,
not just the two values that the helper writes directly.

## What to establish before any write

- The exact model and software version from the TV, a reviewed helper with
  guards for that firmware, the intended launcher app ID, and confirmation
  that the launcher opens normally from the app list. Matching firmware text
  alone is not proof of model compatibility.
- A genuine output from `Query.cs` on **that TV**: UID 901, 32-bit process,
  matched firmware guard, `launcher_boot_supported=1`, the default `main`
  operation, all four Home-related string keys, and `auto_start`. If a symbol
  is missing, a value cannot be read, or the output is blank, **stop**.
- An off-TV original snapshot in the format expected by `Control.cs`, plus a
  reviewed transport that can run `verify` and `restore`. Keep the snapshot
  out of the WGT and Git. An idempotent restore of the original values checks
  that the restore calls and read-back work; it does **not** prove recovery
  from every possible half-written state.
- An accessible route to Samsung Home from the launcher, independent of the
  remote Home key. Do not uninstall the launcher while it is assigned as Home.

## How to validate, one gate at a time

1. **Query without changing Home.** Inspect the helper source and its write
   imports; build it for the TV's runtime and architecture. Use a reviewed
   device-specific runner to stage it temporarily, capture a non-empty result,
   and remove staged files. Reject mismatched UID, ABI, firmware, model or
   launcher eligibility. Record the current values; do not substitute the
   example JSON in [setup-tv.md](setup-tv.md).
2. **Verify the snapshot.** Run `Arn0HomeControl verify <original.json>` and compare
   every field to a fresh query. A checksum or file-exists check is not a
   substitute for comparing live TV values.
3. **Test restoration before redirecting.** With informed owner approval, run
   `Arn0HomeControl restore <original.json>` while the TV is still on its original
   Home. Query again independently and test the physical Home button and TV
   menus. Stop if any result disagrees. This is a limited, idempotent test,
   not a claim that all future failures are recoverable.
4. **Apply once, only with specific approval.** Run `Arn0HomeControl apply
   <original.json>` through the *same* reviewed runner. If it aborts, inspect
   the resulting state; do not blindly repeat. Read back the `main` operation,
   all four string keys and `auto_start` using an independent query. Some
   startup-related keys may move together as a platform side effect. Validate
   the resulting values against the new Home state; do not force an expected
   value into a key simply because the reference TV had it.
5. **Test the remote and recovery route.** From another app, press Home and
   confirm the launcher opens. Open Samsung Home from the launcher's own
   Settings entry and confirm TV menus are still reachable. Test power-on
   separately; a working Home button does not establish cold-boot behavior.
   After any firmware update, re-query before trusting these results.

A reverse callback is a *transport*, not proof of helper success. On Windows,
check the active network profile and the inbound firewall rule for the exact
listener executable **before** staging code on the TV. For example,
`python.exe` and `python3.exe` can have different rules. A callback timeout
may be a blocked return path; stop and check TV responsiveness separately
rather than retrying a firmware-specific write.

## Privacy when sharing results

Share only the minimal non-identifying facts needed to discuss compatibility.
Do **not** publish per-TV snapshots, local IPs/SSIDs, MAC addresses, serials,
access keys, pairing codes, QR images, screenshots with device labels,
credential-bearing RTSP URLs, account details, personal file paths or logs
that contain them. Replace examples with placeholders such as `<TV_IP>` and
`<ORIGINAL_SNAPSHOT>`. Review the entire commit diff *and commit metadata*
before pushing; `.gitignore` prevents accidental additions but is not a
substitute for a privacy check. If you want to make a model/firmware
compatibility claim, publish those details deliberately and report the exact
observed checks rather than implying all regional variants are equivalent.
