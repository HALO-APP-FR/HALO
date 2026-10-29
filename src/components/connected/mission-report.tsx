"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Camera, Check, CircleAlert, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { agentTaskAction, beginTaskPhoto, requestCorrection, saveTaskReport, validateTask } from "@/lib/connected/actions";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { useRun } from "./use-run";

export interface ReportRoom {
  id: string;
  name: string;
  items: { id: string; label: string; photoRequired: boolean }[];
}
interface Photo {
  id: string;
  itemId: string | null;
  url: string;
}

/** Réduit la photo (bord long 1600 px, JPEG) pour un envoi rapide sur le terrain ; garde l'original si le navigateur ne sait pas la lire. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function MissionReport(props: {
  taskId: string;
  status: string;
  correctionReason: string | null;
  checklist: ReportRoom[];
  checked: string[];
  photos: Photo[];
  oldPhotos: Photo[];
  canEdit: boolean;
  canStart: boolean;
  canFinish: boolean;
  canReview: boolean;
  canReopen: boolean;
}) {
  const t = useTranslations("connected.mission");
  const te = useTranslations("connected.errors");
  const router = useRouter();
  const { pending, error, setError, run } = useRun();
  const [checked, setChecked] = useState<string[]>(props.checked);
  const [saving, startSave] = useTransition();
  const [uploading, setUploading] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // Points à refaire : par défaut, ceux qui exigent une photo (une nouvelle preuve sera exigée)
  const [redo, setRedo] = useState<string[]>(() => props.checklist.flatMap((r) => r.items).filter((i) => i.photoRequired).map((i) => i.id));
  const fileFor = useRef<{ itemId: string | null; roomId: string | null }>({ itemId: null, roomId: null });
  const input = useRef<HTMLInputElement>(null);

  const photosOf = (itemId: string | null) => props.photos.filter((p) => p.itemId === itemId);
  const missing = props.checklist.flatMap((r) => r.items).filter((i) => i.photoRequired && photosOf(i.id).length === 0);

  const toggle = (id: string) => {
    if (!props.canEdit) return;
    const next = checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id];
    const before = checked;
    setChecked(next);
    startSave(async () => {
      const res = await saveTaskReport(props.taskId, next);
      if (!res.ok) {
        setChecked(before); // jamais d'état « coché » qui ne serait pas enregistré
        setError(te.has(res.error) ? te(res.error) : te("server"));
      }
    });
  };

  const pick = (itemId: string | null, roomId: string | null) => {
    fileFor.current = { itemId, roomId };
    input.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const { itemId, roomId } = fileFor.current;
    setError(null);
    setUploading(itemId ?? "general");
    try {
      const blob = await shrink(file);
      const mime = blob.type || file.type;
      const res = await beginTaskPhoto(props.taskId, itemId, roomId, mime, blob.size);
      if (!res.ok) throw new Error(te.has(res.error) ? te(res.error) : te("server"));
      const { error: up } = await supabaseBrowser().storage.from("org-files").upload(res.data.path, blob, { contentType: mime, upsert: false });
      if (up) throw new Error(t("uploadFailed"));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : te("server"));
    } finally {
      setUploading(null);
      if (input.current) input.current.value = "";
    }
  };

  const photoButton = (itemId: string | null, roomId: string | null, testId: string) =>
    props.canEdit && (
      <Button size="sm" variant="outline" onClick={() => pick(itemId, roomId)} disabled={Boolean(uploading)} data-testid={testId}>
        {uploading === (itemId ?? "general") ? <Loader2 className="animate-spin" /> : <Camera />}
        {t("addPhoto")}
      </Button>
    );

  const thumbs = (list: Photo[]) =>
    list.length > 0 && (
      <div className="mt-2 flex flex-wrap gap-2">
        {list.map((p) => (
          // eslint-disable-next-line @next/next/no-img-element -- URL signée privée et temporaire
          <img key={p.id} src={p.url} alt={t("photoAlt")} className="size-20 rounded-md border border-line object-cover" data-testid="mission-photo" />
        ))}
      </div>
    );

  return (
    <div className="space-y-4">
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="photo-input" />
      {props.status === "to_redo" && props.correctionReason && (
        <p className="flex gap-2 rounded-xl border border-warning bg-warning-soft p-4 text-[15px]" role="status">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
          <span>
            <span className="block font-semibold">{t("correctionTitle")}</span>
            {props.correctionReason}
          </span>
        </p>
      )}

      {props.canStart && (
        <Button size="xl" onClick={() => run(() => agentTaskAction(props.taskId, "start"))} disabled={pending} data-testid="mission-start">
          {t("start")}
        </Button>
      )}

      {props.checklist.map((room) => (
        <Card key={room.id} className="p-4" data-testid="checklist-room">
          <h2 className="text-[17px] font-semibold">{room.name}</h2>
          <ul className="mt-2 divide-y divide-line">
            {room.items.map((item) => {
              const done = checked.includes(item.id);
              const list = photosOf(item.id);
              return (
                <li key={item.id} className="py-2.5" data-testid="checklist-item">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggle(item.id)}
                      disabled={!props.canEdit}
                      aria-pressed={done}
                      className="flex min-h-11 flex-1 items-center gap-3 text-start text-[15px] disabled:cursor-default"
                    >
                      <span className={cn("grid size-6 shrink-0 place-items-center rounded-md border", done ? "border-success bg-success text-white" : "border-line-strong")}>
                        {done && <Check className="size-4" />}
                      </span>
                      <span>
                        {item.label}
                        {item.photoRequired && (
                          <span className={cn("ms-2 text-[12px] font-medium", list.length ? "text-success" : "text-warning")}>
                            {list.length ? t("photoDone") : t("photoRequired")}
                          </span>
                        )}
                      </span>
                    </button>
                    {item.photoRequired && photoButton(item.id, room.id, "photo-add")}
                  </div>
                  {thumbs(list)}
                  {props.oldPhotos.some((p) => p.itemId === item.id) && (
                    <div className="mt-2" data-testid="old-photos">
                      <p className="text-[12px] text-muted">{t("oldProof")}</p>
                      <div className="mt-1 flex flex-wrap gap-2 opacity-60">
                        {props.oldPhotos
                          .filter((p) => p.itemId === item.id)
                          .map((p) => (
                            // eslint-disable-next-line @next/next/no-img-element -- URL signée privée et temporaire
                            <img key={p.id} src={p.url} alt={t("oldProof")} className="size-14 rounded-md border border-dashed border-line object-cover grayscale" />
                          ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}

      {(props.canEdit || photosOf(null).length > 0) && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[17px] font-semibold">{t("otherPhotos")}</h2>
            {photoButton(null, null, "photo-add-general")}
          </div>
          {thumbs(photosOf(null))}
          {photosOf(null).length === 0 && <p className="mt-1 text-[14px] text-muted">{t("otherPhotosHint")}</p>}
        </Card>
      )}

      {saving && <p className="text-[13px] text-muted">{t("saving")}</p>}
      {error && (
        <p role="alert" className="text-[14px] text-danger" data-testid="mission-error">
          {error}
        </p>
      )}

      {props.canFinish && (
        <div className="space-y-2">
          {missing.length > 0 && (
            <p className="text-[14px] text-warning" data-testid="missing-photos">
              {t("missing", { count: missing.length })}
            </p>
          )}
          <Button size="xl" onClick={() => run(() => agentTaskAction(props.taskId, "finish"))} disabled={pending || missing.length > 0 || Boolean(uploading)} data-testid="mission-finish">
            {t("finish")}
          </Button>
        </div>
      )}

      {props.canReview && (
        <Card className="space-y-3 p-4" data-testid="mission-review">
          <h2 className="text-[17px] font-semibold">{t("reviewTitle")}</h2>
          <Button onClick={() => run(() => validateTask(props.taskId))} disabled={pending} data-testid="mission-validate">
            {t("validate")}
          </Button>
        </Card>
      )}
      {props.canReopen && (
        <Card className="space-y-3 p-4">
          <Field label={t("correctionReason")} htmlFor="corr" hint={t("correctionHint")}>
            <Textarea id="corr" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} data-testid="correction-reason" />
          </Field>
          {props.checklist.length > 0 && (
            <fieldset className="space-y-1.5" data-testid="correction-items">
              <legend className="text-[13px] font-medium text-muted">{t("redoItems")}</legend>
              {props.checklist.flatMap((r) =>
                r.items.map((i) => (
                  <label key={i.id} className="flex items-center gap-2 text-[14px]">
                    <input type="checkbox" checked={redo.includes(i.id)} onChange={(e) => setRedo(e.target.checked ? [...redo, i.id] : redo.filter((x) => x !== i.id))} />
                    {r.name} — {i.label}
                    {i.photoRequired && <span className="text-[12px] text-muted">({t("newPhotoRequired")})</span>}
                  </label>
                )),
              )}
            </fieldset>
          )}
          <Button variant="outline" onClick={() => run(() => requestCorrection(props.taskId, reason, redo), () => setReason(""))} disabled={pending || !reason.trim()} data-testid="mission-correction">
            {t("requestCorrection")}
          </Button>
        </Card>
      )}
    </div>
  );
}
