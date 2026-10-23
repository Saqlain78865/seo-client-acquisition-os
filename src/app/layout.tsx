import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { Toaster } from "sonner";
import "./globals.css";

// Geist (SIL Open Font License), bundled so the app — including the offline desktop app — never fetches fonts.
const geist = localFont({
  variable: "--font-geist",
  display: "swap",
  src: [
    { path: "./fonts/geist-latin.woff2", weight: "100 900", style: "normal" },
  ],
});
const geistMono = localFont({
  variable: "--font-geist-mono",
  display: "swap",
  src: [
    { path: "./fonts/geist-mono-latin.woff2", weight: "100 900", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: { default: "SEO Client Acquisition OS", template: "%s · SEO Client Acquisition OS" },
  description: "Audit websites, generate evidence-based SEO proposals and manage client acquisition.",
};

// Applies the saved theme before first paint to avoid a light/dark flash.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      {/* Browser extensions (e.g. Grammarly) add attributes to <body> before React loads; ignore those differences. */}
      <body className="min-h-screen" suppressHydrationWarning>
        {/* next/script injects this into the server HTML only, so React never re-renders a <script> tag. */}
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {children}
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
