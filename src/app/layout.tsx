import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DataNotice } from "@/components/data-notice";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoMeta – Gebrauchtwagen aus allen Börsen",
  description: "Einmal suchen, Angebote aus vielen Fahrzeugbörsen vergleichen und direkt zur Originalanzeige springen.",
  // Added to an iPhone's home screen, AutoMeta opens like an app and can receive pushes.
  appleWebApp: { capable: true, title: "AutoMeta", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#1d5bd8" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line bg-surface">
          {/* Phones: logo and settings icon on top, the other links in one row below. Wider: one row. */}
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 px-4 pt-2 md:flex-nowrap md:py-3">
            <Link href="/" className="py-1 text-xl font-bold tracking-tight">
              Auto<span className="text-accent">Meta</span>
            </Link>
            <span className="hidden text-sm text-muted lg:inline">Alle Gebrauchtwagen-Börsen, eine Suche</span>
            <Link
              href="/einstellungen"
              aria-label="Einstellungen"
              title="Einstellungen"
              className="-mr-2 ml-auto flex h-10 w-10 items-center justify-center rounded-md text-muted hover:text-accent md:hidden"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </Link>
            <nav aria-label="Hauptmenü" className="-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-2 md:mx-0 md:ml-auto md:w-auto md:overflow-visible md:px-0">
              <ul className="flex whitespace-nowrap text-sm md:gap-x-1">
                <li>
                  {/* A route handler that redirects to the search with the visitor's settings, so a plain link. */}
                  <a href="/flip" className="block rounded-md px-2 py-2.5 font-medium text-accent hover:underline md:py-1.5">
                    Flip-Liste
                  </a>
                </li>
                <li>
                  <Link href="/suchauftraege" className="block rounded-md px-2 py-2.5 hover:text-accent md:py-1.5">
                    Suchaufträge
                  </Link>
                </li>
                <li>
                  <Link href="/merkliste" className="block rounded-md px-2 py-2.5 hover:text-accent md:py-1.5">
                    Merkliste
                  </Link>
                </li>
                <li>
                  <Link href="/reparaturen" className="block rounded-md px-2 py-2.5 hover:text-accent md:py-1.5">
                    <span className="lg:hidden">Reparaturen</span>
                    <span className="hidden lg:inline">Reparaturkatalog</span>
                  </Link>
                </li>
                <li className="hidden md:block">
                  <Link href="/einstellungen" className="block rounded-md px-2 py-1.5 hover:text-accent">
                    Einstellungen
                  </Link>
                </li>
              </ul>
            </nav>
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
