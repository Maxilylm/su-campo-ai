/** Shared, client-safe recognition for the explicit review flow used by AI handoffs. */
export function isAIHandoffReviewPrompt(message: string): boolean {
  return /no guardes cambios en esta respuesta/i.test(message);
}

export function isExplicitAIConfirmation(message: string): boolean {
  return /\b(confirmo|confirmar|confirmá|confirma|aplicá|aplica|guardá|guarda|guardar)\b/i.test(message)
    && !/\b(no|nunca|todav[ií]a no|cancel|cancela|anul)/i.test(message);
}

/** A bare acknowledgement must not unlock a model-generated write without a
 * signed proposal, especially when the conversation crosses channels. */
export function isBareAIConfirmation(message: string): boolean {
  return /^(?:s[ií]|si|dale|ok(?:ey)?|confirmo|confirm[aá]|aplic[aá]|guard[aá]|hacelo|hac[eé]lo)(?:[,.\s]+(?:y\s+)?(?:aplic[aá]|guard[aá]|hacelo|hac[eé]lo|confirmo))?[.!\s]*$/i.test(message.trim());
}
