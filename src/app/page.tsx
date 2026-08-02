import { redirect } from "next/navigation";

/** Root sends signed-in staff to the dashboard; middleware handles the rest. */
export default function Home() {
  redirect("/dashboard");
}
