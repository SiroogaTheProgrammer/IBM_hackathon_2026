/**
 * The people this clone can be signed in as.
 *
 * Both are deliberately fictional placeholders. No real person's name, email,
 * student number, date of birth or other identifying detail belongs in this
 * file: the clone is a study stimulus and gets shared around. Everything
 * user-facing (profile page, navbar avatar, footer sign-off, page titles)
 * reads from here, so this file alone re-identifies or re-anonymises the site.
 *
 * Which of the two is active is carried by the `mc-user` cookie: the server
 * reads it in `src/data/currentUser.ts`, the navbar's avatar menu writes it.
 */

export type SiteUserId = "bob" | "pekka";

export type SiteUser = {
  id: SiteUserId;
  fullName: string;
  initials: string;
  email: string;
  timezone: string;
  /**
   * Avatar plate colour. The two users get different muted tokens so a switch
   * registers from the navbar glyph alone, before the name is read.
   */
  avatarBg: string;
};

export const users: Record<SiteUserId, SiteUser> = {
  bob: {
    id: "bob",
    fullName: "Bob",
    initials: "B",
    email: "bob@aalto.fi",
    timezone: "Europe/Helsinki",
    avatarBg: "var(--mc-avatar-grey)",
  },
  pekka: {
    id: "pekka",
    fullName: "Pekka",
    initials: "P",
    email: "pekka@aalto.fi",
    timezone: "Europe/Helsinki",
    avatarBg: "var(--mc-avatar-sand)",
  },
};

/** Listing order, e.g. in the avatar menu's "Switch user" submenu. */
export const userIds: SiteUserId[] = ["bob", "pekka"];

/** Who a visitor without the cookie is. */
export const defaultUserId: SiteUserId = "bob";

/** Cookie that pins the signed-in user. Value is a `SiteUserId`. */
export const USER_COOKIE = "mc-user";

/** One year: a switch has to survive well past a single study session. */
export const USER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Own-property check, not `in`: `in` also answers true for everything on
 * `Object.prototype`, so a stray `mc-user=toString` cookie would resolve to a
 * function and the layout would hand that to the client navbar.
 */
function isUserId(id: string | undefined): id is SiteUserId {
  return id !== undefined && Object.prototype.hasOwnProperty.call(users, id);
}

/** Resolve a cookie value. Anything unknown falls back to the default user. */
export function getUser(id: string | undefined): SiteUser {
  return isUserId(id) ? users[id] : users[defaultUserId];
}
