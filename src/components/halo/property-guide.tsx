"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Copy, Download, ExternalLink, RefreshCw } from "lucide-react";
import type { GuestGuide, Property } from "@/lib/domain/types";
import { useHalo } from "@/lib/store/halo-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SwitchRow } from "@/components/ui/switch";

export function guideUrl(locale: string, token: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/${locale}/g/${token}`;
}

/** Affiche imprimable : QR code + nom du logement, au format PNG haute définition. */
async function downloadPoster(property: Property, url: string, title: string, subtitle: string) {
  const W = 1240;
  const H = 1754; // A5 portrait à ~210 dpi
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);
  // Logo HALO (deux arcs)
  const cx = W / 2;
  const logoY = 190;
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#0B0B0C";
  ctx.beginPath();
  ctx.arc(cx, logoY, 70, (110 * Math.PI) / 180, (250 * Math.PI) / 180);
  ctx.stroke();
  ctx.strokeStyle = "#0055FF";
  ctx.beginPath();
  ctx.arc(cx, logoY, 70, (-70 * Math.PI) / 180, (70 * Math.PI) / 180);
  ctx.stroke();
  ctx.fillStyle = "#0B0B0C";
  ctx.textAlign = "center";
  ctx.font = "700 76px Inter, system-ui, sans-serif";
  ctx.fillText(property.name, cx, 400, W - 160);
  ctx.fillStyle = "#6E6E73";
  ctx.font = "500 44px Inter, system-ui, sans-serif";
  ctx.fillText(title, cx, 480, W - 160);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 820, errorCorrectionLevel: "M", color: { dark: "#0B0B0C", light: "#FFFFFF" } });
  const img = new Image();
  await new Promise((resolve) => {
    img.onload = resolve;
    img.src = qr;
  });
  ctx.drawImage(img, (W - 820) / 2, 560, 820, 820);
  ctx.fillStyle = "#0B0B0C";
  ctx.font = "600 46px Inter, system-ui, sans-serif";
  ctx.fillText(subtitle, cx, 1500, W - 160);
  ctx.fillStyle = "#A1A1A6";
  ctx.font = "500 30px Inter, system-ui, sans-serif";
  ctx.fillText(url.replace(/^https?:\/\//, ""), cx, 1580, W - 160);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `halo-${property.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}-qr.png`;
  a.click();
}

export function PropertyGuide({ property }: { property: Property }) {
  const t = useTranslations();
  const locale = useLocale();
  const [draft, setDraft] = useState<GuestGuide>(property.guide);
  const [qr, setQr] = useState<string | null>(null);
  const url = guideUrl(locale, property.guide.token);
  const set = <K extends keyof GuestGuide>(k: K, v: GuestGuide[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const editable = (g: GuestGuide) => JSON.stringify({ ...g, token: "" });
  const dirty = editable(draft) !== editable(property.guide);

  useEffect(() => {
    let alive = true;
    QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0B0B0C", light: "#00000000" } })
      .then((svg) => alive && setQr(svg))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [url]);

  const field = (key: keyof GuestGuide, multiline = false, hint?: string) => (
    <Field label={t(`guide.${key}`)} htmlFor={`g-${key}`} hint={hint}>
      {multiline ? (
        <Textarea id={`g-${key}`} value={(draft[key] as string) ?? ""} onChange={(e) => set(key, e.target.value)} className="min-h-20" />
      ) : (
        <Input id={`g-${key}`} value={(draft[key] as string) ?? ""} onChange={(e) => set(key, e.target.value)} />
      )}
    </Field>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("guide.title")}</CardTitle>
            <p className="mt-1 text-caption text-muted">{t("guide.intro")}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SwitchRow id="g-enabled" label={t("guide.enabled")} description={t("guide.enabledHint")} checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} />
          {field("welcome", true, t("guide.welcomeHint"))}
          <div className="grid gap-3 sm:grid-cols-2">
            {field("wifiName")}
            {field("wifiPassword")}
          </div>
          {field("accessInfo", true, t("guide.accessInfoHint"))}
          {field("houseRules", true)}
          {field("checkoutInstructions", true)}
          <div className="grid gap-3 sm:grid-cols-2">
            {field("parking", true)}
            {field("trash", true)}
          </div>
          {field("emergencyPhone")}
          {field("recommendations", true, t("guide.recommendationsHint"))}
          {dirty && (
            <div className="sticky bottom-20 z-10 flex justify-end gap-2 rounded-lg border border-line bg-surface/95 p-3 shadow-float backdrop-blur md:bottom-4">
              <Button variant="ghost" onClick={() => setDraft(property.guide)}>
                {t("form.cancel")}
              </Button>
              <Button
                onClick={() => {
                  useHalo.getState().updateProperty(property.id, { guide: { ...draft, token: property.guide.token } });
                  toast(t("form.saved"));
                }}
              >
                {t("form.save")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{t("guide.share")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="mx-auto aspect-square w-full max-w-[240px] rounded-lg bg-white p-4 ring-1 ring-line">
            {qr ? <div className="size-full [&_svg]:size-full" role="img" aria-label={t("guide.qrAlt")} dangerouslySetInnerHTML={{ __html: qr }} /> : null}
          </div>
          <div className="flex gap-2">
            <Input readOnly value={url} aria-label={t("guide.link")} className="text-[13px]" onFocus={(e) => e.target.select()} />
            <Button
              variant="secondary"
              size="icon"
              className="size-10 shrink-0"
              aria-label={t("guide.copy")}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  toast(t("guide.copied"));
                } catch {
                  toast(t("guide.copyFailed"));
                }
              }}
            >
              <Copy />
            </Button>
          </div>
          <div className="grid gap-2">
            <Button variant="secondary" onClick={() => void downloadPoster(property, url, t("guide.posterTitle"), t("guide.posterScan"))}>
              <Download />
              {t("guide.downloadPoster")}
            </Button>
            <Button asChild variant="outline">
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink />
                {t("guide.preview")}
              </a>
            </Button>
            <Button
              variant="ghost"
              className="text-muted"
              onClick={() => {
                useHalo.getState().regenerateGuideToken(property.id);
                toast(t("guide.regenerated"));
              }}
            >
              <RefreshCw />
              {t("guide.regenerate")}
            </Button>
          </div>
          <p className="rounded-lg bg-warning-soft p-3 text-caption text-fg">{t("guide.demoNotice")}</p>
          <p className="text-caption text-muted">{t("guide.securityNotice")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
