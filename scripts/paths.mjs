/**
 * Pure image-path helpers.
 *
 * Foundry can rewrite a stored `texture.src` (percent-encoding, cache-busting
 * queries, backslashes on Windows, trailing slashes), so a raw `===`
 * comparison between two references to the *same* file is unreliable. We compare
 * on a normalized form instead.
 */

/**
 * Normalize a path/URL for equality comparison only, never for storage. Never throws.
 * @param {unknown} src
 * @returns {string}
 */
export function normalizePath(src) {
  if (!src || typeof src !== "string") return "";
  let s = src.trim();

  // Only ATF's bare numeric query is cache-busting; other parameters may select an image.
  s = s.replace(/^([^?#]*)\?\d+(?=#|$)/, "$1");

  // Best-effort percent-decoding.
  try {
    s = decodeURI(s);
  } catch {
    /* keep raw */
  }

  // Windows backslashes -> forward slashes; drop trailing slashes.
  s = s.replace(/\\/g, "/").replace(/\/+$/, "");

  return s;
}

/**
 * True when two paths reference the same file after normalization.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function samePath(a, b) {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  return na !== "" && na === nb;
}

/**
 * Refresh ATF's cache query for document writes without decoding filenames.
 * Existing parameters are left untouched because changing a signed URL invalidates it.
 * @param {unknown} src
 * @param {number} [now]
 */
export function cacheBustPath(src, now = Date.now()) {
  if (typeof src !== "string" || !src.trim()) return "";
  const path = src.trim();
  const hash = path.indexOf("#");
  const base = (hash === -1 ? path : path.slice(0, hash)).replace(/\?\d+$/, "");
  const fragment = hash === -1 ? "" : path.slice(hash);
  return base.includes("?") ? path : `${base}?${now}${fragment}`;
}
