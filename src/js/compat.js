/* Tizen 4.0 ships Chromium 56: polyfills for what the rest of the app assumes. */
if (!String.prototype.padStart) {
    String.prototype.padStart = function (len, fill) {
        var s = String(this);
        fill = fill === undefined ? ' ' : String(fill);
        while (s.length < len) s = fill + s;
        return s.slice(s.length - Math.max(len, String(this).length));
    };
}
