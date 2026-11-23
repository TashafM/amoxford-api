// Password reset email: HTML (table layout + inline styles, which is what Gmail, Outlook
// and phone mail apps render reliably) plus a plain-text version for clients without HTML.

const BRAND = "#8C4AF2";
const BRAND_DARK = "#6B56F6";

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// { name, resetUrl, expiresInMinutes } -> { subject, html, text }
function resetPasswordEmail({ name, resetUrl, expiresInMinutes = 60 }) {
  const firstName = escapeHtml(String(name || "").trim().split(/\s+/)[0] || "there");
  const url = escapeHtml(resetUrl);
  const year = new Date().getFullYear();

  const subject = "Reset your password - A.M. OXFORD Admin";

  const text = [
    `Hi ${String(name || "").trim().split(/\s+/)[0] || "there"},`,
    "",
    "We received a request to reset the password for your A.M. OXFORD admin account.",
    "Open this link to choose a new password:",
    "",
    resetUrl,
    "",
    `The link works once and expires in ${expiresInMinutes} minutes.`,
    "If you did not ask for this, ignore this email. Your password will not change.",
    "",
    "A.M. OXFORD Public School & College",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f2fb;-webkit-text-size-adjust:100%;">
  <!-- Preview text shown in the inbox list -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    Use this link within ${expiresInMinutes} minutes to set a new password for your admin account.
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f2fb;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;">

          <!-- Brand header -->
          <tr>
            <td align="center" style="background-color:${BRAND};background-image:linear-gradient(135deg,${BRAND},${BRAND_DARK});border-radius:16px 16px 0 0;padding:28px 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" valign="middle" width="48" height="48" style="width:48px;height:48px;background-color:rgba(255,255,255,0.18);border-radius:12px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">AM</td>
                </tr>
              </table>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:1.5px;color:#ffffff;margin-top:12px;">A.M. OXFORD</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#ece6ff;margin-top:2px;">Admin Panel</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:36px 32px 28px;font-family:Arial,Helvetica,sans-serif;color:#212121;">
              <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:#212121;">Reset your password</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Hi ${firstName},</p>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#444444;">
                We received a request to reset the password for your A.M. OXFORD admin account.
                Click the button below to choose a new password.
              </p>

              <!-- Button (table-based so it works in Outlook too) -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 28px;">
                <tr>
                  <td align="center" bgcolor="${BRAND}" style="border-radius:10px;">
                    <a href="${url}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Reset password</a>
                  </td>
                </tr>
              </table>

              <!-- Expiry notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:#f6f3ff;border-left:4px solid ${BRAND};border-radius:6px;padding:12px 14px;font-size:13px;line-height:1.5;color:#4a4a5a;">
                    This link works <strong>once</strong> and expires in <strong>${expiresInMinutes} minutes</strong>.
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6c6c7a;">If the button does not work, copy and paste this link into your browser:</p>
              <p style="margin:0 0 24px;font-size:12px;line-height:1.5;word-break:break-all;">
                <a href="${url}" target="_blank" style="color:${BRAND};text-decoration:underline;">${url}</a>
              </p>

              <p style="margin:0;padding-top:20px;border-top:1px solid #eeeeee;font-size:13px;line-height:1.5;color:#6c6c7a;">
                Didn't request this? You can safely ignore this email. Your password will stay the same.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="background-color:#ffffff;border-radius:0 0 16px 16px;padding:0 32px 28px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#9a9aa8;">
                &copy; ${year} A.M. OXFORD Public School &amp; College<br>
                This is an automated message. Please do not reply.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

module.exports = { resetPasswordEmail };
