import { describe, expect, it } from "vitest";
import { authErrorMessage, authRedirectError } from "./auth-errors";

describe("auth error messages", () => {
  it("translates common Supabase auth failures", () => {
    expect(authErrorMessage({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe("El email o la contraseña no son correctos.");
    expect(authErrorMessage({ message: "Email not confirmed" })).toBe("Confirmá tu email antes de ingresar.");
    expect(authErrorMessage({ message: "Too many requests" })).toBe("Demasiados intentos. Esperá un momento y volvé a probar.");
    expect(authErrorMessage({ message: "Failed to fetch" })).toBe("No se pudo conectar con el servicio. Revisá tu conexión e intentá otra vez.");
  });

  it("uses a safe fallback for unknown provider errors", () => {
    expect(authErrorMessage({ message: "Internal provider detail" }, "No se pudo ingresar.")).toBe("No se pudo ingresar.");
  });

  it("explains auth redirect failures", () => {
    expect(authRedirectError("session_expired")).toBe("Tu sesión venció. Volvé a ingresar.");
    expect(authRedirectError("auth_callback")).toContain("confirmar el enlace");
    expect(authRedirectError(null)).toBe("");
  });
});
