"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Quote, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useAiDecisions, useAiFeedback, useAnalyzeTicket, useUpdateTicket } from "@/lib/api/hooks";
import {
  aiSummaryOutputSchema,
  aiTriageOutputSchema,
  type AiDecision,
  type AiEvidence,
  type AiFeature,
  type Ticket,
} from "@/lib/api/schemas";

/**
 * AI recommendations for a ticket.
 *
 * Two rules shape this component:
 *
 * 1. **Nothing runs on its own.** Analysis is triggered by a click, never by
 *    rendering. It costs money and takes seconds, so an agent decides when to
 *    spend it.
 * 2. **Nothing is applied on its own.** Triage produces a suggestion; Apply
 *    performs the same authorized PATCH a human would, and records that the
 *    recommendation was accepted. Dismiss records the opposite. Neither is
 *    automatic, and the ticket is untouched until one is clicked.
 */

function confidenceTone(confidence: number): string {
  if (confidence >= 0.75) return "text-foreground";
  if (confidence >= 0.5) return "text-muted-foreground";
  return "text-destructive";
}

/** Links a quote back to the message it came from, so a claim can be checked. */
function EvidenceList({ evidence, ticket }: { evidence: AiEvidence[]; ticket: Ticket }) {
  if (evidence.length === 0) return null;

  const senderOf = (messageId: string) =>
    ticket.messages.find((message) => message._id === messageId)?.sender;

  return (
    <ul className="flex flex-col gap-2">
      {evidence.map((item, index) => {
        const sender = senderOf(item.messageId);
        return (
          <li key={`${item.messageId}-${index}`} className="rounded-md bg-muted/50 p-2 text-xs">
            <div className="flex items-start gap-1.5">
              <Quote className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              <span className="italic">{item.quote}</span>
            </div>
            <div className="mt-1 pl-4.5 text-muted-foreground">
              {sender ? `From the ${sender}'s message` : "From this ticket"}
              {item.reason ? ` · ${item.reason}` : ""}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DecisionMeta({ decision }: { decision: AiDecision }) {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      {decision.model} · {decision.promptVersion} · {(decision.latencyMs / 1000).toFixed(1)}s ·{" "}
      {decision.tokenUsage.input + decision.tokenUsage.output} tokens
      {decision.groundingDropped > 0 ? (
        <>
          {" · "}
          <span className="text-destructive">
            {decision.groundingDropped} unverifiable quote
            {decision.groundingDropped === 1 ? "" : "s"} discarded
          </span>
        </>
      ) : null}
    </p>
  );
}

function Confidence({ value }: { value: number }) {
  return (
    <span className={`text-xs font-medium tabular-nums ${confidenceTone(value)}`}>
      {Math.round(value * 100)}% confidence
    </span>
  );
}

function TriageResult({
  decision,
  ticket,
  onApplied,
}: {
  decision: AiDecision;
  ticket: Ticket;
  onApplied: (action: "accepted" | "rejected") => void;
}) {
  const parsed = aiTriageOutputSchema.safeParse(decision.output);
  const update = useUpdateTicket(ticket.ticketId);
  if (!parsed.success) return null;
  const triage = parsed.data;

  const changesPriority = triage.priority !== ticket.priority;
  const alreadyJudged = decision.userAction !== null;

  function apply() {
    // The ordinary authorized PATCH — the same call a human makes by hand.
    // The AI never had permission to do this itself.
    update.mutate(
      { priority: triage.priority as Ticket["priority"] },
      {
        onSuccess: () => {
          toast.success(`Priority set to ${triage.priority}`);
          onApplied("accepted");
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError ? error.message : "Could not update the ticket.",
          ),
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{triage.category}</Badge>
        <Badge variant="secondary">{triage.priority} priority</Badge>
        <Badge variant="secondary">{triage.recommended_queue}</Badge>
        {triage.should_escalate ? (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="size-3" />
            Suggests escalation
          </Badge>
        ) : null}
      </div>

      <Confidence value={decision.confidence} />

      <p className="text-sm leading-relaxed">{triage.reasoning_summary}</p>

      <EvidenceList evidence={triage.evidence} ticket={ticket} />

      {triage.missing_information.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Would need to be sure: </span>
          {triage.missing_information.join(" · ")}
        </div>
      ) : null}

      <Separator />

      {alreadyJudged ? (
        <p className="text-xs text-muted-foreground">
          {decision.userAction === "accepted"
            ? "Applied by an agent."
            : "Dismissed by an agent."}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={apply} disabled={update.isPending || !changesPriority}>
            <Check className="size-3.5" />
            {changesPriority ? `Set priority to ${triage.priority}` : "Already this priority"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onApplied("rejected")}>
            <X className="size-3.5" />
            Dismiss
          </Button>
        </div>
      )}

      <DecisionMeta decision={decision} />
    </div>
  );
}

function SummaryResult({ decision, ticket }: { decision: AiDecision; ticket: Ticket }) {
  const parsed = aiSummaryOutputSchema.safeParse(decision.output);
  if (!parsed.success) return null;
  const summary = parsed.data;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium leading-relaxed">{summary.headline}</p>
      <Confidence value={decision.confidence} />

      {summary.extracted_facts.length > 0 ? (
        <section className="flex flex-col gap-2">
          {/* Facts and inference are kept apart deliberately: a guess shown
              beside a quotation reads as something the customer said. */}
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Stated in the ticket
          </h4>
          <ul className="flex flex-col gap-2">
            {summary.extracted_facts.map((fact, index) => (
              <li key={index} className="text-sm">
                <span>{fact.statement}</span>
                <div className="mt-1">
                  <EvidenceList evidence={fact.evidence} ticket={ticket} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.inference.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Model&apos;s reading — not stated
          </h4>
          <ul className="list-disc pl-4 text-sm text-muted-foreground">
            {summary.inference.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.current_blocker ? (
        <p className="text-sm">
          <span className="font-medium">Blocker: </span>
          {summary.current_blocker}
        </p>
      ) : null}

      {summary.suggested_next_action ? (
        <p className="text-sm">
          <span className="font-medium">Suggested next: </span>
          {summary.suggested_next_action}
        </p>
      ) : null}

      {summary.missing_information.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Missing: </span>
          {summary.missing_information.join(" · ")}
        </div>
      ) : null}

      <DecisionMeta decision={decision} />
    </div>
  );
}

function FeatureSection({
  feature,
  label,
  ticket,
  decision,
}: {
  feature: AiFeature;
  label: string;
  ticket: Ticket;
  decision: AiDecision | undefined;
}) {
  const analyze = useAnalyzeTicket(ticket.ticketId);
  const feedback = useAiFeedback(ticket.ticketId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function run(force = false) {
    setErrorMessage(null);
    analyze.mutate(
      { feature, force },
      {
        onError: (error) =>
          setErrorMessage(
            error instanceof ApiError ? error.message : "Could not reach the AI service.",
          ),
      },
    );
  }

  function record(userAction: "accepted" | "rejected") {
    if (!decision) return;
    feedback.mutate({ decisionId: decision.id, userAction });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{label}</h3>
        <Button
          size="sm"
          variant={decision ? "ghost" : "secondary"}
          onClick={() => run(Boolean(decision))}
          disabled={analyze.isPending}
        >
          {analyze.isPending ? "Analysing…" : decision ? "Re-run" : "Run"}
        </Button>
      </div>

      {analyze.isPending ? (
        <div className="flex flex-col gap-2">
          {/* The wait is 10-20s on a cold start, which is long enough that
              skeleton bars alone read as a page that has stopped doing
              anything. Saying so is the difference between "working" and
              "broken" from the agent's side. */}
          <p className="text-xs text-muted-foreground">
            Asking the model — this usually takes 10–20 seconds.
          </p>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : null}

      {errorMessage ? (
        <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}

      {!analyze.isPending && !decision && !errorMessage ? (
        <p className="text-xs text-muted-foreground">
          {feature === "triage"
            ? "Suggests a category, priority and queue, with the quotes behind them."
            : "Separates what the ticket states from what the model infers."}
        </p>
      ) : null}

      {decision && !analyze.isPending ? (
        feature === "triage" ? (
          <TriageResult decision={decision} ticket={ticket} onApplied={record} />
        ) : (
          <SummaryResult decision={decision} ticket={ticket} />
        )
      ) : null}
    </div>
  );
}

export function AiPanel({ ticket }: { ticket: Ticket }) {
  const { data: decisions, isPending } = useAiDecisions(ticket.ticketId);

  // The newest decision per feature; the endpoint returns newest first.
  const latest = (feature: AiFeature) => decisions?.find((d) => d.feature === feature);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4" />
          AI assistance
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Recommendations only. Nothing changes this ticket until you apply it.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <FeatureSection
              feature="triage"
              label="Triage"
              ticket={ticket}
              decision={latest("triage")}
            />
            <Separator />
            <FeatureSection
              feature="summarize"
              label="Summary"
              ticket={ticket}
              decision={latest("summarize")}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
