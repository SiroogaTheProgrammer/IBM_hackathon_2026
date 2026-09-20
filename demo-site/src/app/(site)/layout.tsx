import type { ReactNode } from "react";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import TraceProvider from "@/components/trace/TraceProvider";
import TraceUiCard from "@/components/trace/TraceUiCard";
import { getCurrentUser } from "@/data/currentUser";

/**
 * The signed-in site shell.
 *
 * Reading the user cookie here is what keeps the navbar avatar and the footer
 * sign-off in step on the server's first render; it also makes every route
 * under this group dynamic, which this site can afford. The login page lives
 * in the sibling `(auth)` group and deliberately never sees this chrome.
 *
 * The Trace engine wraps the group rather than the document: a run walks
 * several routes and must stay one continuous recording, which works because
 * this layout never unmounts between them.
 */
export default async function SiteLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <TraceProvider>
      <Navbar user={user} />
      <div className="mc-content">{children}</div>
      <Footer user={user} />
      <TraceUiCard />
    </TraceProvider>
  );
}
