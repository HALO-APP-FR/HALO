import "server-only";
import nodemailer from "nodemailer";
import { getTranslations } from "next-intl/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { locales, type Locale } from "@/i18n/routing";
import { pushForOutbox } from "./push";

/** Service d'envoi : SMTP_URL complète, ou bien hôte + identifiant + mot de passe séparés (plus simples à saisir). */
function smtpTransport() {
  if (process.env.SMTP_URL) return nodemailer.createTransport(process.env.SMTP_URL);
  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass } = process.env;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

/** Un service d'envoi d'e-mails est-il réellement configuré ? (affiché tel quel dans les préférences) */
export const emailConfigured = () => Boolean(process.env.SMTP_URL || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));

/** Adresse publique de l'application (liens dans les e-mails de l'équipe). */
const appUrl = () =>
  process.env.APP_URL ?? (process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

export interface OutboxRow {
  id: string;
  recipient: string;
  locale: string;
  template: string;
  payload: Record<string, unknown>;
  organization_id: string;
}

/**
 * Envoie les e-mails en attente. L'état enregistré est TOUJOURS le résultat réel :
 *  - « sent » seulement si le serveur d'envoi a accepté le message ;
 *  - « not_configured » si aucun service d'envoi n'est configuré (rien n'est simulé) ;
 *  - « failed » avec l'erreur, relançable par un responsable.
 */
/** E-mails portant un lien personnel : le lien n'existe que dans l'e-mail et quitte le journal après l'envoi. */
const LINK_TEMPLATES = new Set(["prep_invite", "booking_link", "review_request"]);

export async function processOutbox(orgId?: string) {
  const admin = supabaseAdmin();
  if (!admin) return { processed: 0, reason: "no_admin_key" as const };
  // Réservation atomique (migration 18) : deux traitements simultanés n'envoient jamais le même e-mail
  const { data: rows, error: claimErr } = await admin.rpc("outbox_claim", { org: orgId ?? null, n: 20 });
  if (claimErr) return { processed: 0, reason: "claim_failed" as const };
  if (!rows?.length) return { processed: 0 };
  const transport = smtpTransport();
  const orgNames = new Map<string, string>();
  // Invitation : le lien personnel est retiré du journal dès que l'envoi est terminé (réussi ou non)
  const finish = (row: OutboxRow, patch: Record<string, unknown>) => {
    if (LINK_TEMPLATES.has(row.template)) {
      const { url: _url, ...rest } = row.payload as Record<string, unknown>;
      void _url;
      patch = { ...patch, payload: rest };
    }
    return admin.from("notification_outbox").update(patch).eq("id", row.id);
  };
  for (const row of rows as OutboxRow[]) {
    if (LINK_TEMPLATES.has(row.template) && typeof row.payload.url !== "string") {
      // Relance d'une invitation déjà traitée : le lien n'est plus connu, il faut en envoyer une nouvelle
      await finish(row, { status: "failed", last_error: "link_not_kept_send_new_invite" });
      continue;
    }
    // Push (migration 28) : avant l'e-mail, indépendant de lui ; uniquement vers les appareils que la personne a
    // elle-même inscrits, une seule fois par notification. Résultat réel journalisé dans push_deliveries.
    let emailWanted = true;
    try {
      emailWanted = (await pushForOutbox(admin, row, appUrl())).email;
    } catch (e) {
      // un échec push n'empêche jamais l'e-mail ; il est journalisé
      console.error("push", row.template, e instanceof Error ? e.message : e);
    }
    if (!emailWanted) {
      await finish(row, { status: "skipped", last_error: "email_off_by_user" });
      continue;
    }
    // Adresse fictive (comptes de test) : jamais envoyée, jamais comptée « envoyée »
    if (/\.invalid$/i.test(row.recipient)) {
      await finish(row, { status: "failed", last_error: "undeliverable_test_address" });
      continue;
    }
    if (!transport) {
      await finish(row, { status: "not_configured", last_error: "no_email_provider" });
      continue;
    }
    try {
      if (!orgNames.has(row.organization_id)) {
        const { data } = await admin.from("organizations").select("name").eq("id", row.organization_id).maybeSingle();
        orgNames.set(row.organization_id, (data?.name as string) ?? "HALO");
      }
      const locale = (locales as readonly string[]).includes(row.locale) ? (row.locale as Locale) : "en";
      const t = await getTranslations({ locale, namespace: "email" });
      // Missions : type de mission ; prestations : type de prestation
      const taskTpl = row.template === "team_task_to_validate" || row.template.startsWith("agent_");
      const kind = typeof row.payload.kind === "string" ? (await getTranslations({ locale, namespace: taskTpl ? "taskType" : "serviceKind" }))(row.payload.kind) : "";
      const message = typeof row.payload.message === "string" ? row.payload.message : "";
      const org = orgNames.get(row.organization_id)!;
      const str = (k: string) => (typeof row.payload[k] === "string" ? (row.payload[k] as string) : "");
      const decision = str("decision") === "accepted" || str("decision") === "refused" ? t(`decisions.${str("decision")}`) : "";
      // E-mails d'horaire : l'heure applicable au moment de la décision, dans le fuseau du logement
      const time = str("stay_at")
        ? new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: str("tz") || "UTC" }).format(new Date(str("stay_at")))
        : "";
      const params = { org, kind, decision, time, which: str("kind") || "other", choice: str("decision") || "other", property: str("property") || "—", guest: str("guest") || "—", member: str("member") || "—" };
      // Invitation à préparer le séjour : le lien personnel n'existe que dans cet e-mail (jamais stocké en clair)
      const guestUrl = LINK_TEMPLATES.has(row.template) && /^https?:\/\/\S+\/(s|b|avis)\/[0-9a-f]{64}$/.test(str("url")) ? str("url") : "";
      // E-mails internes (équipe, agent, messagerie) : lien vers HALO et pied de page interne
      const team = /^(team_|agent_|chat_)/.test(row.template);
      const base = appUrl();
      const link = team && str("path") && base ? `${base}/${locale}${str("path")}` : "";
      const subject = t(`${row.template}.subject`, params);
      const text = [
        t(`${row.template}.body`, params),
        message ? `\n« ${message} »` : "",
        link ? `\n${t("open")} : ${link}` : "",
        guestUrl ? `\n${guestUrl}` : "",
        `\n${team ? t("teamFooter") : t.has(`${row.template}.footer`) ? t(`${row.template}.footer`) : t("footer")}`,
      ].join("\n");
      await transport.sendMail({ from: process.env.EMAIL_FROM ?? "HALO <no-reply@halo.app>", to: row.recipient, subject, text });
      await finish(row, { status: "sent", sent_at: new Date().toISOString(), last_error: null });
    } catch (e) {
      const { data } = await admin.from("notification_outbox").select("attempts").eq("id", row.id).maybeSingle();
      await finish(row, { status: "failed", attempts: ((data?.attempts as number) ?? 0) + 1, last_error: String(e instanceof Error ? e.message : e).slice(0, 300) });
    }
  }
  return { processed: rows.length };
}
