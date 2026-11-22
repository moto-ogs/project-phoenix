package common_test

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// answerEncoders are the calls that write an answer with encoding/json and so
// send every ident.ID as a JSON number. Answers go through render.Respond
// (common.Respond, render.Render), common.RenderJSON or package wire
// (ADR 0300, addendum).
var answerEncoders = regexp.MustCompile(`\brender\.JSON\(|json\.NewEncoder\(w\)`)

// TestAnswersWriteIdentifiersAsStrings fails on a production file that encodes
// an answer around package wire. Test support (api/testutil) answers stubs and
// is not scanned.
func TestAnswersWriteIdentifiersAsStrings(t *testing.T) {
	t.Parallel()
	root := backendRoot(t)
	var violations []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		if entry.IsDir() {
			if strings.HasPrefix(entry.Name(), ".") || rel == "api/testutil" || entry.Name() == "testdata" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") || strings.HasPrefix(rel, "api/common/") {
			return nil
		}
		source, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for i, line := range strings.Split(string(source), "\n") {
			// Error bodies carry no identifier; their envelope has its own scan.
			if answerEncoders.MatchString(line) && !strings.Contains(line, "Problem{") {
				violations = append(violations, rel+":"+strconv.Itoa(i+1)+": "+strings.TrimSpace(line))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) > 0 {
		t.Errorf("%d answer(s) bypass the identifier encoding; use common.RenderJSON or package wire:\n%s", len(violations), strings.Join(violations, "\n"))
	}
}
