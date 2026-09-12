import type { Metadata } from "next";
import { Playfair_Display, Plus_Jakarta_Sans } from "next/font/google";

/**
 * Clínica Tajy — conceptual demo landing page, isolated from the VEXO
 * product (root layout, fonts, design tokens) on purpose: this route
 * doesn't touch Supabase, auth, or any tenant/storefront logic, and its
 * own Playfair Display / Plus Jakarta Sans pairing (Stitch DESIGN.md)
 * would otherwise collide with the VEXO Hanken Grotesk/Inter pairing set
 * on <html> in app/layout.tsx.
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

export default function TajyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className={`${tajySerif.variable} ${tajySans.variable} bg-tajy-black font-tajy-sans text-[#e1e3e4] antialiased selection:bg-tajy-gold selection:text-black`}
    >
      {children}
    </div>
  );
}
