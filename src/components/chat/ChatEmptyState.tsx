"use client";

import { LogoMark } from "@/components/Logo";

const VIEWER_SUGGESTIONS = ["¿Cuántas cabezas hay?", "¿Qué pendientes requieren atención?", "¿Cómo está el stock?"];
const EDITOR_SUGGESTIONS = ["Agregar potrero Sur de 60 ha", "Registrar 20 vacas Angus en Norte", "¿Cuántas cabezas hay?", "Mover 10 terneros al Sur"];

export function ChatEmptyState({ viewer, disabled, onPick }: { viewer: boolean; disabled: boolean; onPick: (text: string) => void }) {
  const suggestions = viewer ? VIEWER_SUGGESTIONS : EDITOR_SUGGESTIONS;
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
      <LogoMark className="h-10 w-10" />
      <h2 className="mt-4 text-lg font-semibold">¿En qué te ayudo hoy?</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {viewer
          ? "Preguntá por tu campo en lenguaje natural, por texto o por audio."
          : "Preguntá o cargá datos en lenguaje natural, por texto o por audio."}
      </p>
      <ul className="mt-6 grid w-full max-w-md gap-2 text-left sm:grid-cols-2" aria-label="Sugerencias">
        {suggestions.map((text) => (
          <li key={text}>
            <button
              type="button"
              onClick={() => onPick(text)}
              disabled={disabled}
              className="h-full w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
