/**
 * Server-side read of the signed-in user.
 *
 * The active user lives in a cookie rather than in client state so the very
 * first HTML the server sends already names the right person: no avatar
 * flipping after hydration, and nothing for React to complain about. The
 * price is that every route calling this renders dynamically, which is the
 * intended trade here — there is no data worth caching on a study stimulus.
 *
 * Server components only; `next/headers` cannot be reached from the client
 * navbar, which is why `Avatar` takes its user as a prop.
 */

import { cookies } from "next/headers";
import { USER_COOKIE, getUser } from "@/data/users";
import type { SiteUser } from "@/data/users";

export async function getCurrentUser(): Promise<SiteUser> {
  const store = await cookies();
  return getUser(store.get(USER_COOKIE)?.value);
}
