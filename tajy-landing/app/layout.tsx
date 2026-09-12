import type { Metadata } from "next";
import { Playfair_Display, Plus_Jakarta_Sans } from "next/font/google";

import "./globals.css";

/**
 * Standalone Clínica Tajy demo — no dependency on any other project.
 * Playfair Display / Plus Jakarta Sans pairing per the Stitch DESIGN.md.
 */
const tajySerif = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-tajy-serif",
  display: "swap",
});

const tajySans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-tajy-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Clínica Tajy | Odontologia Estética",
  description:
    "Clínica Tajy — odontologia estética, cuidado e planejamento para o seu sorriso.",
  openGraph: {
    title: "Clínica Tajy | Odontologia Estética",
    description:
      "Clínica Tajy — odontologia estética, cuidado e planejamento para o seu sorriso.",
    locale: "pt_BR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${tajySerif.variable} ${tajySans.variable}`}>
      <body className="bg-tajy-black font-tajy-sans text-[#e1e3e4] antialiased selection:bg-tajy-gold selection:text-black">
        {children}
      </body>
    </html>
  );
}
