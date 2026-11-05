import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { ChatThread } from "@/components/connected/chat";
import { Avatar } from "@/components/connected/avatar";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { loadThreadMessages, loadThreads } from "@/lib/connected/chat";
import { toChatMessages } from "@/lib/connected/chat-view";

export default async function ThreadPage({ params }: PageProps<"/[locale]/app/messages/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.chat");
  const { supabase, org, user } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  // La base ne renvoie la conversation qu'à ses participants et aux responsables de l'organisation
  const th = (await loadThreads(supabase, org!.id, user!.id)).find((x) => x.id === id);
  if (!th) notFound();
  const messages = toChatMessages(th, await loadThreadMessages(supabase, org!.id, id), user!.id);
  const manager = isManagerRole(org!.role);
  const ctxHref = th.taskId ? `/app/missions/${th.taskId}` : th.reservationId && manager ? `/app/stays/${th.reservationId}` : th.propertyId && manager ? `/app/properties/${th.propertyId}` : null;
  const others = th.members.filter((m) => m.id !== user!.id);
  const names = others.map((m) => m.name || t("noName")).join(", ") || t("noName");
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/app/messages" className="mb-4 inline-flex items-center gap-1 text-[14px] text-accent-text hover:underline">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>
      <div className="mb-4 flex items-center gap-3" data-testid="chat-header">
        <Avatar name={others[0]?.name ?? ""} id={others[0]?.id ?? th.id} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-title-2 truncate">{names}</h1>
          {/* Fiche de la personne : accessible au responsable */}
          {manager && others.length > 0 && (
            <p className="flex flex-wrap gap-x-3 text-[14px]">
              {others.map((m) => (
                <Link key={m.id} href={`/app/team/${m.id}`} className="text-accent-text hover:underline" data-testid="chat-member-link">
                  {others.length > 1 ? t("profileOf", { name: m.name || t("noName") }) : t("profile")}
                </Link>
              ))}
            </p>
          )}
        </div>
      </div>
      {/* Contexte explicite : la conversation concerne toujours une mission, un logement ou un séjour */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-[14px]">
        <span className="text-muted">{t(`contextKind.${th.contextKind}`)}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{th.contextLabel}</span>
        {ctxHref && (
          <Link href={ctxHref} className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline" data-testid="chat-context-link">
            {t(`open.${th.contextKind}`)}
            <ArrowRight className="size-4 rtl:-scale-x-100" />
          </Link>
        )}
      </div>
      <Card className="px-4 pt-4 md:px-5 md:pt-5">
        <ChatThread threadId={th.id} messages={messages} meId={user!.id} canWrite={th.mine || manager} sticky showAuthors={others.length > 1 || !th.mine} />
      </Card>
      <p className="mt-2 px-1 text-[13px] text-muted" data-testid="chat-privacy">{t(manager && !th.mine ? "privacyReader" : "privacy")}</p>
    </div>
  );
}
