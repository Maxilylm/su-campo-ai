"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/FormField";
import { CONVERSATION_TITLE_LIMIT, normalizeConversationTitle, type ChatConversationSummary } from "@/lib/chat-conversations";

/** Rename dialog, opened from a conversation's menu. Remounted per conversation. */
export function RenameConversationDialog({
  conversation, onClose, onRename,
}: {
  conversation: ChatConversationSummary | null;
  onClose: () => void;
  onRename: (id: string, title: string) => Promise<boolean>;
}) {
  return (
    <Dialog open={Boolean(conversation)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {conversation && <RenameForm key={conversation.id} conversation={conversation} onClose={onClose} onRename={onRename} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({ conversation, onClose, onRename }: {
  conversation: ChatConversationSummary;
  onClose: () => void;
  onRename: (id: string, title: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(conversation.title);
  const [pending, setPending] = useState(false);
  const normalized = normalizeConversationTitle(title);

  async function submit() {
    if (!normalized || pending) return;
    if (normalized === conversation.title) {
      onClose();
      return;
    }
    setPending(true);
    try {
      if (await onRename(conversation.id, normalized)) onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <DialogHeader>
        <DialogTitle>Renombrar conversación</DialogTitle>
        <DialogDescription>El nombre lo ven todos los miembros del campo.</DialogDescription>
      </DialogHeader>
      <FormField label="Nombre">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={CONVERSATION_TITLE_LIMIT}
          autoFocus
          aria-invalid={!normalized}
        />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button>
        <Button type="submit" disabled={!normalized || pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Delete confirmation for one conversation (menu item or page header). */
export function DeleteConversationDialog({
  conversation, onClose, onDelete,
}: {
  conversation: ChatConversationSummary | null;
  onClose: () => void;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [pending, setPending] = useState(false);

  async function confirm(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!conversation || pending) return;
    setPending(true);
    try {
      if (await onDelete(conversation.id)) onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={Boolean(conversation)} onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar la conversación?</AlertDialogTitle>
          <AlertDialogDescription>
            Se eliminarán «{conversation?.title}» y todos sus mensajes para todos los miembros del campo. Los datos que el asistente ya guardó no cambian. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={(event) => void confirm(event)} disabled={pending} variant="destructive">
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {pending ? "Eliminando…" : "Eliminar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
