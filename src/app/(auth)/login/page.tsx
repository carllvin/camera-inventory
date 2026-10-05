import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { getSessionUser } from "@/server/auth/context";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { next } = await searchParams;
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Sign in</h1>
      <ActionForm action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="Email" name="email" type="email" autoComplete="email" required autoFocus />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton className="w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>
      {process.env.ALLOW_SIGNUP !== "false" && (
        <p className="mt-6 text-sm text-muted">
          New here?{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </p>
      )}
    </>
  );
}
