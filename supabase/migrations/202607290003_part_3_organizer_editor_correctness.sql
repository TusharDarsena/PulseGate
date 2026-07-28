-- Organizer wallet binding is a one-time draft initialization step. Content
-- saves may never replace or clear an existing organizer address.
CREATE OR REPLACE FUNCTION public.enforce_initial_draft_organizer_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.intended_organizer_address IS DISTINCT FROM OLD.intended_organizer_address THEN
    IF OLD.intended_organizer_address IS NOT NULL THEN
      RAISE EXCEPTION 'Organizer wallet is already bound for this draft';
    END IF;
    IF NEW.intended_organizer_address IS NULL OR btrim(NEW.intended_organizer_address) = '' THEN
      RAISE EXCEPTION 'An organizer wallet is required for the initial draft binding';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_initial_draft_organizer_binding
  ON public.event_publication_drafts;

CREATE TRIGGER enforce_initial_draft_organizer_binding
BEFORE UPDATE OF intended_organizer_address ON public.event_publication_drafts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_initial_draft_organizer_binding();
