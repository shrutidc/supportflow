import type { Metadata } from "next";
import { TicketDetail } from "@/components/tickets/ticket-detail";

// Next 16: route params are async.
type Props = { params: Promise<{ ticketId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticketId } = await params;
  return { title: decodeURIComponent(ticketId) };
}

export default async function TicketPage({ params }: Props) {
  const { ticketId } = await params;
  return <TicketDetail ticketId={decodeURIComponent(ticketId)} />;
}
