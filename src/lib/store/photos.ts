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

/** URL affichable d'une photo enregistrée (libérée automatiquement). */
export function usePhotoUrl(id: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !store) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    get<Blob>(id, store)
      .then((blob) => {
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
