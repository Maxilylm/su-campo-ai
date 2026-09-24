"use client";

import { AlertTriangle, ArrowUpRight, ClipboardCheck } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import type { ChatMessageRecord } from "@/lib/chat";

const linkButton = "inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

interface ChatMessageItemProps {
  message: ChatMessageRecord;
  /** Retry is offered for this failed message. */
  canRetry: boolean;
  retryDisabled: boolean;
  confirmDisabled: boolean;
  onRetry: () => void;
  onConfirm: () => void;
  onNavigate: (href: string) => void;
}

export function ChatMessageItem({ message: m, canRetry, retryDisabled, confirmDisabled, onRetry, onConfirm, onNavigate }: ChatMessageItemProps) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-br-sm bg-primary px-3.5 py-2 text-[15px] leading-relaxed text-primary-foreground sm:max-w-[72ch]">
          {m.text}
        </p>
      </div>
    );
  }

  const proposal = Boolean(m.pendingConfirmationToken && m.pendingConfirmationRequestId);
  const hasProposalLinks = Boolean(m.pendingConfirmationLinks && m.pendingConfirmationLinks.length > 0);

  const body = (
    <>
      {m.failed ? (
        <p className="flex gap-2 whitespace-pre-wrap break-words rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <span className="min-w-0">{m.text}</span>
        </p>
      ) : (
        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground">{m.text}</p>
      )}
      {(canRetry || m.aiContextUnavailable || m.operationMigration) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {canRetry && (
            <button type="button" onClick={onRetry} disabled={retryDisabled} className={`${linkButton} disabled:cursor-not-allowed disabled:opacity-50`}>
              {m.audioRetry ? "Reintentar audio" : "Reintentar"}
            </button>
          )}
          {m.aiContextUnavailable && (
            <button type="button" onClick={() => onNavigate("/gestion/campo")} className={linkButton}>Abrir diagnóstico de servicios</button>
          )}
          {m.operationMigration && (
            <button type="button" onClick={() => onNavigate("/gestion/campo")} className={linkButton}>Abrir diagnóstico</button>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="flex gap-3">
      <LogoMark className="mt-0.5 h-6 w-6" />
      <div className="min-w-0 max-w-[72ch] flex-1">
        <span className="sr-only">CampoAI:</span>
        {proposal || hasProposalLinks ? (
          <section aria-label="Cambios propuestos" className="rounded-lg border border-border bg-card shadow-xs">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-medium">
              <ClipboardCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              {proposal ? "Cambios para confirmar" : "Cambios propuestos"}
            </div>
            <div className="px-4 py-3">{body}</div>
            {hasProposalLinks && (
              <div className="border-t border-border px-4 py-2.5 text-sm">
                <p className="text-xs text-muted-foreground">Revisá antes de guardar</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {m.pendingConfirmationLinks!.map((link) => (
                    <button key={`pending-${link.href}`} type="button" onClick={() => onNavigate(link.href)} className={linkButton}>
                      {link.label}
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {proposal && (
              <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
                <Button onClick={onConfirm} disabled={confirmDisabled}>Confirmar y guardar</Button>
                <p className="text-xs text-muted-foreground">Nada se guarda hasta que confirmes.</p>
              </div>
            )}
          </section>
        ) : body}
        {m.changeLinks && m.changeLinks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {m.changeLinks.map((link) => (
              <button key={link.href} type="button" onClick={() => onNavigate(link.href)} className={linkButton}>
                Ver {link.label}
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatThinking() {
  return (
    <div className="flex gap-3" role="status">
      <LogoMark className="mt-0.5 h-6 w-6" />
      <div className="flex items-center gap-1.5 pt-2" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
      </div>
      <span className="sr-only">CampoAI está respondiendo…</span>
    </div>
  );
}
