import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "SEO Client Acquisition OS", template: "%s · SEO Client Acquisition OS" },
  description: "Audit websites, generate evidence-based SEO proposals and manage client acquisition.",
};

// Applies the saved theme before first paint to avoid a light/dark flash.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
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
