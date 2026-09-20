-- Align relational AutomationRun invariants with the established Phase 7 domain.
-- BLOCKED runs represent policy/kill-switch/unsupported decisions where no
-- execution attempt is made, so max_attempts = 0 is intentional.
ALTER TABLE automation_runs
  DROP CONSTRAINT IF EXISTS automation_runs_max_attempts_check;

ALTER TABLE automation_runs
  ADD CONSTRAINT automation_runs_max_attempts_check
  CHECK (max_attempts >= 0);
