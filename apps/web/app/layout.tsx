import type { ReactNode } from "react";
import { Anton, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const display = Anton({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-display",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: "Adwarp",
  description:
    "Adwarp is a free, open-source ad agent that runs in your terminal. Size audiences, draft campaigns and pull reports on LinkedIn Ads and Google Ads.",
  // adwarp.dev is the site to index. The pages left here go away when they move there.
  robots: { index: false, follow: true },
};

export const viewport = {
  themeColor: "#0b0b0c",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
