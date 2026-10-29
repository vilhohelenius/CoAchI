-- Running dynamics averages. Null when the watch did not record them. Filled by the sync fit stage and `sync/run.ts detail`.
ALTER TABLE activities ADD COLUMN avg_stride_m REAL;
ALTER TABLE activities ADD COLUMN avg_vert_osc_mm REAL;
ALTER TABLE activities ADD COLUMN avg_vert_ratio REAL;
ALTER TABLE activities ADD COLUMN avg_gct_ms REAL;
ALTER TABLE activities ADD COLUMN avg_gct_balance REAL;
ALTER TABLE activity_steps ADD COLUMN avg_stride_m REAL;
ALTER TABLE activity_steps ADD COLUMN avg_vert_osc_mm REAL;
ALTER TABLE activity_steps ADD COLUMN avg_vert_ratio REAL;
ALTER TABLE activity_steps ADD COLUMN avg_gct_ms REAL;
ALTER TABLE activity_steps ADD COLUMN avg_gct_balance REAL;
