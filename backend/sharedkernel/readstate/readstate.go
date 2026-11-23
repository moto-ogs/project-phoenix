// Package readstate binds a write to the state its author read (ADR 0311).
//
// A read answers a token of what it shows. A write that depends on it sends
// that token back, and the owner compares it, under the lock it writes
// under, with the token of what is stored now. Only the server knows the
// stored state at the moment of writing, so no reader can replace this
// check by reading again before it writes.
package readstate

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"time"
)

// ChangedCode is the registered wire code of ErrChanged.
const ChangedCode = "general.changed_since_read"

// ErrChanged refuses a write whose author read another state than the one
// stored now. It is a business rejection: the API answers 409 with
// ChangedCode, and the client shows the stored state again.
var ErrChanged error = changed{}

type changed struct{}

func (changed) Error() string { return "changed since it was read" }

// ErrorCode is the registered wire code of the refusal.
func (changed) ErrorCode() string { return ChangedCode }

// ErrorDetails is nil: the refusal names no values.
func (changed) ErrorDetails() any { return nil }

// Absent is the token of a row that is not stored yet. A read that may find
// no row answers it, so the first save is bound as well. It is never the
// token of a stored row.
const Absent = "absent"

// Of is the token of one stored row: the time of its last change. Pass the
// time as the database stores it, never a clock reading the write did not
// store, or the token of the answer and of the next read differ. A zero
// time is no stored change: its token is empty, which Check refuses, so a
// projection that failed to load updated_at cannot pass. Use Absent for a
// row that does not exist yet.
func Of(updatedAt time.Time) string {
	if updatedAt.IsZero() {
		return ""
	}
	return updatedAt.UTC().Format(time.RFC3339Nano)
}

// Fingerprint is the token of state that is not one row: a day's dishes, a
// set of IDs, a computed preview. v is encoded as JSON, so pass it in a
// canonical form (sorted, normalized) wherever its order or spelling may
// vary between two reads of the same state. The digest detects a change;
// it protects nothing, since anyone who may write may also read the token.
func Fingerprint(v any) string {
	encoded, err := json.Marshal(v)
	if err != nil {
		panic(fmt.Sprintf("readstate: fingerprint of %T: %v", v, err))
	}
	digest := fnv.New128a()
	_, _ = digest.Write(encoded)
	return hex.EncodeToString(digest.Sum(nil))
}

// Check refuses with ErrChanged unless expected is current. An empty
// expected token is refused too: a write without a read has nothing to
// compare.
func Check(expected, current string) error {
	if expected == "" || expected != current {
		return ErrChanged
	}
	return nil
}
