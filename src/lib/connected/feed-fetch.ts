import "server-only";
import { checkFeedUrl } from "@/lib/engine/feed-url";

/**
 * Téléchargement d'un calendrier iCal côté serveur (les plateformes bloquent le navigateur) :
 * HTTPS uniquement, aucune adresse interne, 15 s et 2 Mo maximum, redirections vérifiées une par une.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
export type FeedError = "invalid" | "not_https" | "forbidden_host" | "unreachable" | "too_large" | "not_ical" | "timeout";

export async function fetchFeed(raw: string): Promise<{ ok: true; text: string } | { ok: false; error: FeedError; status?: number }> {
  // Préproduction locale uniquement : calendrier de test servi sur 127.0.0.1 (jamais actif en ligne)
  if (process.env.HALO_TEST_FEEDS === "1" && process.env.NEXT_PUBLIC_HALO_ENV === "preprod-local" && /^http:\/\/127\.0\.0\.1:\d+\//.test(raw)) {
    const res = await fetch(raw, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return { ok: false, error: "unreachable", status: res?.status };
    const text = await res.text();
    return /BEGIN:VCALENDAR/i.test(text) ? { ok: true, text } : { ok: false, error: "not_ical" };
  }
  let check = checkFeedUrl(raw);
  if (!check.ok) return { ok: false, error: check.error };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(check.url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "HALO-Calendar-Sync/1.0", Accept: "text/calendar, */*" },
        cache: "no-store",
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        check = checkFeedUrl(new URL(res.headers.get("location")!, check.url).toString());
        if (!check.ok) return { ok: false, error: check.error };
        continue;
      }
      break;
    }
    if (!res || !res.ok) return { ok: false, error: "unreachable", status: res?.status };
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, error: "unreachable" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        controller.abort();
        return { ok: false, error: "too_large" };
      }
      chunks.push(value);
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, error: "not_ical" };
    return { ok: true, text };
  } catch {
    return { ok: false, error: controller.signal.aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
