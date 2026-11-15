package owners

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestLetterLogoImageEmbedsPNGJPEGAndConvertsWebP(t *testing.T) {
	t.Parallel()
	for _, image := range [][]byte{[]byte("\x89PNG\r\n\x1a\nrest"), []byte("\xff\xd8\xff\xe0")} {
		if got := letterLogoImage(image); string(got) != string(image) {
			t.Fatalf("PNG and JPEG print as uploaded, got %q", got)
		}
	}
	// A 1×1 lossless WebP, as the login image upload keeps it.
	webp, err := base64.StdEncoding.DecodeString("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
	if err != nil {
		t.Fatal(err)
	}
	if got := letterLogoImage(webp); !strings.HasPrefix(string(got), "\x89PNG\r\n\x1a\n") {
		t.Fatalf("a WebP logo prints as PNG, got %q", got)
	}
	if letterLogoImage([]byte("RIFF....WEBP")) != nil || letterLogoImage(nil) != nil {
		t.Fatal("broken and empty files print without a logo")
	}
}
