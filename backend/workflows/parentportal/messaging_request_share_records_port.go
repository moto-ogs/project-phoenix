package parentportal

import (
	"context"

	"github.com/moto-ogs/project-phoenix/workflows/parentportal/internal/messaging"
)

type RequestShareRecords interface{ messaging.RequestShareRecords }
type RequestShareRecordsCallbacks struct {
	Create             func(pA context.Context, pB *ParentRequestShareEvent) error
	CurrentForStudents func(pA context.Context, pB []int64) ([]*ParentRequestShareEvent, error)
}

func NewRequestShareRecords(c RequestShareRecordsCallbacks) RequestShareRecords {
	return requestShareRecordsBinding{c}
}

type requestShareRecordsBinding struct{ callbacks RequestShareRecordsCallbacks }

func (p requestShareRecordsBinding) Create(pA context.Context, pB *messaging.ParentRequestShareEvent) error {
	return p.callbacks.Create(pA, pB)
}
func (p requestShareRecordsBinding) CurrentForStudents(pA context.Context, pB []int64) ([]*messaging.ParentRequestShareEvent, error) {
	return p.callbacks.CurrentForStudents(pA, pB)
}
