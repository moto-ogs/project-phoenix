package domain

import "time"

// CleanupRetentionWindow is the fixed retention of a finished staff cleanup
// job (#4046): once it is done, the job keeps only the staff id and the
// stored file name and goes 30 days later.
const CleanupRetentionWindow = 30 * 24 * time.Hour

// FinishedFileCleanupCutoff is the cutoff of the finished staff document
// file cleanups at now on the database clock: the same elapsed 24-hour days
// the guard of users.delete_finished_staff_document_file_cleanups subtracts
// in UTC (1.15.606), not Berlin calendar days of 23 or 25 hours.
func FinishedFileCleanupCutoff(now time.Time, window time.Duration) time.Time {
	return now.Add(-window)
}
