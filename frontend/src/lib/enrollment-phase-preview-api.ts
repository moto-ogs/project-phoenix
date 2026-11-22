import {
  fetchEnrollmentPreviewBootstrap,
  type EnrollmentPreviewBootstrap,
} from "~/lib/enrollment-form-schema-api";
import {
  formConfigurationFromContract,
  type PublicEnrollmentBootstrap,
} from "~/lib/enrollment-submission-api";

/** The parent form's configuration of one phase, for the staff preview. */
type PhasePreviewOfferings = Pick<
  PublicEnrollmentBootstrap,
  | "offerings"
  | "care_offering_selection_mode"
  | "school_class"
  | "collect_grade_level"
  | "care_offerings_enabled"
> & { eligible_grade_levels: number[] };

export type PhasePreviewBootstrap = Omit<
  EnrollmentPreviewBootstrap,
  "phase_offerings"
> & {
  phase_offerings?: PhasePreviewOfferings;
};

/**
 * Loads the template and the effective form configuration of one phase,
 * whatever its state (#6044). Its own module because the offering types sit
 * in the submission module, which already imports the schema module.
 */
export async function fetchPhasePreviewBootstrap(params: {
  phaseId: string;
  schemaId?: string | null;
}): Promise<PhasePreviewBootstrap> {
  const { phase_offerings: offerings, ...preview } =
    await fetchEnrollmentPreviewBootstrap(
      params.schemaId
        ? { schemaId: params.schemaId, phaseId: params.phaseId }
        : { base: true, phaseId: params.phaseId },
    );
  if (!offerings) return preview;
  const { schema: _schema, ...configuration } = formConfigurationFromContract({
    ...offerings,
    schema: null,
  });
  return {
    ...preview,
    phase_offerings: {
      ...configuration,
      eligible_grade_levels: offerings.eligible_grade_levels ?? [],
    },
  };
}
