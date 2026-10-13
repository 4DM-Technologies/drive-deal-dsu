import { DEALER_LICENSE_UPLOAD, DRIVING_LICENSE_UPLOAD } from '@/config/uploads';

interface UploadRules {
  maxBytes: number;
  mimeTypes: readonly string[];
  extensions: readonly string[];
  formatsLabel: string;
}

/** The `accept` value for a file picker: both MIME types and extensions, since browsers differ on which they honour. */
const acceptFor = ({ mimeTypes, extensions }: UploadRules) => [...mimeTypes, ...extensions].join(',');

export const DRIVING_LICENSE_ACCEPT = acceptFor(DRIVING_LICENSE_UPLOAD);
export const DEALER_LICENSE_ACCEPT = acceptFor(DEALER_LICENSE_UPLOAD);

/** Why this file cannot be uploaded as the named document, or `null` when it can. */
function documentProblem(file: Pick<File, 'name' | 'type' | 'size'>, rules: UploadRules, documentName: string): string | null {
  const { maxBytes, mimeTypes, extensions, formatsLabel } = rules;
  if (file.size === 0) return `That file is empty. Choose a ${formatsLabel} of your ${documentName}.`;
  if (file.size > maxBytes) return `That file is over ${maxBytes / 1024 / 1024} MB. Choose a smaller one.`;
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  // Some systems report no MIME type for a valid PDF, so a known extension is enough when the type is blank.
  const typeAllowed = file.type ? mimeTypes.includes(file.type.toLowerCase()) : extensions.includes(extension);
  return typeAllowed ? null : `Upload your ${documentName} as a ${formatsLabel} file.`;
}

/** Why this file cannot be uploaded as a driving licence, or `null` when it can. */
export function drivingLicenseProblem(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  return documentProblem(file, DRIVING_LICENSE_UPLOAD, 'licence');
}

/** Why this file cannot be uploaded as a Motor Vehicle Dealer License, or `null` when it can. */
export function dealerLicenseProblem(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  return documentProblem(file, DEALER_LICENSE_UPLOAD, 'Motor Vehicle Dealer License');
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
