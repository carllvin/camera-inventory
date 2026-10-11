import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { getT } from "@/server/i18n";
import { signupAction } from "../actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Create account") };
}
// ALLOW_SIGNUP is read at request time, not baked in at build time.
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const t = await getT();
  if (process.env.ALLOW_SIGNUP === "false") {
    return <p className="text-sm text-muted">{t("Sign-up is disabled on this server. Ask an admin for an account.")}</p>;
  }
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("Create account")}</h1>
      <ActionForm action={signupAction} className="space-y-4">
        <Field label={t("Your name")} name="name" autoComplete="name" required autoFocus />
        <Field label={t("Email")} name="email" type="email" autoComplete="email" required />
        <Field label={t("Password")} name="password" type="password" autoComplete="new-password" hint={t("At least 8 characters")} required />
        <SubmitButton className="w-full" pendingText={t("Creating…")}>
          {t("Create account")}
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-muted">
        {t("Already have an account?")}{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          {t("Sign in")}
        </Link>
      </p>
    </>
  );
}
