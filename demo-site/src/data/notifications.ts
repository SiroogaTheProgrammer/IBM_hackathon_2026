/**
 * The deadline alerts behind the navbar bell.
 *
 * Moodle's notification popover is fed by the same scheduled tasks that send
 * the "assignment is due" mails, so every alert is a deadline the clone can
 * already render: the six below follow the live popover of Friday, 18
 * September 2026, and each one points back at its activity page.
 *
 * There is no backend — the read state lives in the panel component, and the
 * red badge counts whatever is still unread here.
 */

import { targetHref } from "@/data/activities";

export type Notification = {
  id: string;
  /** Bold first line of the item, exactly as the live site prints it. */
  title: string;
  /** Muted relative age, e.g. "11 hours 23 mins ago". */
  time: string;
  /** Where "View full notification" goes. */
  href: string;
  /** Shaded until "Mark all as read" is clicked. */
  unread: boolean;
};

/** Both "assignments due" digests open the dashboard's timeline. */
const TIMELINE = "/my";

export const notifications: Notification[] = [
  {
    id: "n1",
    title: "Overdue: Homework Return 1",
    time: "11 hours 23 mins ago",
    href: targetHref("900151"),
    unread: true,
  },
  {
    id: "n2",
    title: "You have assignments due in 7 days",
    time: "21 hours 19 mins ago",
    href: TIMELINE,
    unread: true,
  },
  {
    id: "n3",
    title: "Due on Friday, 18 September 2026, 12:00 PM: Homework Return 1",
    time: "2 days 10 hours ago",
    href: targetHref("900151"),
    unread: true,
  },
  {
    id: "n4",
    title: "Opens on Tuesday, 15 September 2026, 4:00 PM: Quiz 3",
    time: "5 days 6 hours ago",
    href: targetHref("900133"),
    unread: true,
  },
  {
    id: "n5",
    title: "You have assignments due in 7 days",
    time: "7 days 21 hours ago",
    href: TIMELINE,
    unread: true,
  },
  {
    id: "n6",
    title: "Opens on Tuesday, 8 September 2026, 4:00 PM: Quiz 2",
    time: "12 days 6 hours ago",
    href: targetHref("900132"),
    unread: true,
  },
];

/** Where the popover's centred "See all" footer link goes. */
export const allNotificationsHref = TIMELINE;
