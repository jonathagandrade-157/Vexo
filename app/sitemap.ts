import type { MetadataRoute } from "next";

import { getPublicEnv } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  const { NEXT_PUBLIC_SITE_URL } = getPublicEnv();

  return [
    {
      url: NEXT_PUBLIC_SITE_URL,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
