import { fetchFeed } from "@/lib/connected/feed-fetch";

/**
 * Télécharge un calendrier iCal (Airbnb, Booking, Vrbo, PMS…) pour le navigateur (démo),
 * qui ne peut pas le faire lui-même (restrictions CORS des plateformes). Mêmes garde-fous que
 * la synchronisation de l'environnement connecté (un seul code de téléchargement).
 */
const STATUS: Record<string, number> = { invalid: 400, not_https: 400, forbidden_host: 400, unreachable: 502, too_large: 413, not_ical: 422, timeout: 504 };

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const raw = typeof body === "object" && body && "url" in body ? String((body as { url: unknown }).url ?? "") : "";
  const res = await fetchFeed(raw);
  if (!res.ok) return Response.json({ error: res.error, status: res.status }, { status: STATUS[res.error] ?? 502 });
  return new Response(res.text, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
}
