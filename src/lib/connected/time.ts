/** Instant de la requête, calculé hors du rendu (les pages serveur sont rendues à chaque requête). */
export const isoFromNow = (deltaMs: number) => new Date(Date.now() + deltaMs).toISOString();
