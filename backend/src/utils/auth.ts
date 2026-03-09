import crypto from 'crypto';

/**
 * Generate a secure API key for testing purposes
 */
export function generateApiKey(): string {
  const randomBytes = crypto.randomBytes(32);
  const key = randomBytes.toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 40);
  return key;
}
