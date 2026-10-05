/** Erreur métier avec message destiné à l'utilisateur (en français, sans détail technique). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Ressource") => new AppError(404, "not_found", `${what} introuvable.`);
export const unauthorized = () => new AppError(401, "unauthorized", "Veuillez vous connecter.");
export const badRequest = (message: string, code = "bad_request") => new AppError(400, code, message);
