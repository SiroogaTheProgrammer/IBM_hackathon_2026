/**
 * POST /api/biometrics/autoencoder/score
 *
 * Scores a window of mouse events against an enrolled user's autoencoder.
 * Inference only - cheap enough for the normal request path.
 */

import { NextRequest, NextResponse } from "next/server";

import { eventsToWindowFeatures } from "@/lib/biometrics/autoencoder/features";
import { loadProfile } from "@/lib/biometrics/autoencoder/profileStore";
import { scoreSession } from "@/lib/biometrics/autoencoder/score";
import type { MouseEvent } from "@/lib/biometrics/autoencoder/types";

export const runtime = "nodejs";

interface ScoreBody {
  userId: string;
  events: MouseEvent[];
}

export async function POST(req: NextRequest) {
  let body: ScoreBody;
  try {
    body = (await req.json()) as ScoreBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.userId || !Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json({ error: "userId and a non-empty events[] are required" }, { status: 400 });
  }

  try {
    const profile = await loadProfile(body.userId);
    if (!profile) {
      return NextResponse.json({ error: `no enrolled profile for ${body.userId}` }, { status: 404 });
    }

    const { data, rows } = eventsToWindowFeatures(body.events);
    const result = await scoreSession(profile, data, rows);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("autoencoder score failed", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
