-- Tag chat_messages with the farm role of whoever sent it, so a viewer's
-- turn can be dropped from the shared transcript an editor's AI calls read.
-- Viewers are read-only but a shared chat_messages transcript previously fed
-- every message, from any role, into readSharedChatHistory for every
-- channel -- a viewer could type a destructive-sounding instruction and have
-- it sit in the history an editor's later AI call reads as context.
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS author_role TEXT;
