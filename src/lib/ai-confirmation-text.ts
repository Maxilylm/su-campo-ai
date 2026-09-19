/** Shared, client-safe recognition for the explicit review flow used by AI handoffs. */
export function isAIHandoffReviewPrompt(message: string): boolean {
  return /no guardes cambios en esta respuesta/i.test(message);
}

/** Lowercase, strip accents and punctuation so "¡Confirmá!" and "confirma" compare equal. */
function normalizeConfirmationText(message: string): string {
  return message
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CONFIRM_VERB = "(?:confirmo|confirma|confirmar|confirmado|aplica|aplicar|guarda|guardar|hacelo)";

/**
 * Consent to apply a signed proposal. The WHOLE message must be a confirmation
 * phrase: a sentence that merely contains "aplica" or "guardar" is a new
 * instruction, not a confirmation, and must never apply a pending proposal.
 */
const EXPLICIT_CONFIRMATION = new RegExp(
  `^(?:(?:si|dale|ok|okey|bueno) )?${CONFIRM_VERB}(?: (?:y )?${CONFIRM_VERB})?`
  + "(?: (?:los |estos |esos |la |esta |el )?(?:cambios|propuesta|registro|registros|todo))?$",
);

export function isExplicitAIConfirmation(message: string): boolean {
  return EXPLICIT_CONFIRMATION.test(normalizeConfirmationText(message));
}

/** A bare acknowledgement must not unlock a model-generated write without a
 * signed proposal, especially when the conversation crosses channels. */
export function isBareAIConfirmation(message: string): boolean {
  return /^(?:s[ií]|si|dale|ok(?:ey)?|confirmo|confirm[aá]|aplic[aá]|guard[aá]|hacelo|hac[eé]lo)(?:[,.\s]+(?:y\s+)?(?:aplic[aá]|guard[aá]|hacelo|hac[eé]lo|confirmo))?[.!\s]*$/i.test(message.trim());
}
