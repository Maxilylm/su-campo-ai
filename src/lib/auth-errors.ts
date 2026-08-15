interface AuthErrorLike {
  code?: unknown;
  message?: unknown;
}

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error || "").toLowerCase();
  const candidate = error as AuthErrorLike;
  return `${String(candidate.code || "")} ${String(candidate.message || "")}`.toLowerCase();
}

/** Keep provider-specific auth errors out of the UI while preserving useful guidance. */
export function authErrorMessage(error: unknown, fallback = "No se pudo completar la operación."): string {
  const text = errorText(error);
  if (/invalid[_ ]login[_ ]credentials|invalid password|email or password/.test(text)) {
    return "El email o la contraseña no son correctos.";
  }
  if (/email[_ ]not[_ ]confirmed|email not confirmed/.test(text)) {
    return "Confirmá tu email antes de ingresar.";
  }
  if (/user[_ ]already[_ ]exists|already registered|already been registered/.test(text)) {
    return "Ya existe una cuenta con ese email. Ingresá o recuperá tu contraseña.";
  }
  if (/weak[_ ]password|password.*(?:at least|must contain|too short)/.test(text)) {
    return "La contraseña debe tener al menos 6 caracteres.";
  }
  if (/same[_ ]password|new password.*same/.test(text)) {
    return "Elegí una contraseña distinta a la anterior.";
  }
  if (/over[_ ]request[_ ]rate[_ ]limit|rate limit|too many requests/.test(text)) {
    return "Demasiados intentos. Esperá un momento y volvé a probar.";
  }
  if (/otp[_ ]expired|token.*expired|expired.*(?:link|token)|invalid.*(?:link|token)/.test(text)) {
    return "El enlace expiró o ya no es válido. Pedí uno nuevo.";
  }
  if (/email[_ ]address[_ ]invalid|invalid email/.test(text)) {
    return "Revisá el formato del email.";
  }
  if (/signup[_ ]disabled|signups? .*disabled/.test(text)) {
    return "El registro de nuevas cuentas está deshabilitado.";
  }
  if (/failed to fetch|network|timeout|aborterror|fetch failed/.test(text)) {
    return "No se pudo conectar con el servicio. Revisá tu conexión e intentá otra vez.";
  }
  return fallback;
}

export function authRedirectError(value: string | null): string {
  if (value === "session_expired") return "Tu sesión venció. Volvé a ingresar.";
  if (value === "auth_callback") return "No se pudo confirmar el enlace. Pedí uno nuevo e intentá otra vez.";
  return "";
}
