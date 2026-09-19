import { NextResponse } from "next/server";

import { getConfigPayload } from "@/lib/biometrics/session";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getConfigPayload(), { headers: { "Cache-Control": "no-store" } });
}
