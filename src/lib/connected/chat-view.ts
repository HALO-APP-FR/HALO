import type { ChatMessage } from "@/components/connected/chat";
import type { ThreadSummary } from "./chat";

/** État de lecture message par message, à partir de la dernière lecture de chaque participant. */
export function toChatMessages(th: ThreadSummary, rows: { id: string; body: string; author_id: string | null; urgent: boolean; created_at: string }[], meId: string): ChatMessage[] {
  const me = th.members.find((m) => m.id === meId);
  return rows.map((r) => {
    const others = th.members.filter((m) => m.id !== r.author_id);
    const at = new Date(r.created_at).getTime();
    return {
      id: r.id,
      body: r.body,
      authorId: r.author_id,
      authorName: th.members.find((m) => m.id === r.author_id)?.name ?? "",
      urgent: r.urgent,
      at: r.created_at,
      readTotal: others.length,
      readBy: others.filter((m) => m.lastReadAt && new Date(m.lastReadAt).getTime() >= at).length,
      isNew: r.author_id !== meId && Boolean(me) && (!me!.lastReadAt || new Date(me!.lastReadAt).getTime() < at),
    };
  });
}
