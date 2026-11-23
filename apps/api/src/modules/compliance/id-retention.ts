import { REGISTRATION_ID_RETENTION_DAYS, type RegistrationStatus } from "@leadanchor/contracts";
import { addDays } from "../../lib/time";

/**
 * C-43 AC 6: the full EIN and date of birth are kept only while the registration needs them. They
 * go 30 days after the carriers approve it, 30 days after they turn it down, or 30 days after the
 * owner stopped at the mobile check. While the carriers are still reviewing, they stay.
 */
export function idDeleteAfterOf(row: {
  status: RegistrationStatus;
  approvedAt: Date | null;
  updatedAt: Date;
}): Date | null {
  switch (row.status) {
    case "approved":
      return row.approvedAt ? addDays(row.approvedAt, REGISTRATION_ID_RETENTION_DAYS) : null;
    case "rejected":
    case "verify_mobile":
      return addDays(row.updatedAt, REGISTRATION_ID_RETENTION_DAYS);
    default:
      return null;
  }
}
