/**
 * Validation d'une adresse de calendrier iCal avant de la télécharger côté serveur.
 * Empêche d'utiliser le serveur HALO pour interroger des adresses internes.
 */
export type FeedUrlError = "invalid" | "not_https" | "forbidden_host";

const PRIVATE_HOST = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^\d{1,3}(\.\d{1,3}){3}$/, // adresse IPv4 brute
  /^\[.*\]$/, // adresse IPv6 brute
];

export function checkFeedUrl(raw: string): { ok: true; url: URL } | { ok: false; error: FeedUrlError } {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcal:\/\//i, "https://"));
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "not_https" };
  if (url.username || url.password || (url.port && url.port !== "443")) return { ok: false, error: "forbidden_host" };
  if (PRIVATE_HOST.some((re) => re.test(url.hostname)) || !url.hostname.includes(".")) {
    return { ok: false, error: "forbidden_host" };
  }
  return { ok: true, url };
}
