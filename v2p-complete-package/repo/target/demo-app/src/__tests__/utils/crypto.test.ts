import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../utils/crypto';

describe('crypto utilities', () => {
  it('hashPassword returns a hash and salt as hex strings', async () => {
    const result = await hashPassword('mypassword123');

    expect(result).toHaveProperty('hash');
    expect(result).toHaveProperty('salt');
    // scrypt with keylen 64 → 128 hex chars; salt is 32 random bytes → 64 hex chars
    expect(result.hash).toMatch(/^[0-9a-f]{128}$/);
    expect(result.salt).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifyPassword returns true for the correct password', async () => {
    const password = 'correcthorsebatterystaple';
    const { hash, salt } = await hashPassword(password);

    const isValid = await verifyPassword(password, hash, salt);
    expect(isValid).toBe(true);
  });

  it('verifyPassword returns false for a wrong password', async () => {
    const { hash, salt } = await hashPassword('rightpassword');

    const isValid = await verifyPassword('wrongpassword', hash, salt);
    expect(isValid).toBe(false);
  });
});
