/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship prebuilt dist; no transpile needed.
  // playwright is only used by the local competitor-ad scanner (lazy-imported in
  // @adwarp/core); keep it external so the hosted bundle never tries to resolve it.
  serverExternalPackages: ["@adwarp/core", "@adwarp/mcp", "playwright", "playwright-core"],
};

export default nextConfig;
