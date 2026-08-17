import type { NextConfig } from "next";

// Foundation stage: no rewrites/redirects, no experimental flags.
// Tenant-by-host routing and custom-domain handling (§3.4, §17 of the
// architecture doc) are introduced starting Stage 6, not here.
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
