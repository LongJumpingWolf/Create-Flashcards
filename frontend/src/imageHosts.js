// Image hosts the site may download on the user's behalf (via /api/proxy-image) to embed pasted web images in a deck.
// ChatGPT's picture CDN sends no CORS headers, so the browser cannot read those images itself.
const HOSTS = ['images.openai.com', 'files.oaiusercontent.com', 'cdn.openai.com', 'upload.wikimedia.org'];
const SUFFIXES = ['.oaiusercontent.com', '.wikimedia.org', '.ncbi.nlm.nih.gov'];

export function isProxyableImageUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.port) return false;
    const host = u.hostname.toLowerCase();
    return HOSTS.includes(host) || SUFFIXES.some(suffix => host.endsWith(suffix));
  } catch {
    return false;
  }
}

/** A link that points at a picture (ChatGPT wraps its pictures in links to the CDN, with the title as text). */
export function isImageHref(href) {
  try {
    const u = new URL(href);
    if (u.protocol === 'https:' && HOSTS.includes(u.hostname.toLowerCase())) return true; // picture CDNs (not article pages on the suffix hosts)
  } catch { /* not a URL */ }
  return /^https?:\/\/[^\s?#]+\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(href || '');
}
