import { NextResponse, type NextRequest } from "next/server";
import { request } from "node:https";
import { timingSafeEqual } from "node:crypto";

/** Diagnostic temporaire (préproduction, jeton requis) : quelles requêtes Overpass sont acceptées depuis l'hébergement. */
export const maxDuration = 60;
const q = '[out:json][timeout:10];node(around:300,48.8606,2.3376)["amenity"="cafe"]["name"];out 5;';

function raw(host: string, path: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve) => {
    const r = request({ host, path, method: "GET", headers, timeout: 15000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(`${res.statusCode} ${body.slice(0, 120).replace(/\s+/g, " ")}`));
    });
    r.on("timeout", () => (r.destroy(), resolve("timeout")));
    r.on("error", (e) => resolve(`error ${e.message}`));
    r.end();
  });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const want = process.env.SELFTEST_TOKEN ?? "";
  if (process.env.VERCEL_ENV === "production" || !want || token.length !== want.length || !timingSafeEqual(Buffer.from(token), Buffer.from(want))) return new NextResponse(null, { status: 404 });
  const path = `/api/interpreter?data=${encodeURIComponent(q)}`;
  const ua = "HALO/1.0 (+https://halo-git-feat-operations-halo-65a7.vercel.app)";
  const out: Record<string, string> = {};
  out.raw_ua_only = await raw("overpass-api.de", path, { "User-Agent": ua });
  out.raw_no_ua = await raw("overpass-api.de", path, {});
  out.raw_browser_ua = await raw("overpass-api.de", path, { "User-Agent": "Mozilla/5.0", Accept: "*/*" });
  out.status = await raw("overpass-api.de", "/api/status", { "User-Agent": ua });
  try {
    const r = await fetch(`https://overpass-api.de${path}`, { headers: { "User-Agent": ua } });
    out.fetch = `${r.status} ${(await r.text()).slice(0, 120)}`;
  } catch (e) {
    out.fetch = String(e);
  }
  out.kumi = await raw("overpass.kumi.systems", path, { "User-Agent": ua });
  out.private_coffee = await raw("overpass.private.coffee", path, { "User-Agent": ua });
  return NextResponse.json(out);
}
