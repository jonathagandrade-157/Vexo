import { NextResponse } from "next/server";

/**
 * Infra smoke-test endpoint — proves Route Handlers deploy and respond.
 * No business logic, no Supabase call, no auth. Not part of the public API
 * surface described in architecture §10 (that starts at `/api/v1/*`).
 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
