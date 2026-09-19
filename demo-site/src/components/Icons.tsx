/**
 * Inline SVG icon set for the MyCourses clone.
 * No icon library, no CDN — every glyph is hand-written, 24x24 viewBox,
 * painted with `currentColor` so the parent controls the colour.
 */

export type IconProps = {
  /** Rendered width/height in px. Defaults to 20. */
  size?: number;
  className?: string;
  /** Accessible name. When omitted the icon is `aria-hidden`. */
  title?: string;
};

type StrokeIconProps = IconProps & { strokeWidth?: number };

function Svg({
  size = 20,
  className,
  title,
  strokeWidth = 1.7,
  filled = false,
  children,
}: StrokeIconProps & { filled?: boolean; children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={filled ? undefined : strokeWidth}
      strokeLinecap={filled ? undefined : "round"}
      strokeLinejoin={filled ? undefined : "round"}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={className}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/* --------------------------------------------------------------- chrome --- */

export function Search(props: StrokeIconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.2 16.2 4.3 4.3" />
    </Svg>
  );
}

export function Bell(props: StrokeIconProps) {
  return (
    <Svg {...props}>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5" />
      <path d="M13.8 20.5a2.1 2.1 0 0 1-3.6 0" />
    </Svg>
  );
}

export function Message(props: StrokeIconProps) {
  return (
    <Svg {...props}>
      <path d="M20.5 11.6c0 4.4-3.8 8-8.5 8a9.4 9.4 0 0 1-3.9-.8L3.5 20.3l1.3-4.1a7.7 7.7 0 0 1-1.3-4.6c0-4.4 3.8-8 8.5-8s8.5 3.6 8.5 8Z" />
    </Svg>
  );
}

export function Moon(props: StrokeIconProps) {
  return (
    <Svg {...props}>
      <path d="M20.7 13.3A8.6 8.6 0 0 1 10.7 3.3a8.6 8.6 0 1 0 10 10Z" />
    </Svg>
  );
}

export function ChevronDown(props: StrokeIconProps) {
  return (
    <Svg size={16} {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function ChevronUp(props: StrokeIconProps) {
  return (
    <Svg size={16} {...props}>
      <path d="m18 15-6-6-6 6" />
    </Svg>
  );
}

export function ChevronLeft(props: StrokeIconProps) {
  return (
    <Svg size={16} {...props}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

export function ChevronRight(props: StrokeIconProps) {
  return (
    <Svg size={16} {...props}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  );
}

export function Check(props: StrokeIconProps) {
  return (
    <Svg size={16} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Svg>
  );
}

export function Close(props: StrokeIconProps) {
  return (
    <Svg size={18} {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}

export function Home(props: StrokeIconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9.7V20h13V9.7" />
      <path d="M10 20v-5h4v5" />
    </Svg>
  );
}

export function ArrowRight(props: StrokeIconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h16" />
      <path d="m14 6 6 6-6 6" />
    </Svg>
  );
}

export function Kebab(props: IconProps) {
  const { size = 20, className, title } = props;
  return (
    <Svg size={size} className={className} title={title} filled>
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </Svg>
  );
}

export function Star(props: StrokeIconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z" />
    </Svg>
  );
}

export function ExternalLink(props: StrokeIconProps) {
  return (
    <Svg size={16} {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h4.5" />
    </Svg>
  );
}

export function ChartIcon(props: StrokeIconProps) {
  return (
    <Svg size={16} {...props}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 20v-6" />
      <path d="M13 20V9" />
      <path d="M18 20v-9" />
    </Svg>
  );
}

/* ----------------------------------------------------- activity glyphs --- */

export function AssignmentIcon(props: StrokeIconProps) {
  return (
    <Svg {...props}>
      <path d="M12 16V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </Svg>
  );
}

export function QuizIcon(props: StrokeIconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6.5 5.6 8l2.6-2.8" />
      <path d="M4 13.5 5.6 15l2.6-2.8" />
      <path d="M4 20.2 5.6 21.7l2.6-2.8" />
      <path d="M11.5 6.6h8.5" />
      <path d="M11.5 13.6h8.5" />
      <path d="M11.5 20.2h8.5" />
    </Svg>
  );
}

export function QuestionnaireIcon(props: StrokeIconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4.5H7A1.5 1.5 0 0 0 5.5 6v13A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-2" />
      <path d="M9 3.5h6v2.8H9z" />
      <path d="M8.8 11h6.4" />
      <path d="M8.8 15.2h4.4" />
    </Svg>
  );
}

export function GroupIcon(props: StrokeIconProps) {
  return (
    <Svg {...props}>
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M3.5 19.5c0-3 2.7-5 6-5s6 2 6 5" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 6.1" />
      <path d="M17.6 14.9c1.8.7 3 2.3 3 4.6" />
    </Svg>
  );
}

export function ForumIcon(props: StrokeIconProps) {
  return (
    <Svg {...props}>
      <path d="M17.5 13.5h-9L5 16.6V5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v6.5a1.5 1.5 0 0 1-1.5 1.5Z" />
      <path d="M8 16.8v.7a1.5 1.5 0 0 0 1.5 1.5h6l3.5 3V18" />
    </Svg>
  );
}

/* -------------------------------------------- activity kind → icon map --- */

export type ActivityKind =
  | "group"
  | "quiz"
  | "assignment"
  | "questionnaire"
  | "forum";

export const activityLabels: Record<ActivityKind, string> = {
  group: "Group",
  quiz: "Quiz",
  assignment: "Assignment",
  questionnaire: "Questionnaire",
  forum: "Forum",
};

/** Picks the right activity glyph for a Moodle activity kind. */
export function ActivityIcon({
  kind,
  size = 22,
  className,
  title,
}: IconProps & { kind: ActivityKind }) {
  const shared = { size, className, title };
  switch (kind) {
    case "quiz":
      return <QuizIcon {...shared} />;
    case "assignment":
      return <AssignmentIcon {...shared} />;
    case "questionnaire":
      return <QuestionnaireIcon {...shared} />;
    case "forum":
      return <ForumIcon {...shared} />;
    case "group":
    default:
      return <GroupIcon {...shared} />;
  }
}
