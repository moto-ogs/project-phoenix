package parentbillinghttp

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDecimalEuro(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		cents int64
		want  string
	}{
		{0, "0,00"}, {123450, "1234,50"}, {-123450, "-1234,50"},
		{1, "0,01"}, {-1, "-0,01"}, {123456789, "1234567,89"},
	} {
		assert.Equal(t, tc.want, decimalEuro(tc.cents))
	}
}
