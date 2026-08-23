# CampoAI — Plantillas de email de autenticación

Pegar en **Supabase Dashboard → Authentication → Email Templates**
(https://supabase.com/dashboard/project/fdceixfggdpjoydqyvss/auth/templates)

Cada sección tiene **Subject** (campo "Subject heading") y **Body** (campo "Message body", pestaña `<> Source`).

⚠️ **Aplicar recién cuando la página `/auth/confirm` esté en producción** (aviso al confirmarlo) — los enlaces apuntan ahí.

---

## 1. Confirm sign up

**Subject:**
```
Confirmá tu cuenta de CampoAI 🌱
```

**Body:**
```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f5;padding:32px 0;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
      <tr>
        <td style="background-color:#047857;padding:24px 32px;">
          <span style="font-size:22px;font-weight:700;color:#ffffff;">Campo<span style="color:#a7f3d0;">AI</span></span>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#111827;">Confirmá tu cuenta</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
            ¡Bienvenido a CampoAI! Hacé clic en el botón para activar tu cuenta
            y empezar a gestionar tu campo: hacienda, cultivos, inventario y finanzas en un solo lugar.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background-color:#047857;border-radius:10px;">
              <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email"
                 style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Confirmar mi cuenta
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">
            Si el botón no funciona, copiá y pegá este enlace en tu navegador:
          </p>
          <p style="margin:0 0 24px;font-size:12px;line-height:1.5;word-break:break-all;">
            <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email" style="color:#047857;">{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email</a>
          </p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
            El enlace vence en 24 horas. Si no creaste una cuenta en CampoAI, ignorá este email — no se hará ningún cambio.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">CampoAI — Gestión agropecuaria inteligente · <a href="{{ .SiteURL }}" style="color:#047857;">su-campo-ai.vercel.app</a></p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
```

---

## 2. Magic Link

**Subject:**
```
Tu enlace para entrar a CampoAI
```

**Body:**
```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f5;padding:32px 0;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
      <tr>
        <td style="background-color:#047857;padding:24px 32px;">
          <span style="font-size:22px;font-weight:700;color:#ffffff;">Campo<span style="color:#a7f3d0;">AI</span></span>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#111827;">Entrá a tu cuenta</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
            Pediste un enlace para entrar a CampoAI sin contraseña. Hacé clic en el botón para iniciar sesión.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background-color:#047857;border-radius:10px;">
              <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email"
                 style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Entrar a CampoAI
              </a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
            El enlace vence en 1 hora y solo funciona una vez. Si no lo pediste, ignorá este email.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">CampoAI — Gestión agropecuaria inteligente · <a href="{{ .SiteURL }}" style="color:#047857;">su-campo-ai.vercel.app</a></p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
```

---

## 3. Reset Password

**Subject:**
```
Restablecé tu contraseña de CampoAI
```

**Body:**
```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f5;padding:32px 0;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
      <tr>
        <td style="background-color:#047857;padding:24px 32px;">
          <span style="font-size:22px;font-weight:700;color:#ffffff;">Campo<span style="color:#a7f3d0;">AI</span></span>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#111827;">Restablecé tu contraseña</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
            Recibimos un pedido para cambiar la contraseña de <strong>{{ .Email }}</strong>.
            Hacé clic en el botón para elegir una nueva.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background-color:#047857;border-radius:10px;">
              <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery"
                 style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Elegir nueva contraseña
              </a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
            El enlace vence en 1 hora. Si no pediste este cambio, ignorá este email — tu contraseña actual sigue vigente.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">CampoAI — Gestión agropecuaria inteligente · <a href="{{ .SiteURL }}" style="color:#047857;">su-campo-ai.vercel.app</a></p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
```

---

## Notas

- **Por qué `{{ .TokenHash }}` y no `{{ .ConfirmationURL }}`**: el enlace por defecto se consume con el primer GET — los escáneres de Gmail lo "clickean" antes que vos (el error `otp_expired` que viste). Estos enlaces llevan a una página de CampoAI que solo verifica cuando tocás el botón.
- **Límite del mailer gratuito de Supabase**: ~2-4 emails por hora. No hagas muchas pruebas seguidas; para volumen real conviene configurar SMTP propio (tenés credenciales de Brevo en el .env — lo configuro si querés).
- La plantilla de **Magic Link** solo se usa si algún día activás login sin contraseña; no molesta tenerla lista.
- Colores del botón: `#047857` con texto blanco = contraste AA 5.48:1, igual que la app.
