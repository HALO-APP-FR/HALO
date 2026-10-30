import { getTranslations } from "next-intl/server";
import { Compass } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LogoMark } from "@/components/halo/logo";

/**
 * Page introuvable, dans la langue de l'utilisateur. Volontairement identique qu'une ressource
 * n'existe pas ou qu'elle appartienne à une autre organisation : rien ne permet de deviner son existence.
 */
export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <div className="grid min-h-dvh place-items-center bg-subtle px-4">
      <div className="max-w-md rounded-xl border border-line bg-canvas p-6 text-center" data-testid="not-found">
        <LogoMark className="mx-auto size-12 text-fg" />
        <h1 className="mt-5 text-title-2">{t("title")}</h1>
        <p className="mt-2 text-[15px] text-muted">{t("text")}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/app" className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-[14px] font-medium text-on-accent">
            <Compass className="size-4" />
            {t("home")}
          </Link>
          <Link href="/" className="inline-flex h-10 items-center rounded-md border border-line px-4 text-[14px] font-medium">
            {t("site")}
          </Link>
        </div>
      </div>
    </div>
  );
}
