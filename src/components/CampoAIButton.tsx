"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFarm } from "@/contexts/FarmContext";
import { aiChatHandoffKey, buildModuleChatPrompt } from "@/lib/ai-handoff";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";

interface CampoAIButtonProps {
  title: string;
  facts: string[];
  partial?: boolean;
  instruction?: string;
  disabled?: boolean;
  label?: string;
}

/** Shared entry point from a domain module into the authoritative Chat flow. */
export function CampoAIButton({ title, facts, partial, instruction, disabled = false, label = "Analizar con CampoAI" }: CampoAIButtonProps) {
  const { userId, offlineMode, isOnline, readOnly: permissionReadOnly } = useFarm();
  const navigate = useOfflineAwareNavigation();
  const actionReadOnly = offlineMode || !isOnline || permissionReadOnly;
  const isDisabled = disabled || actionReadOnly || !userId;

  function askCampoAI() {
    if (isDisabled || !userId) return;
    try {
      window.sessionStorage.setItem(aiChatHandoffKey(userId), buildModuleChatPrompt({ title, facts, partial, instruction }));
    } catch {
      // Chat remains available even when session storage is unavailable.
    }
    navigate("/chat?from=module");
  }

  const titleText = actionReadOnly
    ? (offlineMode || !isOnline ? "Necesitás conexión para consultar a CampoAI" : "Tu acceso es de solo lectura")
    : disabled
      ? "Cargá datos para analizarlos con CampoAI"
      : undefined;

  return (
    <Button variant="outline" onClick={askCampoAI} disabled={isDisabled} title={titleText}>
      <Sparkles className="mr-2 h-4 w-4" />{label}
    </Button>
  );
}
