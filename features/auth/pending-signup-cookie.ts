import "server-only";
import { cookies } from "next/headers";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import { openPendingSignup, PENDING_SIGNUP_COOKIE, PENDING_SIGNUP_TTL, sealPendingSignup, type EnrollmentInput } from "./pending-signup";

export async function rememberPendingSignup(input: EnrollmentInput) {
  (await cookies()).set(PENDING_SIGNUP_COOKIE, sealPendingSignup(input, getServerEnv().TRIAL_HASH_SECRET), {
    httpOnly: true, sameSite: "lax", secure: new URL(getPublicEnv().NEXT_PUBLIC_SITE_URL).protocol === "https:",
    path: "/", maxAge: PENDING_SIGNUP_TTL,
  });
}
export async function pendingSignupForUser(userId: string) {
  return openPendingSignup((await cookies()).get(PENDING_SIGNUP_COOKIE)?.value, userId, getServerEnv().TRIAL_HASH_SECRET);
}
export async function clearPendingSignup() { (await cookies()).delete(PENDING_SIGNUP_COOKIE); }
