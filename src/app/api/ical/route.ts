import { checkFeedUrl } from "@/lib/engine/feed-url";

/**
 * Télécharge un calendrier iCal (Airbnb, Booking, Vrbo, PMS…) pour le navigateur,
 * qui ne peut pas le faire lui-même (restrictions CORS des plateformes).
 * Garde-fous : HTTPS uniquement, pas d'adresse interne, 15 s maximum, 2 Mo maximum,
 * redirections vérifiées une par une.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const raw = typeof body === "object" && body && "url" in body ? String((body as { url: unknown }).url ?? "") : "";
  let check = checkFeedUrl(raw);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(check.url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "HALO-Calendar-Sync/1.0 (+https://halo-halo-65a7.vercel.app)", Accept: "text/calendar, */*" },
        cache: "no-store",
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        check = checkFeedUrl(new URL(res.headers.get("location")!, check.url).toString());
        if (!check.ok) return Response.json({ error: check.error }, { status: 400 });
        continue;
      }
      break;
    }
    if (!res || !res.ok) return Response.json({ error: "unreachable", status: res?.status }, { status: 502 });

    const reader = res.body?.getReader();
    if (!reader) return Response.json({ error: "unreachable" }, { status: 502 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        controller.abort();
        return Response.json({ error: "too_large" }, { status: 413 });
      }
      chunks.push(value);
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    if (!/BEGIN:VCALENDAR/i.test(text)) return Response.json({ error: "not_ical" }, { status: 422 });
    return new Response(text, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: controller.signal.aborted ? "timeout" : "unreachable" }, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}
