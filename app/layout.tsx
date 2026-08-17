import type { Metadata } from "next";
import { Hanken_Grotesk, Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";

// next/font self-hosts these at build time (architecture §0.3) instead of
// loading from fonts.googleapis.com at runtime like the raw Stitch export
// does — same three families the DESIGN.md tri-font strategy specifies.
const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-hanken-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VEXO",
  description: "VEXO — plataforma de criação e gerenciamento de lojas virtuais.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${hankenGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-background font-body text-on-background antialiased">
        {children}
      </body>
    </html>
  );
}
