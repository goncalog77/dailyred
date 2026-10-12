// Downloads the ROM and the emulator core once per visit and keeps them in
// memory, so starting a new run only has to restart the emulator.
//
// Repeat visits download almost nothing: the core files are pinned versions
// (see scripts/fetch-vendor.sh), so they live in the Cache API indefinitely,
// and the ROM URL comes from a tiny manifest that build-rom.sh rewrites on
// every build — a fresh manifest entry means a fresh ROM, the same entry
// means a cache hit. If the Cache API is unavailable everything still works,
// just with a download on every visit.
const MANIFEST_URL = 'game/manifest.json';

// Bump this when the pinned versions in scripts/fetch-vendor.sh change, so
// the core files are fetched again.
const CACHE_NAME = 'dailyred-vendor-v1';

let cached = null;

function cacheKey(url) {
  return new URL(url, location.href).href;
}

async function openCache() {
  try {
    return 'caches' in window ? await caches.open(CACHE_NAME) : null;
  } catch {
    return null;
  }
}

// Fetches url, serving it from the persistent cache when possible. Throws the
// same download error the site shows when the network fails.
async function cachedFetch(cache, url, fetchOptions) {
  if (cache) {
    try {
      const hit = await cache.match(cacheKey(url));
      if (hit) return hit;
    } catch {
      // Fall through to the network.
    }
  }
  const res = await fetch(url, fetchOptions);
  if (!res.ok) throw new Error(`Couldn't download ${url} (HTTP ${res.status}).`);
  if (cache) {
    try {
      await cache.put(cacheKey(url), res.clone());
    } catch {
      // The game still starts; it just downloads again next visit.
    }
  }
  return res;
}

// onProgress(loadedBytes, totalBytes) — totalBytes is 0 when unknown.
export function loadGameFiles(onProgress = () => {}) {
  cached ??= download(onProgress).catch((err) => {
    cached = null; // allow a retry
    throw err;
  });
  return cached;
}

async function download(onProgress) {
  const cache = await openCache();
  // Always revalidate the manifest (bytes, not megabytes): it names the
  // current ROM build, so a rebuild is picked up on the next visit.
  const manifestRes = await cachedFetch(null, MANIFEST_URL, { cache: 'no-store' });
  const { rom } = await manifestRes.json();
  if (typeof rom !== 'string' || !rom) throw new Error(`Couldn't download ${MANIFEST_URL} (bad manifest).`);
  const urls = { rom: `game/${rom}`, coreJs: 'vendor/mgba_libretro.js', coreWasm: 'vendor/mgba_libretro.wasm' };

  const responses = await Promise.all(Object.values(urls).map((url) => cachedFetch(cache, url)));

  // Content-Length is only meaningful when the host didn't re-encode the file.
  const sizes = responses.map((r) => (r.headers.get('Content-Encoding') ? 0 : Number(r.headers.get('Content-Length')) || 0));
  const total = sizes.every(Boolean) ? sizes.reduce((a, b) => a + b, 0) : 0;
  let loaded = 0;
  const report = (n) => { loaded += n; onProgress(loaded, total); };

  const [romGz, coreJs, coreWasm] = await Promise.all(responses.map((res) => readAll(res, report)));
  return {
    rom: await gunzip(romGz),
    coreJs: new Blob([coreJs], { type: 'text/javascript' }),
    coreWasm: new Blob([coreWasm], { type: 'application/wasm' }),
  };
}

async function readAll(res, report) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    report(value.length);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function gunzip(bytes) {
  // Some hosts send .gz files with Content-Encoding: gzip, in which case the
  // browser has already unpacked it.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
