import type { Metadata } from "next";
import Link from "next/link";
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
        <div className="border-b border-warn-line bg-warn-bg">
          <p className="mx-auto max-w-7xl px-4 py-2 text-sm text-warn-text">
            Demo-Modus: Alle Fahrzeuge sind generierte Testdaten, keine echten Angebote.
          </p>
        </div>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t border-line py-6 text-center text-xs text-muted">
          AutoMeta zeigt Angebote anderer Börsen und leitet immer zur Originalanzeige weiter.
        </footer>
      </body>
    </html>
  );
}
