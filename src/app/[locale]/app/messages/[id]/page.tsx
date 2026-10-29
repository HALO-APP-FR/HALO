import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { ChatThread } from "@/components/connected/chat";
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
  return (
    <>
      <Link href="/app/messages" className="mb-3 inline-block text-[14px] text-accent-text hover:underline">
        ← {t("back")}
      </Link>
      <PageHeader title={`${t(`contextKind.${th.contextKind}`)} · ${th.contextLabel}`} subtitle={th.members.map((m) => m.name || t("noName")).join(", ")} />
      {ctxHref && (
        <Link href={ctxHref} className="-mt-2 mb-4 inline-block text-[14px] text-accent-text hover:underline" data-testid="chat-context-link">
          {t(`open.${th.contextKind}`)}
        </Link>
      )}
      <Card className="max-w-3xl p-5">
        <ChatThread threadId={th.id} messages={messages} meId={user!.id} canWrite={th.mine || manager} />
      </Card>
    </>
  );
}
