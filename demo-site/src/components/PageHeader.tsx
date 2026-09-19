import type { ReactNode } from "react";

export type PageHeaderVariant = "home" | "user" | "course";

export type PageHeaderProps = {
  /** home = 350px frontpage image, user = 200px, course = 200px. */
  variant: PageHeaderVariant;
  /** Overlay content, e.g. the course title plate. Positioned relatively. */
  children?: ReactNode;
  className?: string;
};

/**
 * Full-bleed theme banner. The images are remote mycourses.aalto.fi theme
 * files pulled in via CSS `background-image`; each variant also carries a
 * background-color so the banner still reads as a band when offline.
 */
export default function PageHeader({
  variant,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={`mc-banner mc-banner--${variant}${
        className ? ` ${className}` : ""
      }`}
    >
      {children}
    </div>
  );
}
