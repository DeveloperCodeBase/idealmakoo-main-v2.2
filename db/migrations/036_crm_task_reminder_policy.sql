-- Actual delivery state is distinct from enqueueing. Existing accepted reminders
-- retain their history and are never re-enqueued by this migration.
ALTER TABLE crm_task_occurrences
  DROP CONSTRAINT crm_task_occurrences_reminder_state_check,
  ADD COLUMN reminder_outbox_id text REFERENCES outbox(id),
  ADD CONSTRAINT crm_task_occurrences_reminder_state_check
    CHECK(reminder_state IN ('pending','queued','delivered','cancelled','failed','uncertain')),
  ADD CONSTRAINT crm_task_occurrences_queued_delivery_check
    CHECK(reminder_state<>'queued' OR (reminder_outbox_id IS NOT NULL AND reminded_at IS NULL));

CREATE UNIQUE INDEX crm_task_reminder_outbox ON crm_task_occurrences(reminder_outbox_id)
  WHERE reminder_outbox_id IS NOT NULL;
