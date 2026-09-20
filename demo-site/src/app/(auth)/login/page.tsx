import type { Metadata } from "next";
import LoginView from "@/components/LoginView";

export const metadata: Metadata = {
  title: "Log in to the site | MyCourses",
};

export default function LoginPage() {
  return <LoginView />;
}
