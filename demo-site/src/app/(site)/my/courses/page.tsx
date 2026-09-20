import type { Metadata } from "next";
import CourseList from "@/components/CourseList";
import PageHeader from "@/components/PageHeader";
import { myCourses } from "@/data/myCourses";

export const metadata: Metadata = {
  title: "My own courses | MyCourses",
};

export default function MyCoursesPage() {
  return (
    <>
      <PageHeader variant="user" />
      <div className="mc-page-title pt-4">
        <h1 className="mc-h1">My own courses</h1>
      </div>
      <div className="mc-container-courses" style={{ paddingBlock: "16px" }}>
        <hr className="mc-rule" />
        <CourseList courses={myCourses} />
      </div>
    </>
  );
}
