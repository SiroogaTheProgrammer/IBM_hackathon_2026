import { NextRequest, NextResponse } from "next/server";

import { processTick } from "@/lib/biometrics/session";
import type { TickPayload } from "@/lib/biometrics/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let payload: TickPayload;
  try {
    payload = (await req.json()) as TickPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const result = await processTick(payload);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("biometrics tick failed", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
