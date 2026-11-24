package api

// seedPreviewAttempts bounds how often a seed sends a command bound to the
// preview of a billing run: the first read and two more after a refusal.
// The contract-conclusion worker starts 70 s after the server and concludes
// every waiting contract in a transaction of its own (#6438), so one tick
// can change the preview of a run more than once.
const seedPreviewAttempts = 3

// seedOnCurrentPreview sends a command bound to the preview of a billing run
// (release, change of an invoice): send carries the fingerprint and the sums
// of the preview read returned. When the run refuses it with
// parent_billing.billing_run_changed, it reads the preview again and sends
// that, as the office does after the refusal. It never builds a fingerprint
// itself and stops after seedPreviewAttempts; the last refusal stays the
// error. Every seed command carrying a billing-run fingerprint goes through
// it, so no step depends on when the worker runs.
func seedOnCurrentPreview[T any](read func() (T, error), send func(T) error) error {
	for attempt := 1; ; attempt++ {
		preview, err := read()
		if err != nil {
			return err
		}
		err = send(preview)
		if attempt == seedPreviewAttempts || !seedConflictCode(err, seedCareRunChanged) {
			return err
		}
	}
}
