package parent

import (
	"encoding/json"
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The guardian's conversation and group thread type the attachments (#7806)
// but write the bytes the message stores, as they did when they passed the
// snapshot through. The snapshot is communication.MessageAttachment encoded
// with wire.Marshal: identifiers as strings, no width and height for a file.
func TestMessageAttachmentsKeepTheStoredSnapshotOnTheWire(t *testing.T) {
	t.Parallel()
	snapshot := json.RawMessage(`[{"id":"9007199254740993","filename":"basteln.png","size_bytes":4096,"content_type":"image/png","width":640,"height":480},{"id":"5","filename":"brief.pdf","size_bytes":2048,"content_type":"application/pdf"}]`)

	for name, answer := range map[string]any{
		"conversation": ParentMessageResponse{Attachments: toMessageAttachmentResponses(snapshot)},
		"group thread": GroupMessageResponse{Attachments: toMessageAttachmentResponses(snapshot)},
	} {
		encoded, err := wire.Marshal(answer)
		require.NoError(t, err, name)
		var fields map[string]json.RawMessage
		require.NoError(t, json.Unmarshal(encoded, &fields), name)
		assert.JSONEq(t, string(snapshot), string(fields["attachments"]), name)
	}

	for _, empty := range []json.RawMessage{nil, json.RawMessage(`[]`)} {
		encoded, err := wire.Marshal(GroupMessageResponse{Attachments: toMessageAttachmentResponses(empty)})
		require.NoError(t, err)
		assert.NotContains(t, string(encoded), "attachments", "a message without files omits the member")
	}
}
