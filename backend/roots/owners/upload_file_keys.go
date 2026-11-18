package owners

import nativeUploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"

// UploadFileKeys binds the root's health and bank rings to the object store
// (#3840): sick notes and child health documents seal with HEALTH_DATA_KEYS,
// payslips with BANK_DATA_KEYS. Both rings are required at startup, so a root
// never serves documents it cannot seal or open.
func UploadFileKeys(env RootEnvironment) nativeUploads.FileKeys {
	keys := nativeUploads.FileKeys{}
	if env.HealthData != nil {
		keys.Health = env.HealthData
	}
	if env.BankData != nil {
		keys.Bank = env.BankData
	}
	return keys
}
