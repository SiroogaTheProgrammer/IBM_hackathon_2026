import type { ReactNode } from "react";
import BiometricsWidget from "@/components/BiometricsWidget";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { getCurrentUser } from "@/data/currentUser";

/**
 * The signed-in site shell.
 *
 * Reading the user cookie here is what keeps the navbar avatar and the footer
 * sign-off in step on the server's first render; it also makes every route
 * under this group dynamic, which this site can afford. The login page lives
 * in the sibling `(auth)` group and deliberately never sees this chrome.
 */
export default async function SiteLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <>
      <Navbar user={user} />
      <div className="mc-content">{children}</div>
      <Footer user={user} />
      <BiometricsWidget />
    </>
  );
}
