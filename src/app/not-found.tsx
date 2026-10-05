import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link href="/" className="text-accent hover:underline">
        Go to dashboard
      </Link>
    </main>
  );
}
