-- 052: Chat conversations — the AI chat gets a list of past chats.
--
-- Until now a farm had ONE shared transcript in chat_messages. Conversations
-- stay shared per farm (every member sees them, like the old thread), and
-- remember who started them. The prompt history of a turn comes only from
-- its own conversation.
--
-- * chat_conversations: one row per conversation. `channel` is 'web' for
--   chats started in the app and 'whatsapp' for the farm's single WhatsApp
--   thread (unique per farm; the webhook appends to it).
-- * chat_messages.conversation_id: nullable, so rows written by a deployment
--   that predates this migration are still accepted. The foreign key is
--   composite (conversation_id, farm_id), so a message can never point at
--   another farm's conversation; deleting a conversation deletes its messages.
-- * A trigger moves a conversation's updated_at to its newest message, which
--   is the order of the list ("most recent first").
-- * backfill_chat_conversations(farm) moves messages without a conversation
--   into one conversation titled "Conversación anterior" per farm. It runs
--   once below for every farm; it is safe to run again (it only touches rows
--   whose conversation_id is still null, e.g. written by an older deployment
--   in the minutes between this migration and the deploy).
--   chat_messages never recorded the channel, so existing WhatsApp turns
--   cannot be told apart from web turns: they go to "Conversación anterior"
--   too, and the "WhatsApp" conversation starts with the next WhatsApp
--   message.
--
-- Server-only, like 050's tables: API routes use the service role.

CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Nueva conversación'
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'whatsapp')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE (id, farm_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_farm_updated
  ON public.chat_conversations (farm_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_farm_whatsapp
  ON public.chat_conversations (farm_id) WHERE channel = 'whatsapp';
CREATE INDEX IF NOT EXISTS idx_chat_conversations_created_by
  ON public.chat_conversations (created_by);

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.chat_conversations;
CREATE POLICY "Service role full access" ON public.chat_conversations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.chat_conversations FROM anon, authenticated;

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS conversation_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_messages_conversation_fkey'
      AND conrelid = 'public.chat_messages'::regclass
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_conversation_fkey
      FOREIGN KEY (conversation_id, farm_id)
      REFERENCES public.chat_conversations (id, farm_id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
  ON public.chat_messages (conversation_id, created_at DESC);

-- Newest message → conversation's updated_at. SECURITY DEFINER because the
-- member RLS policies on chat_messages still allow editors to insert, and
-- they have no grant on chat_conversations. Lock order: the insert's FK check
-- takes KEY SHARE on the conversation row, then this takes NO KEY UPDATE on
-- the same row; nothing else is locked, so two inserts only queue, and a
-- delete (FOR UPDATE) simply waits for them.
CREATE OR REPLACE FUNCTION public.touch_chat_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.conversation_id IS NOT NULL THEN
    UPDATE chat_conversations
      SET updated_at = GREATEST(updated_at, COALESCE(NEW.created_at, now()))
      WHERE id = NEW.conversation_id AND farm_id = NEW.farm_id;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.touch_chat_conversation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS chat_messages_touch_conversation ON public.chat_messages;
CREATE TRIGGER chat_messages_touch_conversation
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_chat_conversation();

-- Messages of a farm (or of every farm, when p_farm_id is null) that have no
-- conversation → one "Conversación anterior" per farm. Returns how many
-- messages were moved.
CREATE OR REPLACE FUNCTION public.backfill_chat_conversations(p_farm_id UUID DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_conversation UUID;
  v_moved integer := 0;
  v_count integer;
BEGIN
  FOR r IN
    SELECT m.farm_id, min(m.created_at) AS first_at, max(m.created_at) AS last_at
    FROM chat_messages m
    WHERE m.conversation_id IS NULL
      AND (p_farm_id IS NULL OR m.farm_id = p_farm_id)
    GROUP BY m.farm_id
  LOOP
    INSERT INTO chat_conversations (farm_id, created_by, title, channel, created_at, updated_at)
      VALUES (
        r.farm_id,
        (SELECT f.user_id FROM farms f WHERE f.id = r.farm_id),
        'Conversación anterior',
        'web',
        COALESCE(r.first_at, now()),
        COALESCE(r.last_at, now())
      )
      RETURNING id INTO v_conversation;
    UPDATE chat_messages
      SET conversation_id = v_conversation
      WHERE farm_id = r.farm_id AND conversation_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_moved := v_moved + v_count;
  END LOOP;
  RETURN v_moved;
END;
$function$;

REVOKE ALL ON FUNCTION public.backfill_chat_conversations(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_chat_conversations(UUID) TO service_role;

SELECT public.backfill_chat_conversations(NULL);
