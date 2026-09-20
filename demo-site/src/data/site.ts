/**
 * Static site data for the MyCourses clone.
 *
 * There is no backend: every menu below is a literal transcription of the live
 * Aalto MyCourses navigation. Targets that are not part of the cloned route set
 * use "#" so a click never leaves the study site.
 */

export type MenuItem = {
  label: string;
  href?: string;
  external?: boolean;
  /** Nested flyout / expandable submenu (used by the user menu's "Language"). */
  items?: MenuItem[];
};

export type NavLink = {
  label: string;
  href: string;
  /** Match the pathname exactly rather than by prefix. */
  exact?: boolean;
  /** `data-trace` anchor for the study flow (`@/data/taskFlow`). */
  traceId?: string;
};

/** Routes that actually exist in this clone. */
export const routes = {
  home: "/",
  dashboard: "/my",
  myCourses: "/my/courses",
  profile: "/user/profile",
  course: (id: string | number) => `/course/${id}`,
} as const;

/** Primary nav items that carry the 3px orange active underline. */
export const primaryNav: NavLink[] = [
  { label: "Home", href: "/", exact: true, traceId: "nav.home" },
  { label: "Dashboard", href: "/my", exact: true, traceId: "nav.dashboard" },
  { label: "My own courses", href: "/my/courses", traceId: "nav.my-courses" },
];

export const schools: MenuItem[] = [
  { label: "School of Arts, Design, and Architecture (ARTS)", href: "#" },
  { label: "School of Business (BIZ)", href: "#" },
  { label: "School of Chemical Engineering (CHEM)", href: "#" },
  { label: "School of Electrical Engineering (ELEC)", href: "#" },
  { label: "School of Engineering (ENG)", href: "#" },
  { label: "School of Science (SCI)", href: "#" },
  { label: "Language Centre", href: "#" },
  { label: "Open University", href: "#" },
  { label: "Library", href: "#" },
  { label: "Aalto university pedagogical training programme", href: "#" },
  { label: "UNI (exams)", href: "#" },
  { label: "Sandbox", href: "#" },
];

export const serviceLinks: MenuItem[] = [
  { label: "ALLWELL?", href: "#" },
  { label: "-Study Skills", href: "#" },
  { label: "- Guidance and support for students", href: "#" },
  { label: "- Starting Point of Wellbeing", href: "#" },
  { label: "- About AllWell? study well-being questionnaire", href: "#" },
  { label: "MyCourses", href: "#" },
  { label: "- Digital exams on campus Safe Exam Browser test", href: "#" },
  { label: "- MyCourses instructions for Teachers", href: "#" },
  { label: "- MyCourses instructions for Students", href: "#" },
  { label: "- Teacher book your online session with a specialist", href: "#" },
  { label: "- Digital tools for teaching", href: "#" },
  { label: "- Personal data protection instructions for teachers", href: "#" },
  { label: "- Workspace for thesis supervision", href: "#" },
  { label: "- Course feedback instructions", href: "#" },
  { label: "Sisu", href: "#" },
  { label: "Student guide", href: "#" },
  { label: "Metacampus", href: "#" },
  { label: "- About Metacampus learning environment and Unite! alliance", href: "#" },
  { label: "Library Services", href: "#" },
  { label: "- Resourcesguides", href: "#" },
  { label: "- Imagoa / Open science and images", href: "#" },
  { label: "IT Services", href: "#" },
  { label: "Campus maps", href: "#" },
  { label: "- Search spaces and see opening hours", href: "#" },
  { label: "Restaurants in Otaniemi", href: "#" },
  { label: "ASU Aalto Student Union", href: "#" },
  { label: "Aalto Marketplace", href: "#" },
];

export const intelliboard: MenuItem[] = [
  { label: "Learner Metrics", href: "#" },
  { label: "Teacher Metrics", href: "#" },
  { label: "IntelliBoard system raport (admin only)", href: "#" },
];

export const languages: MenuItem[] = [
  { label: "English (en)", href: "#" },
  { label: "suomi (fi)", href: "#" },
  { label: "svenska (sv)", href: "#" },
];

export const userMenu: MenuItem[] = [
  { label: "Profile", href: "/user/profile" },
  { label: "Calendar", href: "#" },
  { label: "Grades", href: "#" },
  { label: "Messages", href: "#" },
  { label: "My forum discussions", href: "#" },
  { label: "Private files", href: "#" },
  { label: "Aalto password update", href: "#" },
  { label: "My course feedback", href: "#" },
  { label: "Preferences", href: "#" },
  { label: "Language", items: languages },
  { label: "Log out", href: "#" },
];

/*
 * The signed-in user is not here: there are two fictional users, they live in
 * `src/data/users.ts`, and the avatar menu switches between them.
 */

export type FooterColumn = {
  heading: string;
  links: MenuItem[];
};

export const footerColumns: FooterColumn[] = [
  {
    heading: "Students",
    links: [
      { label: "MyCourses instructions for students", href: "#" },
      { label: "Support form for students", href: "#" },
    ],
  },
  {
    heading: "Teachers",
    links: [
      { label: "MyCourses help", href: "#" },
      { label: "MyTeaching Support", href: "#" },
    ],
  },
  {
    heading: "About service",
    links: [
      { label: "MyCourses protection of privacy", href: "#" },
      { label: "Privacy notice", href: "#" },
      { label: "Service description", href: "#" },
      { label: "Accessibility summary", href: "#" },
    ],
  },
];

/** Remote theme assets served by mycourses.aalto.fi (public theme files). */
export const assets = {
  logo:
    "https://mycourses.aalto.fi/pluginfile.php/1/core_admin/logocompact/300x300/1789725245/Aalto_EN_21_BLACK_height35.png",
  frontpageBanner:
    "https://mycourses.aalto.fi/theme/image.php/aalto_mycourses/theme_aalto_mycourses/1789725245/frontpagebackgroundimage",
  userBanner:
    "https://mycourses.aalto.fi/theme/image.php/aalto_mycourses/theme_aalto_mycourses/1789725245/userpagebackgroundimage",
  courseBanner:
    "https://mycourses.aalto.fi/theme/image.php/aalto_mycourses/theme_aalto_mycourses/1789725245/incoursebackgroundimage",
  courseTile:
    "https://mycourses.aalto.fi/theme/image.php/aalto_mycourses/theme/1789725245/mc_noimg",
  sectionMarker:
    "https://mycourses.aalto.fi/theme/image.php/aalto_mycourses/theme_aalto_mycourses/1789725245/mc_section_marker_mikko_raskinen",
} as const;
