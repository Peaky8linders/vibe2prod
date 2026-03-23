import crypto from 'crypto';

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(32).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve({ hash: derivedKey.toString('hex'), salt });
    });
  });
}

export async function verifyPassword(password: string, storedHash: string, salt: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString('hex') === storedHash);
    });
  });
}
