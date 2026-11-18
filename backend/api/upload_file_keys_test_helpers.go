//go:build testhooks

package api

import (
	"bytes"
	"encoding/base64"
	"sync"

	nativeUploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"
)

var testUploadFileKeys = sync.OnceValue(func() nativeUploads.FileKeys {
	// Synthetic, non-secret test rings: each key is one repeated byte.
	ring := func(id string, fill byte) string {
		return id + ":" + base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{fill}, 32))
	}
	health, err := HealthDataCipher(ring("test-health", 0x48))
	if err != nil {
		panic(err)
	}
	bank, err := BankDataCipher(ring("test-bank", 0x42), "")
	if err != nil {
		panic(err)
	}
	return nativeUploads.FileKeys{Health: health, Bank: bank}
})

// TestUploadFileKeys binds one pair of synthetic health and bank rings to the
// object store, as the roots bind HEALTH_DATA_KEYS and BANK_DATA_KEYS
// (#3840). This package cannot import the shared test keys.
func TestUploadFileKeys() nativeUploads.FileKeys { return testUploadFileKeys() }
