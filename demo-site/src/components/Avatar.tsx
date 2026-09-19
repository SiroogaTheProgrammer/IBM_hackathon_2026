import type { SiteUser } from "@/data/users";

export type AvatarSize = "sm" | "lg";

export type AvatarProps = {
  /**
   * Whose initials and plate colour to draw. Passed in rather than read from
   * the cookie because the navbar avatar sits inside a client component.
   */
  user: SiteUser;
  /** sm = 28px (navbar), lg = 90px (profile header). */
  size?: AvatarSize;
  className?: string;
  /** Accessible name; pass "" to mark the avatar decorative. */
  alt?: string;
};

const SIZES: Record<AvatarSize, { box: number; font: number }> = {
  sm: { box: 28, font: 12 },
  lg: { box: 90, font: 34 },
};

/**
 * Round initials avatar. No personal photo is ever fetched — the real site's
 * profile picture is replaced by a neutral muted placeholder, tinted per user
 * so a switch is visible at a glance.
 */
export default function Avatar({
  user,
  size = "sm",
  className,
  alt,
}: AvatarProps) {
  const { box, font } = SIZES[size];
  const label = alt ?? user.fullName;

  return (
    <span
      className={className}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      style={{
        display: "inline-flex",
        flex: `0 0 ${box}px`,
        alignItems: "center",
        justifyContent: "center",
        width: box,
        height: box,
        borderRadius: "50%",
        backgroundColor: user.avatarBg,
        color: "#212529",
        fontSize: font,
        fontWeight: 500,
        lineHeight: 1,
        letterSpacing: "0.02em",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      {user.initials}
    </span>
  );
}
