
ALTER TABLE public.prayer_participants ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'participant';
