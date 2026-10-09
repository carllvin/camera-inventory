import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <Logo className="size-8" />
          <span className="text-lg font-semibold tracking-tight">Camera Inventory</span>
        </div>
        {children}
      </div>
    </main>
  );
}
