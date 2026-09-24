ALTER TABLE watch_evaluations
  ADD COLUMN job_id text;

ALTER TABLE watch_evaluations
  ADD CONSTRAINT watch_evaluation_job_fk
  FOREIGN KEY (account_id, job_id)
  REFERENCES watch_jobs(account_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX watch_evaluations_job_unique_idx
  ON watch_evaluations(account_id, job_id)
  WHERE job_id IS NOT NULL;

UPDATE watch_evaluations evaluation
SET job_id = job.id
FROM watch_jobs job
WHERE evaluation.account_id = job.account_id
  AND job.evaluation_id = evaluation.id
  AND evaluation.job_id IS NULL;
