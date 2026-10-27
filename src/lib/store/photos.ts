"use client";

/**
 * Photos (mode démo) : stockées dans le navigateur (IndexedDB), jamais dans le stockage léger.
 * Phase 2 : même API, envoi vers Supabase Storage (bucket privé, URL signées).
 * Règles docs/07-photos.md : 1 600 px max, JPEG 0,8 ; la ré-encodage supprime les métadonnées EXIF.
 */
import { useEffect, useState } from "react";
import { createStore, del, get, set } from "idb-keyval";
import { newId } from "@/lib/domain/templates";

const store = typeof indexedDB !== "undefined" ? createStore("halo-photos", "photos") : undefined;
const MAX_SIDE = 1600;

export async function compressImage(file: Blob, maxSide = MAX_SIDE, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", quality),
  );
}

/** Compresse et enregistre une photo ; renvoie son identifiant. */
export async function savePhoto(file: Blob): Promise<string> {
  const blob = await compressImage(file);
  const id = newId("photo");
  if (store) await set(id, blob, store);
  return id;
}

export async function deletePhoto(id: string) {
  if (store) await del(id, store).catch(() => undefined);
}

const DEMO_PREFIX = "demophoto_";

/** Image générée pour les données de démonstration (clairement marquée « DÉMO »). */
async function demoPhoto(id: string): Promise<Blob | undefined> {
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 360;
  const ctx = canvas.getContext("2d")!;
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const g = ctx.createLinearGradient(0, 0, 480, 360);
  g.addColorStop(0, `hsl(${hue} 30% 82%)`);
  g.addColorStop(1, `hsl(${(hue + 40) % 360} 30% 68%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 480, 360);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.font = "700 44px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("DEMO", 240, 195);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), "image/jpeg", 0.8));
}

/** URL affichable d'une photo enregistrée (libérée automatiquement). */
export function usePhotoUrl(id: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !store) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    get<Blob>(id, store)
      .then(async (stored) => {
        let blob = stored;
        // Photos des données de démonstration : générées et enregistrées à la première lecture
        if (!blob && id.startsWith(DEMO_PREFIX)) {
          blob = await demoPhoto(id);
          if (blob && store) await set(id, blob, store).catch(() => undefined);
        }
        if (!blob || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return id ? url : null;
}
