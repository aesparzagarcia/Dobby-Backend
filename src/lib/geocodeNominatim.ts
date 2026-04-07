/**
 * Nominatim (OSM) geocoding with in-process cache. Respect usage policy: cache, identify User-Agent.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CacheEntry = { lat: number; lng: number; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export async function geocodeAddressNominatim(address: string, cacheKey: string): Promise<{ lat: number; lng: number } | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return { lat: hit.lat, lng: hit.lng };
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmed)}&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "EweBackend/1.0 (admin geocoding)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    const first = data?.[0];
    if (!first?.lat || !first?.lon) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    cache.set(cacheKey, { lat, lng, expiresAt: now + CACHE_TTL_MS });
    return { lat, lng };
  } catch {
    return null;
  }
}
