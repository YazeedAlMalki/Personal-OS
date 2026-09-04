/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone build for the self-host Docker image (see Dockerfile).
  output: "standalone",
  // Keep server-only packages out of the client bundle.
  serverExternalPackages: ["@supabase/ssr"],
};

export default nextConfig;
