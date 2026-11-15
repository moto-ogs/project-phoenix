package communication

import (
	"regexp"
	"sort"
	"strings"

	"github.com/moto-ogs/project-phoenix/sharedkernel/collation"
)

// Serienbriefe (#4813): an Elternbrief of the school may name each child
// with its own values. A placeholder is written {{name}}; the list below is
// fixed and holds no health data. A letter is filled once per child when it
// is published and stays as it was then (ParentLetterCopy).

// ParentLetterPlaceholder is a value a letter can name for each child.
// Example is what the composer shows beside it.
type ParentLetterPlaceholder struct {
	Name    string `json:"name"`
	Label   string `json:"label"`
	Example string `json:"example"`
}

const (
	letterPlaceholderFirstName  = "vorname"
	letterPlaceholderLastName   = "nachname"
	letterPlaceholderClass      = "klasse"
	letterPlaceholderGroup      = "gruppe"
	letterPlaceholderCareDays   = "betreuungstage"
	letterPlaceholderPickupTime = "abholzeit"
)

var parentLetterPlaceholders = []ParentLetterPlaceholder{
	{Name: letterPlaceholderFirstName, Label: "Vorname", Example: "Lina"},
	{Name: letterPlaceholderLastName, Label: "Nachname", Example: "Muster"},
	{Name: letterPlaceholderClass, Label: "Klasse", Example: "Klasse 3a"},
	{Name: letterPlaceholderGroup, Label: "Gruppe", Example: "Füchse"},
	{Name: letterPlaceholderCareDays, Label: "Betreuungstage", Example: "Montag, Dienstag und Donnerstag"},
	{Name: letterPlaceholderPickupTime, Label: "Abholzeit", Example: "15:30 Uhr"},
}

// ParentLetterPlaceholders lists the placeholders of a parent letter in the
// order the composer offers them.
func ParentLetterPlaceholders() []ParentLetterPlaceholder {
	return append([]ParentLetterPlaceholder(nil), parentLetterPlaceholders...)
}

// ParentLetterChild is what a letter can say about one child. Empty values
// print nothing.
type ParentLetterChild struct {
	StudentID   int64  `json:"student_id"`
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	SchoolClass string `json:"school_class"`
	Group       string `json:"group"`
	CareDays    string `json:"care_days"`
	PickupTime  string `json:"pickup_time"`
}

func (c ParentLetterChild) value(name string) string {
	switch name {
	case letterPlaceholderFirstName:
		return c.FirstName
	case letterPlaceholderLastName:
		return c.LastName
	case letterPlaceholderClass:
		// The school spells its classes "3a" or "Klasse 3a"; the letter
		// always reads "Klasse 3a".
		return collation.SchoolClassLabel(c.SchoolClass)
	case letterPlaceholderGroup:
		return c.Group
	case letterPlaceholderCareDays:
		return c.CareDays
	case letterPlaceholderPickupTime:
		return c.PickupTime
	}
	return ""
}

var (
	letterPlaceholderPattern = regexp.MustCompile(`\{\{\s*([^{}]*?)\s*\}\}`)
	// letterStrayBrace finds what is left of a placeholder written wrongly,
	// such as {{vorname} or {klasse}}, after the complete ones are removed.
	letterStrayBrace = regexp.MustCompile(`\S*[{}]\S*`)
)

func knownLetterPlaceholder(name string) bool {
	for _, p := range parentLetterPlaceholders {
		if p.Name == name {
			return true
		}
	}
	return false
}

// HasParentLetterPlaceholders reports whether text names any placeholder.
func HasParentLetterPlaceholders(text string) bool {
	return letterPlaceholderPattern.MatchString(text)
}

// UnknownParentLetterPlaceholders lists, sorted and once each, the
// placeholders of text that are not in the list and every placeholder
// written wrongly, as it stands in the text. Names are matched in lower
// case, so {{ Klasse }} is {{klasse}}.
func UnknownParentLetterPlaceholders(text string) []string {
	unknown := map[string]bool{}
	for _, match := range letterPlaceholderPattern.FindAllStringSubmatch(text, -1) {
		name := strings.ToLower(match[1])
		if name == "" || !knownLetterPlaceholder(name) {
			unknown[cmpOrText(name, match[0])] = true
		}
	}
	for _, stray := range letterStrayBrace.FindAllString(letterPlaceholderPattern.ReplaceAllString(text, " "), -1) {
		unknown[stray] = true
	}
	names := make([]string, 0, len(unknown))
	for name := range unknown {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func cmpOrText(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

// FillParentLetter writes the values of one child into text. A line whose
// placeholders all print nothing is left out, so a missing pickup time
// leaves no "Abholzeit:" behind; any other line keeps its words.
func FillParentLetter(text string, child ParentLetterChild) string {
	if !HasParentLetterPlaceholders(text) {
		return text
	}
	lines := strings.Split(text, "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		used, filled := 0, 0
		out := letterPlaceholderPattern.ReplaceAllStringFunc(line, func(match string) string {
			used++
			value := strings.TrimSpace(child.value(strings.ToLower(letterPlaceholderPattern.FindStringSubmatch(match)[1])))
			if value != "" {
				filled++
			}
			return value
		})
		if used > 0 && filled == 0 {
			continue
		}
		kept = append(kept, out)
	}
	return strings.Join(kept, "\n")
}

// ParentLetterPlaceholderError refuses a text whose placeholders a letter
// cannot fill: Names lists the unknown or broken ones. LetterOnly reports
// placeholders in an announcement that is no Elternbrief, or in the title of
// one; only the body of a letter is written once per child.
type ParentLetterPlaceholderError struct {
	Names      []string
	LetterOnly bool
}

func (e *ParentLetterPlaceholderError) Error() string {
	if e.LetterOnly {
		return "placeholders are only filled in the text of an Elternbrief"
	}
	return "unknown placeholders: " + strings.Join(e.Names, ", ")
}

// CheckParentLetterPlaceholders accepts the title and body of an
// announcement: a letter may name the placeholders of the list in its body,
// every other text names none.
func CheckParentLetterPlaceholders(letter bool, title, body string) error {
	if !letter {
		if HasParentLetterPlaceholders(title) || HasParentLetterPlaceholders(body) {
			return &ParentLetterPlaceholderError{LetterOnly: true}
		}
		return nil
	}
	if HasParentLetterPlaceholders(title) {
		return &ParentLetterPlaceholderError{LetterOnly: true}
	}
	if names := UnknownParentLetterPlaceholders(body); len(names) > 0 {
		return &ParentLetterPlaceholderError{Names: names}
	}
	return nil
}
