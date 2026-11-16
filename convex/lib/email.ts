import { ConvexError } from "convex/values";

// !!! EMAIL_DEV_MODE=1 MUST NEVER BE SET ON PRODUCTION !!!
// The dev shell sends no email and hands the verification code straight back to the app,
// so a dev-verified host proves nothing about owning the address. It exists only so the
// host flow can be exercised before an email provider is configured.

export type EmailMode = "email" | "dev";
export type SendResult = { mode: "email" } | { mode: "dev"; devCode: string };

type Sender = { mode: EmailMode; send: (to: string, code: string) => Promise<SendResult> };

const resend = (apiKey: string, from: string): Sender => ({
  mode: "email",
  async send(to, code) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Your Scout host verification code",
        text: `Your Scout verification code is ${code}. It expires in 10 minutes. If you didn't ask for this, ignore this email.`,
      }),
    });
    if (!response.ok) throw new ConvexError({ code: "email_send_failed", message: "We couldn't send the code. Try again shortly." });
    return { mode: "email" };
  },
});

const devShell: Sender = {
  mode: "dev",
  async send(to, code) {
    console.log(`[EMAIL_DEV_MODE] verification code for ${to}: ${code}`);
    return { mode: "dev", devCode: code };
  },
};

function sender(): Sender {
  const { RESEND_API_KEY, EMAIL_FROM, EMAIL_DEV_MODE } = process.env;
  if (RESEND_API_KEY && EMAIL_FROM) return resend(RESEND_API_KEY, EMAIL_FROM);
  if (EMAIL_DEV_MODE === "1") return devShell;
  throw new ConvexError({ code: "email_not_configured", message: "Email verification isn't set up on this deployment yet" });
}

export const emailMode = (): EmailMode => sender().mode;

export const sendVerificationEmail = (to: string, code: string) => sender().send(to, code);
