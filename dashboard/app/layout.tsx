import type { Metadata } from "next";
import { Instrument_Sans, Source_Sans_3, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { MobileSidebar } from "@/components/sidebar-mobile";
import { TopBar } from "@/components/topbar";
import { Toaster } from "@/components/ui/toaster";
import { CommandPalette } from "@/components/command-palette";
import { QueryProvider } from "@/components/providers/query-provider";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const sourceSans3 = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Operant Dashboard",
  description: "Self-hosted PostgreSQL operations dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${sourceSans3.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-text-primary">
        <QueryProvider>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-accent focus:text-text-primary focus:text-sm focus:font-medium focus:rounded-md focus:outline-none"
        >
          Skip to main content
        </a>
        <Sidebar />
        <MobileSidebar />
        <main id="main-content" role="main" className="lg:pl-64 min-h-screen pb-16 lg:pb-0">
          <TopBar />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            {children}
          </div>
        </main>
        <CommandPalette />
        <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
