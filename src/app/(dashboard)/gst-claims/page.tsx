import { redirect } from "next/navigation";

/**
 * GST claims is now a tab inside Billing (Phase-3 merge, 26 Sep 2026). This route
 * is kept only so old links/bookmarks land on the right place: the Billing page,
 * anchored to its invoice register where the GST-claims tab lives.
 */
export default function GstClaimsPage() {
  redirect("/billing?tab=gst#invoices");
}
