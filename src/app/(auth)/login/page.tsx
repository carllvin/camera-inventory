import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { getSessionUser } from "@/server/auth/context";
import { getT } from "@/server/i18n";
import { loginAction } from "../actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Sign in") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { next } = await searchParams;
  const t = await getT();
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("Sign in")}</h1>
      <ActionForm action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label={t("Email")} name="email" type="email" autoComplete="email" required autoFocus />
        <Field label={t("Password")} name="password" type="password" autoComplete="current-password" required />
        <SubmitButton className="w-full" pendingText={t("Signing in…")}>
          {t("Sign in")}
        </SubmitButton>
      </ActionForm>
      {process.env.ALLOW_SIGNUP !== "false" && (
        <p className="mt-6 text-sm text-muted">
          {t("New here?")}{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            {t("Create an account")}
          </Link>
        </p>
      )}
    </>
  );
}
