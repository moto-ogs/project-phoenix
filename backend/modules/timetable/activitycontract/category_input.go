package activitycontract

// CategoryInput is a category as its form saves it. ExpectedVersion is the
// version of the category an update replaces (ADR 0311); a create ignores
// it.
type CategoryInput struct {
	Name            string
	Description     string
	Color           string
	ExpectedVersion string
}
