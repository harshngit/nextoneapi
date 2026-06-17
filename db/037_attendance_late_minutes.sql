-- Add late_by_minutes to attendance to track how many minutes after 10:30 an employee checked in
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_by_minutes INTEGER;
