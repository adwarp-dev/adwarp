import type { ReactNode } from "react";

// This app is only the hosted MCP endpoint at /api/mcp. Its old pages live on adwarp.dev, and
// next.config.mjs redirects their paths there. Next.js still needs a root layout for its 404 page.
export const metadata = {
  title: "Adwarp MCP endpoint",
  robots: { index: false, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
