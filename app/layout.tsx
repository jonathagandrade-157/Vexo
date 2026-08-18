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
      <head>
        {/*
          Material Symbols Outlined is the icon font every Stitch screen
          uses (e.g. criar_conta_e_elegibilidade_trial's field icons).
          next/font/google doesn't catalog it (it's a variable, ligature-
          based icon font, not a text typeface), so unlike the three fonts
          above it stays a classic Google Fonts <link> rather than a
          self-hosted one.
        */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font --
            that rule targets the Pages Router's pages/_document.js; the
            App Router has no such file, and a <link> in the root layout's
            <head> is the documented replacement. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background font-body text-on-background antialiased">
        {children}
      </body>
    </html>
  );
}
