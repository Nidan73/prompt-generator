import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "@/components/theme-provider";
import { Analytics } from '@vercel/analytics/react';
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Bhai Thik Kor | Expert AI Prompt Generator",
    template: "%s | Bhai Thik Kor",
  },
  description:
    "Stop writing generic AI prompts. Bhai Thik Kor transforms your rough ideas into highly specialized, expert-grade execution prompts and routes them to the best AI models.",
  keywords: [
    "AI prompt generator",
    "prompt engineering",
    "prompt optimizer",
    "ChatGPT prompts",
    "Claude prompts",
    "AI model router",
    "Bhai thik kor",
  ],
  authors: [{ name: "Nidan" }],
  creator: "Nidan",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://bhaithikkor.vercel.app",
    title: "Bhai Thik Kor | Expert AI Prompt Generator",
    description:
      "Transform your rough ideas into expert-grade execution prompts and route them to the best AI models instantly.",
    siteName: "Bhai Thik Kor",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bhai Thik Kor | Expert AI Prompt Generator",
    description:
      "Transform your rough ideas into expert-grade execution prompts and route them to the best AI models instantly.",
    creator: "@nidan",
  },
  verification: {
    google: "lLRBx1KGPwcBNd7zAVE-pRxgbuUtpWl0pSyuRwi4Scg",
  },
  metadataBase: new URL("https://bhaithikkor.vercel.app"),
};

const themeInitScript = `
(function () {
  try {
    var storedTheme = window.localStorage.getItem("theme");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var resolvedTheme = storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : prefersDark
        ? "dark"
        : "light";
    var root = document.documentElement;
    if (resolvedTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    root.style.colorScheme = resolvedTheme;
  } catch (_) {}
})();
`;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "Bhai Thik Kor",
  "url": "https://bhaithikkor.vercel.app",
  "applicationCategory": "UtilityApplication",
  "operatingSystem": "All",
  "description": "Expert AI Prompt Generator that transforms vague ideas into highly structured, expert-grade execution prompts and routes them to the best AI models.",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "creator": {
    "@type": "Person",
    "name": "Nidan"
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`} suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
        <ThemeProvider>{children}</ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
