# Optional LAN camera wall

The launcher can show periodic JPEG snapshots from cameras through a local relay.
**Disabled by default:** no camera is discovered, streamed or contacted until both
`cameraServer` and `cameras` are set in `src/js/config.local.js`. This is a viewer,
not a camera recorder or an Intelbras/cloud integration.

## Why

A Samsung web app cannot assume a camera's cloud preview is available on the
same LAN as the TV. Many cameras expose RTSP only with authentication; placing
RTSP usernames/passwords or camera access keys inside the WGT would expose
them to anyone who extracts the package. A separate user-operated relay can
keep those credentials on a computer or recorder and deliver only approved
JPEGs to the TV.

## What

When configured, two console-sized tiles appear beside the HDMI tiles:
**Cameras** (grid with OK to enlarge one feed) and **Camera wall** (full-screen
grid). For seven cameras the grid uses four columns and two rows. Requests
start at staggered times and each image is refreshed about 12 seconds **after
its previous load or error**, avoiding overlapping RTSP captures. Back and
visibility changes stop the requests. An error tile is not proof that a
camera is powered off; check the PC, relay, and local path separately.

These are **still images**, not live video or audio. The relay must be running
while viewing; if it is on a PC, that PC must be on. The launcher makes plain
HTTP requests on the local network, so use a trusted LAN and never expose the
relay port to the internet.

## How to configure

1. Set up your own authenticated camera-to-relay connection. The repository
   does **not** ship a relay or collect camera credentials. The relay must
   answer `GET /snapshot/<id>.jpg` with `Content-Type: image/jpeg` for a
   small allowlist of opaque IDs; return a clear error for unknown IDs.
   Keep a per-camera credential store on the relay host, not in a URL, log,
   TV app or Git repository. Restrict inbound access to the TV's local IP
   with a host firewall or equivalent policy, bind only a LAN interface,
   and do not forward its port on the router.
2. Copy `src/js/config.local.example.js` to the gitignored
   `src/js/config.local.js`. Fill in `cameraServer` with the relay's **private
   IPv4 HTTP origin including port**, and `cameras` with only IDs that
   return a real JPEG. For example:

   ```js
   window.LAUNCHER_LOCAL = {
       cameraServer: 'http://10.0.0.2:8765', // example LAN address; replace locally
       cameras: ['front', 'back']             // relay IDs, never passwords
   };
   ```

   RFC1918 IPv4 addresses (`10/8`, `172.16/12`, `192.168/16`) are accepted.
   Public hosts, HTTPS/RTSP URLs, paths and credentials in the origin are
   rejected by the viewer. The local address and camera IDs are packaged
   into *your local WGT*, despite being gitignored: use opaque IDs, do not
   put secrets in either field, and do not publish the WGT.
3. Test the relay from the TV's network, then build/install an updated WGT.
   Open each tile and confirm images on the physical TV. A browser preview
   or a successful HTTP status on the PC alone is not TV validation.
4. If a camera works in its mobile app but its IP is unreachable from the
   relay host, verify its **current** LAN address and client isolation/guest
   Wi-Fi before adding it. The cloud app's public IP is not a camera endpoint.

Run `node tests/camera-view.test.cjs` for URL, opt-in and wall navigation
regressions. No real camera credentials or household identifiers are used in
that test.
