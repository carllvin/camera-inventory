import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/components/i18n";
import { dictionaryFor } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/server/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Camera Inventory", template: "%s · Camera Inventory" },
  description: "Rental equipment tracking for camera departments",
  applicationName: "Camera Inventory",
  appleWebApp: { capable: true, title: "Camera Inventory", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#111113" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh font-sans">
        <I18nProvider locale={locale} dict={dictionaryFor(locale)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
