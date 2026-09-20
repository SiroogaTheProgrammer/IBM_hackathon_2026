import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * `POST /api/collect` — writes one recorded run to `data/collected/`.
 *
 * Collection runs are a research instrument, not a product feature: this route
 * takes arbitrary text from the browser and puts it on the operator's disk, so
 * it is locked down on three axes and refuses rather than degrades if any of
 * them fails.
 *
 *  1. **Never in production.** A production build answers 404, so a deployed
 *     copy of the demo has no write endpoint at all.
 *  2. **Loopback only.** The request's `Host` must be localhost, which keeps it
 *     off the dev server's LAN address as well.
 *  3. **The client never names the file.** It sends a participant *number*;
 *     the name is built here, so no input of any kind reaches the path.
 *
 * Existing files are never overwritten — a repeat of participant 3 lands as
 * `user-3-2.csv`. Three minutes of someone's time is not worth clobbering over
 * a mis-set counter.
 */

/** Where runs land, relative to the Next project root. */
const OUTPUT_DIR = ["data", "collected"];

/** Refuse anything that is not plausibly one session of mouse samples. */
const MAX_CSV_BYTES = 32 * 1024 * 1024;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** `localhost:3000` / `[::1]:3000` / `127.0.0.1` → the host without its port. */
function hostnameOf(host: string | null): string {
  if (!host) return "";
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  const colon = host.lastIndexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return refuse(404, "Not found");
  }

  if (!LOOPBACK.has(hostnameOf(request.headers.get("host")))) {
    return refuse(403, "Collection endpoint is loopback-only");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "Body must be JSON");
  }

  const { participant, csv } = (body ?? {}) as {
    participant?: unknown;
    csv?: unknown;
  };

  if (
    typeof participant !== "number" ||
    !Number.isSafeInteger(participant) ||
    participant < 1
  ) {
    return refuse(400, "participant must be a positive integer");
  }

  if (typeof csv !== "string" || csv.length === 0) {
    return refuse(400, "csv must be a non-empty string");
  }

  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) {
    return refuse(413, "csv is too large to be one session");
  }

  const directory = path.join(process.cwd(), ...OUTPUT_DIR);

  try {
    await mkdir(directory, { recursive: true });

    /*
     * `wx` fails rather than truncates, so the loop settles on the first free
     * name instead of racing or overwriting.
     */
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const filename =
        attempt === 1 ? `user-${participant}.csv` : `user-${participant}-${attempt}.csv`;

      try {
        await writeFile(path.join(directory, filename), csv, {
          encoding: "utf8",
          flag: "wx",
        });
        return Response.json({
          filename,
          path: `${OUTPUT_DIR.join("/")}/${filename}`,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }

    return refuse(409, `user-${participant}.csv and 99 fallbacks all exist`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    return refuse(500, `Could not write the run: ${detail}`);
  }
}
