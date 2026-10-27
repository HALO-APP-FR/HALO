/**
 * Livret voyageur « autonome » : le contenu public du livret est compressé dans le lien
 * (après le #, jamais envoyé au serveur). Le QR code fonctionne ainsi sur n'importe quel
 * téléphone, même avant la base de données. Seules les infos choisies pour le voyageur y figurent.
 */
import type { GuestGuide, Property } from "@/lib/domain/types";

export interface GuidePayload {
  v: 1;
  name: string;
  address?: string;
  city?: string;
  tz: string;
  in: string;
  out: string;
  amenities: string[];
  custom: string[];
  guide: Omit<GuestGuide, "token" | "enabled">;
}

export function guidePayload(p: Property): GuidePayload {
  const { token: _token, enabled: _enabled, ...guide } = p.guide;
  void _token;
  void _enabled;
  return {
    v: 1,
    name: p.name,
    address: [p.addressLine, p.postalCode].filter(Boolean).join(", ") || undefined,
    city: p.city,
    tz: p.timezone,
    in: p.defaultCheckIn,
    out: p.defaultCheckOut,
    amenities: p.amenities,
    custom: p.customAmenities,
    guide,
  };
}

const toB64Url = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const out = source.pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeGuide(payload: GuidePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return toB64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decodeGuide(data: string): Promise<GuidePayload | null> {
  try {
    const json = new TextDecoder().decode(await pipe(fromB64Url(data), new DecompressionStream("deflate-raw")));
    const p = JSON.parse(json) as GuidePayload;
    return p && p.v === 1 && typeof p.name === "string" ? p : null;
  } catch {
    return null;
  }
}

/** Taille maximale confortable pour un QR code lisible (au-delà, on allège le livret). */
export const QR_MAX_CHARS = 1800;

/** Encode en retirant si besoin les textes les plus longs pour rester scannable. */
export async function encodeGuideForQr(p: Property): Promise<string> {
  const payload = guidePayload(p);
  let data = await encodeGuide(payload);
  const optional: (keyof GuidePayload["guide"])[] = ["recommendations", "houseRules", "welcome", "trash", "parking", "checkoutInstructions"];
  for (const k of optional) {
    if (data.length <= QR_MAX_CHARS) break;
    delete payload.guide[k];
    data = await encodeGuide(payload);
  }
  return data;
}
