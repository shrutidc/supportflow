"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchTicket,
  fetchTickets,
  patchTicket,
  postMessage,
  type TicketPatch,
} from "./client";
import type { Ticket, TicketListFilters } from "./schemas";

export const ticketKeys = {
  all: ["tickets"] as const,
  list: (filters: TicketListFilters) => ["tickets", "list", filters] as const,
  detail: (ticketId: string) => ["tickets", "detail", ticketId] as const,
};

export function useTickets(filters: TicketListFilters) {
  return useQuery({
    queryKey: ticketKeys.list(filters),
    queryFn: () => fetchTickets(filters),
  });
}

export function useTicket(ticketId: string) {
  return useQuery({
    queryKey: ticketKeys.detail(ticketId),
    queryFn: () => fetchTicket(ticketId),
  });
}

/** Shared cache bookkeeping after any mutation that returns the fresh ticket. */
function useApplyTicketUpdate() {
  const queryClient = useQueryClient();
  return (ticket: Ticket) => {
    queryClient.setQueryData(ticketKeys.detail(ticket.ticketId), ticket);
    // Lists (all views/filters) are derived data — refetch lazily.
    queryClient.invalidateQueries({ queryKey: ticketKeys.all, refetchType: "active" });
  };
}

export function useUpdateTicket(ticketId: string) {
  const applyUpdate = useApplyTicketUpdate();
  return useMutation({
    mutationFn: (patch: TicketPatch) => patchTicket(ticketId, patch),
    onSuccess: applyUpdate,
  });
}

export function useClaimTicket(ticketId: string) {
  const queryClient = useQueryClient();
  const applyUpdate = useApplyTicketUpdate();
  return useMutation({
    mutationFn: () => patchTicket(ticketId, { assignedTo: "You", status: "In Progress" }),
    onSuccess: applyUpdate,
    // A 409 means someone else claimed it — refetch to show current owner.
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ticketKeys.detail(ticketId) });
    },
  });
}

export function useSendMessage(ticketId: string) {
  const applyUpdate = useApplyTicketUpdate();
  return useMutation({
    mutationFn: (message: { sender: "customer" | "agent"; body: string }) =>
      postMessage(ticketId, message),
    onSuccess: applyUpdate,
  });
}
