import type { Metadata } from "next";
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
 * Root layout: only the document shell and the design system.
 *
 * The signed-in chrome (navbar, footer, biometrics widget) lives in the
 * `(site)` group layout, so the `(auth)` login page can render on the same
 * gradient background the real MyCourses login uses — with none of that
 * chrome, exactly as the live site presents it.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
