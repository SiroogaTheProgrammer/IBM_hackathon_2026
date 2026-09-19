/**
 * SapiMouse verification endpoint. Stateless: templates go out on enrol and come
 * back in on verify, so this route composes with whatever store you already use
 * (Upstash, a DB, the client) instead of assuming one.
 *
 *   POST { action: "enrol",  events }                  -> { template }
 *   POST { action: "verify", events, template, operatingPoint? }
 *   POST { action: "identify", events, templates }
 *   GET                                                 -> model metadata
 *
 * `events[].t` is SECONDS by default; pass `timestampUnit: "ms"` for raw
 * SapiMouse-style captures. Getting this wrong makes every dt 1000x off and
 * every downstream number meaningless, which is why it is explicit.
 */
import { NextResponse } from "next/server";
import {
  enrol, verify, identify, THRESHOLDS, META,
  type RawEvent, type Template, type OperatingPoint,
} from "@/lib/biometrics/sapimouse";

export const runtime = "nodejs";

type Body = {
  action?: "enrol" | "verify" | "identify";
  events?: RawEvent[];
  template?: Template;
  templates?: Record<string, Template>;
  operatingPoint?: OperatingPoint;
  timestampUnit?: "s" | "ms";
};

function toSeconds(events: RawEvent[], unit: "s" | "ms" = "s"): RawEvent[] {
  return unit === "ms" ? events.map((e) => ({ ...e, t: e.t * 1e-3 })) : events;
}

export async function GET() {
  return NextResponse.json({ thresholds: THRESHOLDS, meta: META });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const events = toSeconds(body.events ?? [], body.timestampUnit ?? "s");
  if (!events.length) {
    return NextResponse.json({ error: "no events supplied" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "enrol":
        return NextResponse.json({ template: enrol(events) });
      case "verify": {
        if (!body.template) {
          return NextResponse.json({ error: "verify needs a template" }, { status: 400 });
        }
        return NextResponse.json(
          verify(events, body.template, body.operatingPoint ?? "frr5"));
      }
      case "identify": {
        if (!body.templates || !Object.keys(body.templates).length) {
          return NextResponse.json({ error: "identify needs templates" }, { status: 400 });
        }
        return NextResponse.json({ ranking: identify(events, body.templates) });
      }
      default:
        return NextResponse.json(
          { error: 'action must be "enrol", "verify" or "identify"' }, { status: 400 });
    }
  } catch (err) {
    // too few usable strokes is the common, expected case: the caller should
    // keep collecting rather than treat it as a failure
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, needsMoreActivity: true }, { status: 422 });
  }
}
