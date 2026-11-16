package application

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
)

func (m *Service) observeOfferingStorage(operation, kind string, elapsed time.Duration, inputRows, outputRows int64, err error) {
	if m.offeringStorageObserver != nil {
		m.offeringStorageObserver(enrollment.OfferingStorageObservation{Operation: operation, Kind: kind, Duration: elapsed, InputRows: inputRows, OutputRows: outputRows, Err: err})
	}
}
