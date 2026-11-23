package observability

import "errors"

// businessRejection is the shape of an owner's business rejection (ADR
// 0006), such as readstate.ErrChanged: it names its own registered code.
type businessRejection interface {
	error
	ErrorCode() string
	ErrorDetails() any
}

// operationCode is the code label of a failed owner operation. An owner's
// table names its own failures; an error it labels as internal that is a
// business rejection is counted with the rejection's registered code, so a
// refusal such as general.changed_since_read (ADR 0311) is no server error.
func operationCode(label string, err error) string {
	if label != "internal_error" && label != "internal" {
		return label
	}
	var rejection businessRejection
	if errors.As(err, &rejection) {
		return rejection.ErrorCode()
	}
	return label
}
