package owners

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/jpeg"
	"image/png"
	"testing"
)

func TestLetterLogoImageKeepsEveryImageTheLettersCanShow(t *testing.T) {
	t.Parallel()
	pixel := image.NewRGBA(image.Rect(0, 0, 2, 2))
	var pngData, jpegData bytes.Buffer
	if err := png.Encode(&pngData, pixel); err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(&jpegData, pixel, nil); err != nil {
		t.Fatal(err)
	}
	// A 1×1 lossless WebP, as the login image upload keeps it.
	webpData, err := base64.StdEncoding.DecodeString("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
	if err != nil {
		t.Fatal(err)
	}
	for name, upload := range map[string][]byte{"png": pngData.Bytes(), "jpeg": jpegData.Bytes(), "webp": webpData} {
		if got := letterLogoImage(upload); !bytes.Equal(got, upload) {
			t.Fatalf("a %s logo prints as uploaded", name)
		}
	}
	for _, broken := range [][]byte{[]byte("\x89PNG\r\n\x1a\nrest"), []byte("RIFF....WEBP"), nil} {
		if letterLogoImage(broken) != nil {
			t.Fatalf("%q prints without a logo", broken)
		}
	}
}
