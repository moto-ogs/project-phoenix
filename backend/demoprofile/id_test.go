package demoprofile

import (
	"encoding/json"
	"testing"
)

func TestIDReadsANumberOrADecimalString(t *testing.T) {
	t.Parallel()

	for input, want := range map[string]ID{
		`{"id":42}`:                    42,
		`{"id":"42"}`:                  42,
		`{"id":"9007199254740993"}`:    9007199254740993,
		`{"id":null}`:                  0,
		`{"ids":[1,"2"]}`:              0,
		`{"id":9223372036854775807}`:   9223372036854775807,
		`{"id":"9223372036854775807"}`: 9223372036854775807,
	} {
		var got struct {
			ID  ID   `json:"id"`
			IDs []ID `json:"ids"`
		}
		if err := json.Unmarshal([]byte(input), &got); err != nil {
			t.Fatalf("%s: %v", input, err)
		}
		if got.ID != want {
			t.Errorf("%s: id = %d, want %d", input, got.ID, want)
		}
	}
	for _, input := range []string{`{"id":""}`, `{"id":"4a"}`, `{"id":1.5}`, `{"id":true}`} {
		var got struct {
			ID ID `json:"id"`
		}
		if err := json.Unmarshal([]byte(input), &got); err == nil {
			t.Errorf("%s: no error", input)
		}
	}
}

func TestIDWritesANumber(t *testing.T) {
	t.Parallel()

	raw, err := json.Marshal(struct {
		IDs []ID `json:"ids"`
	}{IDs: []ID{7, 9007199254740993}})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"ids":[7,9007199254740993]}` {
		t.Errorf("got %s", raw)
	}
	if got := IDs([]ID{3, 4}); len(got) != 2 || got[0] != 3 || got[1] != 4 {
		t.Errorf("IDs = %v", got)
	}
}
