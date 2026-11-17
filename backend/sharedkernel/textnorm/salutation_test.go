package textnorm

import "testing"

func TestGermanFormalName(t *testing.T) {
	t.Parallel()
	cases := []struct{ salutation, first, last, want string }{
		{SalutationMs, "Karin", "Klein", "Frau Klein"},
		{SalutationMr, " Jonas ", " Klein ", "Herr Klein"},
		{"", "Karin", "Klein", "Karin Klein"},
		{"unknown", "Karin", "Klein", "Karin Klein"},
		{SalutationMs, "Karin", "", "Karin"},
		{SalutationMr, "", "", ""},
	}
	for _, c := range cases {
		if got := GermanFormalName(c.salutation, c.first, c.last); got != c.want {
			t.Errorf("GermanFormalName(%q, %q, %q) = %q, want %q", c.salutation, c.first, c.last, got, c.want)
		}
	}
}

func TestValidSalutation(t *testing.T) {
	t.Parallel()
	for value, want := range map[string]bool{"": true, "ms": true, "mr": true, "Frau": false, "diverse": false} {
		if got := ValidSalutation(value); got != want {
			t.Errorf("ValidSalutation(%q) = %v, want %v", value, got, want)
		}
	}
}
