"use client";

import {
  type ContactChannel,
  LEAD_STAGE_LABELS,
  type LeadCard,
  type LeadContactResult,
  type LeadDetail,
  type LeadStage,
  type LeadUpdateInput,
  autoMoveTarget,
} from "@leadanchor/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { api, isApiError } from "@/lib/api";
import { keys } from "@/lib/queries";

interface UpdateVars extends LeadUpdateInput {
  id: string;
  /** Show an Undo toast that restores this stage. */
  undoStage?: LeadStage;
}

/**
 * Updates a lead optimistically: the board changes instantly, rolls back on
 * failure, and stage moves get an Undo toast (brief §3.8).
 */
export function useUpdateLead() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, undoStage, ...body }: UpdateVars) => api<LeadDetail>(`/leads/${id}`, { method: "PATCH", body }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: keys.leads });
      const previous = queryClient.getQueryData<LeadCard[]>(keys.leads);
      queryClient.setQueryData<LeadCard[]>(keys.leads, (leads) =>
        leads?.map((lead) =>
          lead.id === vars.id
            ? {
                ...lead,
                ...(vars.stage && { stage: vars.stage, needsCallback: vars.stage === "new" ? lead.needsCallback : false }),
                ...(vars.title && { title: vars.title }),
                ...(vars.valueDollars !== undefined && { valueCents: vars.valueDollars === null ? null : Math.round(vars.valueDollars * 100) }),
                lastActivityAt: new Date().toISOString(),
              }
            : lead,
        ),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(keys.leads, context.previous);
      toast.error(isApiError(error) ? error.message : "Couldn't save that change.");
    },
    onSuccess: (detail, vars) => {
      queryClient.setQueryData(keys.lead(detail.id), detail);
      if (vars.stage && vars.undoStage && vars.undoStage !== vars.stage) {
        const from = vars.undoStage;
        toast(`Moved to ${LEAD_STAGE_LABELS[vars.stage]}`, {
          action: { label: "Undo", onClick: () => mutation.mutate({ id: vars.id, stage: from }) },
        });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.leads });
      void queryClient.invalidateQueries({ queryKey: keys.dashboardAll });
    },
  });

  return mutation;
}

/**
 * Tells the API the owner tapped Call or Text. The phone places the call or opens the
 * text itself; the card moves to Contacted straight away and the server confirms it.
 */
export function useRecordContact() {
  const queryClient = useQueryClient();

  const { mutate } = useMutation({
    mutationFn: ({ id, channel }: { id: string; channel: ContactChannel }) =>
      api<LeadContactResult>(`/leads/${id}/contact`, { method: "POST", body: { channel }, keepalive: true }),
    onMutate: async ({ id, channel }) => {
      await queryClient.cancelQueries({ queryKey: keys.leads });
      queryClient.setQueryData<LeadCard[]>(keys.leads, (leads) =>
        leads?.map((lead) => {
          if (lead.id !== id) return lead;
          const to = autoMoveTarget(lead.stage, channel === "call" ? "owner_called" : "owner_texted");
          return { ...lead, needsCallback: false, ...(to && { stage: to }) };
        }),
      );
    },
    onSuccess: ({ moved }, { channel }) => {
      if (moved) toast(`Moved to ${LEAD_STAGE_LABELS[moved.to]}`, { description: channel === "call" ? "You called them." : "You texted them." });
    },
    onSettled: (_data, _error, { id }) => {
      void queryClient.invalidateQueries({ queryKey: keys.leads });
      void queryClient.invalidateQueries({ queryKey: keys.lead(id) });
      void queryClient.invalidateQueries({ queryKey: keys.dashboardAll });
    },
  });

  return useCallback(
    (lead: { id: string; customer: { phone: string | null } }, channel: ContactChannel) => {
      if (lead.customer.phone) mutate({ id: lead.id, channel });
    },
    [mutate],
  );
}
