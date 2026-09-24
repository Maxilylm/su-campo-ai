import { NextResponse } from "next/server";

export const CHAT_CONVERSATION_NOT_FOUND_CODE = "chat_conversation_not_found";

/** The conversation id doesn't exist, belongs to another farm, or was deleted. */
export function conversationNotFound(): NextResponse {
  return NextResponse.json(
    { error: "No encontramos esa conversación. Puede que la hayan eliminado.", code: CHAT_CONVERSATION_NOT_FOUND_CODE },
    { status: 404 },
  );
}

export function conversationUnavailable(): NextResponse {
  return NextResponse.json(
    { error: "No se pudo abrir la conversación. Intentá nuevamente.", code: "chat_conversation_unavailable" },
    { status: 503 },
  );
}
