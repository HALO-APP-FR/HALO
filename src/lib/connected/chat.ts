import "server-only";
/**
 * Messagerie interne : lecture via la session de la personne (la base ne renvoie que les conversations
 * dont elle est participante, ou toutes celles de l'organisation pour un responsable).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ThreadSummary {
  id: string;
  contextKind: "task" | "property" | "reservation";
  contextLabel: string;
  taskId: string | null;
  propertyId: string | null;
  reservationId: string | null;
  lastMessageAt: string;
  members: { id: string; name: string; lastReadAt: string | null }[];
  last: { body: string; authorId: string | null; urgent: boolean; at: string } | null;
  unread: boolean;
  mine: boolean;
}

type Row = Record<string, unknown>;
const one = <T,>(x: T | T[] | null) => (Array.isArray(x) ? x[0] : x);

/** Conversations non lues de la personne connectée (où elle participe et qu'un autre a écrites depuis sa dernière lecture). */
export async function unreadThreads(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return 0;
  const { data } = await supabase
    .from("team_thread_members")
    .select("last_read_at, team_threads(last_message_at)")
    .eq("organization_id", orgId)
    .eq("user_id", auth.user.id);
  return (data ?? []).filter((m: Row) => {
    const th = one(m.team_threads as Row | Row[] | null);
    return th && (!m.last_read_at || new Date(m.last_read_at as string) < new Date(th.last_message_at as string));
  }).length;
}

export async function loadThreads(supabase: SupabaseClient, orgId: string, userId: string, filter: { taskId?: string } = {}): Promise<ThreadSummary[]> {
  let q = supabase
    .from("team_threads")
    .select("id, context_kind, context_label, task_id, property_id, reservation_id, last_message_at, team_thread_members(user_id, last_read_at, memberships(profiles(full_name)))")
    .eq("organization_id", orgId)
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (filter.taskId) q = q.eq("task_id", filter.taskId);
  const { data: threads } = await q;
  const ids = (threads ?? []).map((t) => t.id as string);
  const { data: msgs } = ids.length
    ? await supabase.from("team_messages").select("thread_id, body, author_id, urgent, created_at").eq("organization_id", orgId).in("thread_id", ids).order("created_at", { ascending: false }).limit(500)
    : { data: [] as Row[] };
  return (threads ?? []).map((t) => {
    const members = ((t.team_thread_members ?? []) as Row[]).map((m) => ({
      id: m.user_id as string,
      name: (one((one(m.memberships as Row | Row[] | null)?.profiles ?? null) as Row | Row[] | null)?.full_name as string) ?? "",
      lastReadAt: (m.last_read_at as string) ?? null,
    }));
    const lastRow = (msgs ?? []).find((m) => m.thread_id === t.id) as Row | undefined;
    const me = members.find((m) => m.id === userId);
    return {
      id: t.id as string,
      contextKind: t.context_kind as ThreadSummary["contextKind"],
      contextLabel: t.context_label as string,
      taskId: (t.task_id as string) ?? null,
      propertyId: (t.property_id as string) ?? null,
      reservationId: (t.reservation_id as string) ?? null,
      lastMessageAt: t.last_message_at as string,
      members,
      last: lastRow ? { body: lastRow.body as string, authorId: (lastRow.author_id as string) ?? null, urgent: Boolean(lastRow.urgent), at: lastRow.created_at as string } : null,
      unread: Boolean(me && (!me.lastReadAt || new Date(me.lastReadAt) < new Date(t.last_message_at as string))),
      mine: Boolean(me),
    };
  });
}

export async function loadThreadMessages(supabase: SupabaseClient, orgId: string, threadId: string) {
  const { data } = await supabase
    .from("team_messages")
    .select("id, body, author_id, urgent, created_at")
    .eq("organization_id", orgId)
    .eq("thread_id", threadId)
    .order("created_at")
    .limit(500);
  return (data ?? []) as { id: string; body: string; author_id: string | null; urgent: boolean; created_at: string }[];
}
