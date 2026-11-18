package domain

import "testing"

// A hire always has a birthday. School staff often has none: then the same
// name alone is a reason to ask (#7378), while a different birthday tells
// two people apart.
func TestStaffHireNameMatch(t *testing.T) {
	t.Parallel()
	hire := StaffHire{FirstName: "Lena", LastName: "Okafor", Birthday: "1990-04-12"}
	for name, tc := range map[string]struct {
		first, last, birthday string
		want                  string
	}{
		"same name and birthday":                 {"Lena", "Okafor", "1990-04-12", HireMatchNameBirthday},
		"case and spaces do not matter":          {"  lena ", "OKAFOR", "1990-04-12", HireMatchNameBirthday},
		"same name, the person has no birthday":  {"Lena", "Okafor", "", HireMatchName},
		"a blank birthday is no birthday":        {"Lena", "Okafor", " ", HireMatchName},
		"a different birthday is another person": {"Lena", "Okafor", "1991-04-12", ""},
		"another first name":                     {"Lea", "Okafor", "", ""},
		"another last name":                      {"Lena", "Okafer", "1990-04-12", ""},
	} {
		if got := hire.NameMatch(tc.first, tc.last, tc.birthday); got != tc.want {
			t.Errorf("%s: NameMatch = %q, want %q", name, got, tc.want)
		}
	}
	double := StaffHire{FirstName: "Anna  Maria", LastName: "Schulz", Birthday: "1990-04-12"}
	if got := double.NameMatch("Anna Maria", "Schulz", ""); got != HireMatchName {
		t.Errorf("repeated spaces inside a name: NameMatch = %q, want %q", got, HireMatchName)
	}
}
