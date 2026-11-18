package textnorm

import "testing"

func TestGermanGreeting(t *testing.T) {
	t.Parallel()
	cases := []struct{ salutation, first, last, want string }{
		{SalutationMs, "Karin", "Klein", "Liebe Karin"},
		{SalutationMr, " Jonas ", " Klein ", "Lieber Jonas"},
		{"", "Karin", "Klein", "Guten Tag Karin Klein"},
		{"unknown", "Karin", "Klein", "Guten Tag Karin Klein"},
		{SalutationMs, "", "Klein", "Guten Tag Klein"},
		{SalutationMr, "", "", "Guten Tag"},
	}
	for _, c := range cases {
		if got := GermanGreeting(c.salutation, c.first, c.last); got != c.want {
			t.Errorf("GermanGreeting(%q, %q, %q) = %q, want %q", c.salutation, c.first, c.last, got, c.want)
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
