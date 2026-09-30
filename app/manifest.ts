import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VEXO — Loja online",
    short_name: "VEXO",
    description: "Crie e gerencie sua loja online em um único painel.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0d14",
    theme_color: "#7c3aed",
    lang: "pt-BR",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
