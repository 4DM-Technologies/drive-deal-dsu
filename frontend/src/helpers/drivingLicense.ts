import { DRIVING_LICENSE_UPLOAD } from '@/config/uploads';

const { maxBytes, mimeTypes, extensions, formatsLabel } = DRIVING_LICENSE_UPLOAD;

/** The `accept` value for the file picker: both MIME types and extensions, since browsers differ on which they honour. */
export const DRIVING_LICENSE_ACCEPT = [...mimeTypes, ...extensions].join(',');

/** Why this file cannot be uploaded as a driving licence, or `null` when it can. */
export function drivingLicenseProblem(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (file.size === 0) return 'That file is empty. Choose a PDF of your licence.';
  if (file.size > maxBytes) return `That file is over ${maxBytes / 1024 / 1024} MB. Choose a smaller one.`;
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  // Some systems report no MIME type for a valid PDF, so a known extension is enough when the type is blank.
  const typeAllowed = file.type ? mimeTypes.includes(file.type.toLowerCase()) : extensions.includes(extension);
  return typeAllowed ? null : `Upload your licence as a ${formatsLabel} file.`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
