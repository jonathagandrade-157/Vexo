import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pins this standalone project as its own Turbopack root. Without this,
  // Next.js infers the workspace root by walking up for the nearest
  // lockfile and — since this project happens to sit inside the VEXO
  // repo, which has its own package-lock.json one level up — it would
  // pick /home/user/Vexo instead, pulling VEXO's root `proxy.ts` (and its
  // Supabase/tenant imports) into this build. Pinning `root` here is what
  // makes this project build in true isolation.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
