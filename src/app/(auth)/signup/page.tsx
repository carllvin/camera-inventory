import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { signupAction } from "../actions";

export const metadata = { title: "Create account" };
// ALLOW_SIGNUP is read at request time, not baked in at build time.
export const dynamic = "force-dynamic";

export default function SignupPage() {
  if (process.env.ALLOW_SIGNUP === "false") {
    return <p className="text-sm text-muted">Sign-up is disabled on this server. Ask an admin for an account.</p>;
  }
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Create account</h1>
      <ActionForm action={signupAction} className="space-y-4">
        <Field label="Your name" name="name" autoComplete="name" required autoFocus />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="new-password" hint="At least 8 characters" required />
        <SubmitButton className="w-full" pendingText="Creating…">
          Create account
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
