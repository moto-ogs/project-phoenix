package readstate

import "errors"

// businessRejection is the shape of an owner's business rejection (ADR
// 0006), such as ErrChanged: it names its own registered code.
type businessRejection interface {
	error
	ErrorCode() string
	ErrorDetails() any
}

// OperationCode is the code label of a failed owner operation in a runtime
// metric. An owner's table names its own failures; an error it labels as
// internal that is a business rejection is counted with the rejection's
// registered code, so a refusal such as ChangedCode is no server error.
// Every operation metric labels its failures through it, so no owner keeps
// a case of its own for the refusal.
func OperationCode(label string, err error) string {
	if label != "internal_error" && label != "internal" {
		return label
	}
	var rejection businessRejection
	if errors.As(err, &rejection) {
		return rejection.ErrorCode()
	}
	return label
}
