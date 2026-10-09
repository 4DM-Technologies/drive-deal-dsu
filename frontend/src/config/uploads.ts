/** The signup form takes the driving licence as a PDF only. The API is more lenient (it also reads photos) and re-checks the file itself, so these only save a round trip. */
export const DRIVING_LICENSE_UPLOAD = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  mimeTypes: ['application/pdf'],
  extensions: ['.pdf'],
  formatsLabel: 'PDF',
});
