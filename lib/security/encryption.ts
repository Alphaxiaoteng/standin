/**
 * v18: Security Hardening - Encryption Service
 * StandIn Long-Running Task System Production Optimization
 */

import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'crypto';

interface KeyDerivationConfig {
  password: string;
  salt?: Buffer;
  iterations: number;
  keyLength: number;
}

interface EncryptedData {
  iv: Buffer;
  salt: Buffer;
  cipherText: Buffer;
}

export class EncryptionService {
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly KEY_LENGTH = 32; // 256 bits
  private readonly ITERATIONS = 256000; // PBKDF2 iterations
  private readonly NONCE_SIZE = 12; // GCM nonce size
  
  private masterKey?: Buffer;
  
  /**
   * Generate encryption key from password using PBKDF2
   */
  async generateKey(password: string): Promise<{ key: Buffer; salt: Buffer }> {
    const salt = randomBytes(16);
    
    return new Promise((resolve, reject) => {
      try {
        const key = scryptSync(
          password,
          salt.toString('utf8'),
          this.KEY_LENGTH,
          {
            N: this.ITERATIONS,
            r: 8,
            p: 1,
            maxmem: 64 * 1024 * 1024,
          }
        );
        
        resolve({ key, salt });
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Set master key (must be configured before use)
   */
  setMasterKey(key: Buffer): void {
    if (key.length !== this.KEY_LENGTH) {
      throw new Error(`Master key must be ${this.KEY_LENGTH} bytes`);
    }
    this.masterKey = key;
  }
  
  /**
   * Encrypt data buffer
   */
  async encrypt(data: Buffer): Promise<Buffer> {
    if (!this.masterKey) {
      throw new Error('Master key not set. Call setMasterKey() first.');
    }
    
    try {
      const iv = randomBytes(this.NONCE_SIZE);
      
      const cipher = createCipheriv(this.ALGORITHM, this.masterKey, iv);
      
      let encrypted = cipher.update(data);
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      const authTag = cipher.getAuthTag();
      
      // Package: iv + salt + ciphertext + authTag
      const result = Buffer.concat([iv, encrypted, authTag]);
      
      console.log(`[EncryptionService] Encrypted ${data.length} bytes`);
      return result;
    } catch (error) {
      console.error('[EncryptionService] Encryption failed:', error);
      throw error;
    }
  }
  
  /**
   * Decrypt data buffer
   */
  async decrypt(encryptedData: Buffer): Promise<Buffer> {
    if (!this.masterKey) {
      throw new Error('Master key not set. Call setMasterKey() first.');
    }
    
    try {
      // Extract components
      const iv = encryptedData.slice(0, this.NONCE_SIZE);
      const authTag = encryptedData.slice(-16);
      const encrypted = encryptedData.slice(this.NONCE_SIZE, -16);
      
      const decipher = createDecipheriv(this.ALGORITHM, this.masterKey, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      console.log(`[EncryptionService] Decrypted ${encrypted.length} bytes`);
      return decrypted;
    } catch (error) {
      console.error('[EncryptionService] Decryption failed:', error);
      throw new Error('Decryption failed - invalid data or key');
    }
  }
  
  /**
   * Encrypt plaintext string
   */
  async encryptString(text: string): Promise<string> {
    const data = Buffer.from(text, 'utf-8');
    const encrypted = await this.encrypt(data);
    return encrypted.toString('hex');
  }
  
  /**
   * Decrypt hex string to plaintext
   */
  async decryptString(hexString: string): Promise<string> {
    const data = Buffer.from(hexString, 'hex');
    const decrypted = await this.decrypt(data);
    return decrypted.toString('utf-8');
  }
  
  /**
   * Verify encryption/decryption roundtrip (for testing)
   */
  async verifyRoundtrip(testData: string): Promise<boolean> {
    try {
      const encrypted = await this.encryptString(testData);
      const decrypted = await this.decryptString(encrypted);
      return decrypted === testData;
    } catch {
      return false;
    }
  }
  
  /**
   * Get current algorithm
   */
  getAlgorithm(): string {
    return this.ALGORITHM;
  }
}

// Export singleton instance
export const encryptionService = new EncryptionService();
