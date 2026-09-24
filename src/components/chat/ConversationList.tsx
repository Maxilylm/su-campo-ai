"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Loader2, MoreHorizontal, Pencil, SquarePen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { groupConversationsByDate, type ChatConversationSummary } from "@/lib/chat-conversations";
import type { ConversationListStatus } from "@/components/chat/useChatConversations";

interface ConversationListProps {
  status: ConversationListStatus;
  conversations: ChatConversationSummary[];
  activeId: string | null;
  /** Switching is paused while a message is in flight. */
  disabled: boolean;
  canManage: boolean;
  userId: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (conversation: ChatConversationSummary) => void;
  onDelete: (conversation: ChatConversationSummary) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

export function ConversationList({
  status, conversations, activeId, disabled, canManage, userId, hasMore, loadingMore,
  onSelect, onNew, onRename, onDelete, onLoadMore, onRetry,
}: ConversationListProps) {
  // "Hoy" rolls over at the farm's midnight without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const groups = useMemo(() => groupConversationsByDate(conversations, now), [conversations, now]);
  const idPrefix = useId();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Button variant="outline" onClick={onNew} disabled={disabled} className="w-full justify-start">
        <SquarePen aria-hidden="true" />
        Nueva conversación
      </Button>

      <nav aria-label="Conversaciones" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        {status === "loading" && conversations.length === 0 && (
          <div className="space-y-2 pt-4" aria-busy="true" aria-label="Cargando conversaciones">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-5/6" />
            <Skeleton className="h-8 w-4/6" />
          </div>
        )}

        {status === "error" && conversations.length === 0 && (
          <div className="pt-4 text-sm text-muted-foreground">
            <p>No se pudieron cargar las conversaciones.</p>
            <Button variant="link" size="sm" className="h-auto px-0" onClick={onRetry}>Reintentar</Button>
          </div>
        )}

        {status === "ready" && conversations.length === 0 && (
          <p className="px-2.5 pt-4 text-sm text-muted-foreground">Tus conversaciones van a aparecer acá.</p>
        )}

        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`${idPrefix}-${group.key}`}>
            <h3 id={`${idPrefix}-${group.key}`} className="px-2.5 pb-1 pt-4 text-xs font-medium text-muted-foreground">{group.label}</h3>
            <ul className="space-y-0.5">
              {group.items.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeId}
                  disabled={disabled}
                  canRename={canManage || (Boolean(userId) && conversation.created_by === userId)}
                  canDelete={canManage}
                  onSelect={onSelect}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </section>
        ))}

        {hasMore && (
          <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={loadingMore} className="mt-2 w-full text-muted-foreground">
            {loadingMore && <Loader2 className="animate-spin" aria-hidden="true" />}
            {loadingMore ? "Cargando…" : "Ver anteriores"}
          </Button>
        )}
      </nav>
    </div>
  );
}

function ConversationRow({
  conversation, active, disabled, canRename, canDelete, onSelect, onRename, onDelete,
}: {
  conversation: ChatConversationSummary;
  active: boolean;
  disabled: boolean;
  canRename: boolean;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onRename: (conversation: ChatConversationSummary) => void;
  onDelete: (conversation: ChatConversationSummary) => void;
}) {
  const hasMenu = canRename || canDelete;
  return (
    <li className={cn(
      "group relative flex items-center rounded-md transition-colors",
      active ? "bg-accent" : "hover:bg-accent",
    )}>
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        disabled={disabled && !active}
        aria-current={active ? "page" : undefined}
        title={conversation.title}
        className={cn(
          "min-h-11 min-w-0 flex-1 truncate rounded-md px-2.5 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-9",
          active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          hasMenu && "pr-10",
        )}
      >
        {conversation.title}
      </button>
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Opciones de «${conversation.title}»`}
              className={cn(
                "absolute right-1 text-muted-foreground hover:text-foreground data-[state=open]:opacity-100",
                // Always visible on touch screens; on desktop only on hover/focus or when active.
                !active && "lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover:opacity-100",
              )}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {canRename && (
              <DropdownMenuItem onSelect={() => onRename(conversation)}>
                <Pencil aria-hidden="true" /> Renombrar
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem onSelect={() => onDelete(conversation)} className="text-bad focus:text-bad">
                <Trash2 aria-hidden="true" className="text-bad" /> Eliminar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
