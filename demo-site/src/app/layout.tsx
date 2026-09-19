import type { Metadata } from "next";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { getCurrentUser } from "@/data/currentUser";
import "./globals.css";

const FAVICON =
  "https://mycourses.aalto.fi/theme/image.php/aalto_mycourses/theme/1789725245/favicon";

export const metadata: Metadata = {
  title: "MyCourses",
  description: "Aalto University MyCourses learning environment",
  icons: {
    icon: FAVICON,
    shortcut: FAVICON,
    apple: FAVICON,
  },
};

/**
 * Reading the user cookie here is what keeps the navbar avatar and the footer
 * sign-off in step on the server's first render; it also makes every route
 * dynamic, which this site can afford.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Navbar user={user} />
        <div className="mc-content">{children}</div>
        <Footer user={user} />
      </body>
    </html>
  );
}
