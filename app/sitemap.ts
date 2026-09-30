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
    {
      url: `${NEXT_PUBLIC_SITE_URL}/termos`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${NEXT_PUBLIC_SITE_URL}/privacidade`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];
}
