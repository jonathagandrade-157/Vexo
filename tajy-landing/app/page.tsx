import { About } from "@/components/tajy/About";
import { BackToTop } from "@/components/tajy/BackToTop";
import { Differentials } from "@/components/tajy/Differentials";
import { FinalCTA } from "@/components/tajy/FinalCTA";
import { Footer } from "@/components/tajy/Footer";
import { Header } from "@/components/tajy/Header";
import { Hero } from "@/components/tajy/Hero";
import { Instagram } from "@/components/tajy/Instagram";
import { Location } from "@/components/tajy/Location";
import { Results } from "@/components/tajy/Results";
import { Treatments } from "@/components/tajy/Treatments";
import { WhatsAppButton } from "@/components/tajy/WhatsAppButton";

/**
 * Clínica Tajy — conceptual demo landing page (Instagram → landing →
 * conhecer a clínica → tratamentos → resultados → WhatsApp → agendamento).
 * Static content only, no data fetching.
 */
export default function TajyLandingPage() {
  return (
    <div className="overflow-x-hidden">
      <Header />
      <main className="space-y-24 pb-24 pt-16 md:space-y-36">
        <Hero />
        <Results />
        <Treatments />
        <About />
        <Differentials />
        <Instagram />
        <Location />
        <FinalCTA />
      </main>
      <Footer />
      <WhatsAppButton />
      <BackToTop />
    </div>
  );
}
