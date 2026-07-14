import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxView } from "@/components/tickets/inbox-view";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage() {
  // useSearchParams in InboxView requires a Suspense boundary at the route level.
  return (
    <Suspense>
      <InboxView />
    </Suspense>
  );
}
