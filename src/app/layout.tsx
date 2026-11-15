import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DataNotice } from "@/components/data-notice";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoMeta – Gebrauchtwagen aus allen Börsen",
  description: "Einmal suchen, Angebote aus vielen Fahrzeugbörsen vergleichen und direkt zur Originalanzeige springen.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-7xl items-baseline gap-3 px-4 py-4">
            <Link href="/" className="text-xl font-bold tracking-tight">
              Auto<span className="text-accent">Meta</span>
            </Link>
            <span className="hidden text-sm text-muted sm:inline">Alle Gebrauchtwagen-Börsen, eine Suche</span>
          </div>
        </header>
        <Suspense fallback={null}>
          <DataNotice />
        </Suspense>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t border-line py-6 text-center text-xs text-muted">
          <p>AutoMeta zeigt Angebote anderer Börsen und leitet immer zur Originalanzeige weiter.</p>
          <p className="mt-1">
            Postleitzahlen:{" "}
            <a href="https://www.geonames.org" className="underline hover:text-accent" rel="noopener">
              GeoNames
            </a>{" "}
            (
            <a href="https://creativecommons.org/licenses/by/4.0/deed.de" className="underline hover:text-accent" rel="noopener">
              CC BY 4.0
            </a>
            )
          </p>
        </footer>
      </body>
    </html>
  );
}
