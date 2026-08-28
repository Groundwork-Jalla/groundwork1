-- =========================================================
-- 057  What shape should the output take?
--
-- The same brief can be answered as a video or as a slide deck, and which one is right
-- depends on the channel rather than on the content: an investor call wants a deck you
-- can send ahead and talk over; a website or a WhatsApp forward wants a video. The
-- requester knows the channel, so they should get to say.
--
-- Both is a real answer, not a hedge. The contractor brief genuinely needed both — the
-- video for the site and the deck to send before a conversation — and they are built
-- from the same screenshots, so asking for the pair costs one extra pass, not two runs.
--
-- Defaults to 'mp4' because every request filed so far has been a video, and because a
-- default that matches the common case is one fewer decision on a form whose whole point
-- is to be answerable in ninety seconds.
-- =========================================================

ALTER TABLE public.agent_requests
  ADD COLUMN IF NOT EXISTS output_format TEXT NOT NULL DEFAULT 'mp4'
    CHECK (output_format IN ('mp4', 'pptx', 'both'));

COMMENT ON COLUMN public.agent_requests.output_format IS
  'Shape of the deliverable: mp4 video, pptx deck, or both. Chosen by the requester, '
  'who knows the channel; the producer honours it rather than guessing from the brief.';
