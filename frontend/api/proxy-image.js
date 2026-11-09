/* global Buffer */
// Downloads one image for the deck exporter. Only known image hosts, images only, max 8 MB.
import { isProxyableImageUrl } from '../src/imageHosts.js';

const MAX_BYTES = 8 * 1024 * 1024;

async function fetchChecked(url, hops = 0) {
  const upstream = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (AnkiStudio image fetch)', accept: 'image/*' }, signal: AbortSignal.timeout(15000) });
  if (upstream.status >= 300 && upstream.status < 400 && hops < 2) {
    const next = new URL(upstream.headers.get('location') || '', url).toString();
    if (!isProxyableImageUrl(next)) throw new Error('redirect to a host that is not allowed');
    return fetchChecked(next, hops + 1);
  }
  return upstream;
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost').searchParams.get('url') || '';
  if (!isProxyableImageUrl(url)) { res.statusCode = 400; res.end('This image host is not supported.'); return; }
  try {
    const upstream = await fetchChecked(url);
    const type = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !type.startsWith('image/')) { res.statusCode = 502; res.end('Not an image.'); return; }
    if (Number(upstream.headers.get('content-length') || 0) > MAX_BYTES) { res.statusCode = 413; res.end('Image too large.'); return; }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length > MAX_BYTES) { res.statusCode = 413; res.end('Image too large.'); return; }
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'public, max-age=86400');
    res.statusCode = 200;
    res.end(bytes);
  } catch {
    res.statusCode = 502;
    res.end('Could not download the image.');
  }
}
