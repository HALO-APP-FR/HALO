/** Délai avant de reposer la question après « Oui, je continue » (rappel suivant), en minutes. */
export const REASK_MIN = 30;

/**
 * Heure (ms) à laquelle le rappel « durée estimée atteinte » doit (re)paraître pour une mission en cours,
 * ou null si la mission n'a pas de durée estimée. Base : démarrage RÉEL + durée estimée ; après « je continue »,
 * la question revient REASK_MIN minutes plus tard. Le temps de la mission n'est jamais arrêté.
 */
export function overrunDueAt(startedAt: string, durationMin: number, ackAt: string | null): number | null {
  if (!durationMin || durationMin <= 0) return null;
  const due = Date.parse(startedAt) + durationMin * 60_000;
  const ack = ackAt ? Date.parse(ackAt) : null;
  return ack !== null && ack >= due ? ack + REASK_MIN * 60_000 : due;
}

/**
 * Alerte du responsable : sans réponse de l'agent `alertMin` minutes après la fin estimée
 * (une réponse « je continue » repousse l'alerte du même délai à partir de la réponse).
 */
export function overrunAlert(startedAt: string, durationMin: number, ackAt: string | null, alertMin: number, now: number): boolean {
  if (!durationMin || durationMin <= 0) return false;
  const due = Date.parse(startedAt) + durationMin * 60_000;
  const ack = ackAt ? Date.parse(ackAt) : null;
  const ref = ack !== null && ack >= due ? ack : due;
  return now > ref + alertMin * 60_000;
}
