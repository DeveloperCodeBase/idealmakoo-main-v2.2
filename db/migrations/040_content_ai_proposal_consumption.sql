-- A proposal may be consumed once even when the reviewed text is unchanged.
-- The existing immutable audit ledger participates in the workspace write
-- transaction, so failed writes roll back both content and consumption.
CREATE UNIQUE INDEX IF NOT EXISTS audit_content_translation_once_idx
ON audit_events ((details->>'proposalId'))
WHERE action='content.translation.applied';
