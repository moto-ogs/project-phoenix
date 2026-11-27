package application

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

func TestMissingNumbersAreWrittenLikeTheDocumentBesideTheGap(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name        string
		gap         parentbilling.JournalNumberGap
		first, last string
	}{
		{"between two documents", parentbilling.JournalNumberGap{FirstMissing: 5, MissingCount: 2, AfterNumber: "FE-2026-0004", BeforeNumber: "FE-2026-0007"},
			"FE-2026-0005", "FE-2026-0006"},
		{"one number after the last document", parentbilling.JournalNumberGap{FirstMissing: 246, MissingCount: 1, AfterNumber: "FE-2026-0245"},
			"FE-2026-0246", "FE-2026-0246"},
		{"before the first document", parentbilling.JournalNumberGap{FirstMissing: 1, MissingCount: 3, BeforeNumber: "MB-0004"}, "MB-0001", "MB-0003"},
		{"a number that outgrows its leading zeros", parentbilling.JournalNumberGap{FirstMissing: 10, MissingCount: 1, AfterNumber: "R9"}, "R10", "R10"},
		{"a document that does not end with its running number", parentbilling.JournalNumberGap{FirstMissing: 5, MissingCount: 1, AfterNumber: "0004/2026"}, "", ""},
		{"the document after the gap, when the one before cannot be read", parentbilling.JournalNumberGap{FirstMissing: 5, MissingCount: 2, AfterNumber: "0004/2026", BeforeNumber: "FE-0007"},
			"FE-0005", "FE-0006"},
		{"a document without digits at its end", parentbilling.JournalNumberGap{FirstMissing: 5, MissingCount: 1, AfterNumber: "FE-0004-A"}, "", ""},
	}
	for _, c := range cases {
		first, last := missingNumbers(c.gap)
		assert.Equal(t, c.first, first, c.name)
		assert.Equal(t, c.last, last, c.name)
	}
}
