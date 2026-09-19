/**
 * POST /api/biometrics/autoencoder/enrol
 *
 * Trains a fresh autoencoder on one user's captured mouse events and stores
 * the resulting profile. The events are first reduced to ~1 s windows of
 * movement dynamics, so a long capture collapses to a few thousand training
 * rows - see scripts/benchAutoencoder.ts for measured numbers and pick
 * `epochs`/`batchSize` against your platform's request timeout.
 */

import { NextRequest, NextResponse } from "next/server";

import { eventsToWindowFeatures } from "@/lib/biometrics/autoencoder/features";
import { saveProfile } from "@/lib/biometrics/autoencoder/profileStore";
import { trainUserModel } from "@/lib/biometrics/autoencoder/train";
import type { MouseEvent } from "@/lib/biometrics/autoencoder/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface EnrolBody {
  userId: string;
  events: MouseEvent[];
  epochs?: number;
  batchSize?: number;
}

export async function POST(req: NextRequest) {
  let body: EnrolBody;
  try {
    body = (await req.json()) as EnrolBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.userId || !Array.isArray(body.events)) {
    return NextResponse.json({ error: "userId and events[] are required" }, { status: 400 });
  }

  try {
    const { data, rows } = eventsToWindowFeatures(body.events);
    const started = performance.now();
    const profile = await trainUserModel(body.userId, data, rows, {
      epochs: body.epochs ?? 120,
      batchSize: body.batchSize ?? 256,
    });
    await saveProfile(profile);

    return NextResponse.json(
      {
        userId: profile.userId,
        trainWindows: profile.trainRows,
        epochs: profile.epochs,
        threshold: profile.threshold,
        trainMs: Math.round(performance.now() - started),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("autoencoder enrol failed", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
