/** The website, which serves the pages this app used to: the homepage, the docs, privacy and terms. */
const SITE = "https://adwarp.dev";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship prebuilt dist; no transpile needed.
  // playwright is only used by the local competitor-ad scanner (lazy-imported in
  // @adwarp/core); keep it external so the hosted bundle never tries to resolve it.
  serverExternalPackages: ["@adwarp/core", "@adwarp/mcp", "playwright", "playwright-core"],
  // This app only serves the MCP endpoint at /api/mcp. Its old pages moved to adwarp.dev, so
  // their paths redirect there permanently (308) and search engines index the website instead.
  async redirects() {
    return [
      { source: "/", destination: SITE, permanent: true },
      { source: "/docs", destination: `${SITE}/docs`, permanent: true },
      { source: "/docs/:path*", destination: `${SITE}/docs/:path*`, permanent: true },
      { source: "/privacy", destination: `${SITE}/privacy`, permanent: true },
      { source: "/terms", destination: `${SITE}/terms`, permanent: true },
    ];
  },
};

export default nextConfig;
