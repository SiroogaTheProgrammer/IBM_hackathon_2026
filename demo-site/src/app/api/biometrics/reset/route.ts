import { NextResponse } from "next/server";

import { getSessionId, resetSession } from "@/lib/biometrics/session";

export const runtime = "nodejs";

export async function POST() {
  try {
    const sid = await getSessionId();
    await resetSession(sid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("biometrics reset failed", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
