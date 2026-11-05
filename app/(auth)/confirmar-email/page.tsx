import type { Metadata } from "next";
import { BrandMark } from "@/components/ui/brand-mark";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ConfirmationForm } from "./confirmation-form";

export const metadata: Metadata = { title: "Confirme seu e-mail — VEXO" };
export default async function ConfirmationPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { data: { user } } = await (await createSupabaseServerClient()).auth.getUser();
  return <div className="flex min-h-dvh flex-col items-center px-margin-mobile py-8">
    <BrandMark />
    <main className="my-auto w-full max-w-[480px] py-10">
      <h1 className="mb-6 font-headline text-headline-md">Confirme seu e-mail</h1>
      <ConfirmationForm confirmed={Boolean(user?.email_confirmed_at)} invalidLink={Boolean(error)} />
    </main>
  </div>;
}
