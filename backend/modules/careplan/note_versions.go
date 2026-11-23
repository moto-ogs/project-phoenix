package careplan

import "github.com/moto-ogs/project-phoenix/sharedkernel/readstate"

// ArrivalNoteVersion is the read-state token of one arrival note: its day and
// its text (ADR 0311). The note rows carry no updated_at trigger, so the token
// is a fingerprint of what the note editor shows and saves.
func ArrivalNoteVersion(note ArrivalNote) string {
	return careNoteVersion(note.NoteDate.String(), 0, note.Content)
}

// PickupNoteVersion is the read-state token of one pickup note: its day or
// weekday and its text (ADR 0311).
func PickupNoteVersion(note PickupNote) string {
	return careNoteVersion(note.NoteDate.String(), note.Weekday, note.Content)
}

func careNoteVersion(date string, weekday int, content string) string {
	return readstate.Fingerprint(struct {
		Date    string `json:"date"`
		Weekday int    `json:"weekday"`
		Content string `json:"content"`
	}{date, weekday, content})
}
