package absencerecords

import "errors"

// ErrExcusedRequestNotPending means a pending-row transition lost a race or the
// row was already terminal under the caller's tenant.
var ErrExcusedRequestNotPending = errors.New("active: excused absence request is not pending")

// ErrExcusedRequestNotFound means no row with the requested id exists in the
// caller's tenant.
var ErrExcusedRequestNotFound = errors.New("active: excused absence request not found")

// ErrExcusedRequestNotDecided means a correction was attempted on a row that
// carries no decision to correct — still pending, or already closed some other
// way (withdrawn, care ended, marked done).
var ErrExcusedRequestNotDecided = errors.New("active: excused absence request is not decided")
