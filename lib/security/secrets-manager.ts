/**
 * v18: Security Hardening - Secrets Manager
 * StandIn Long-Running Task System Production Optimization
 */

import { createHash } from 'crypto';
import { EncryptionService } from './encryption';
import Database, { Database as SqliteDatabase } from 'better-sqlite3';

interface SecretEntry {
  name: string;
  encryptedValue: Buffer;
  createdAt: number;
  updatedAt: number;
  version: number;
}

interface AuditLogEntry {
  timestamp: number;
  action: 'get' | 'set' | 'delete' | 'list';
  secretName: string;
  userId?: string;
  success: boolean;
  ipAddress?: string;
}

/**
 * SecretsManager - Encrypted secret storage with audit logging
 */
export class SecretsManager {
  private db: SqliteDatabase;
  private encryptionService: EncryptionService;
  private auditLogs: AuditLogEntry[] = [];
  private readonly AUDIT_LOG_MAX_SIZE = 10000;
  
  constructor(encryptionService: EncryptionService) {
    this.encryptionService = encryptionService;
    
    // Initialize database (in-memory for testing, file for production)
    const isTestMode = process.env.NODE_ENV === 'test' || process.env.STANDIN_TEST_MODE === 'true';
    const dbPath = isTestMode ? ':memory:' : './data/secrets.db';
    
    this.db = new Database(dbPath);
    this.initializeSchema();
  }
  
  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        value BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        action TEXT NOT NULL,
        secret_name TEXT NOT NULL,
        user_id TEXT,
        success INTEGER NOT NULL,
        ip_address TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_secret ON audit_log(secret_name);
    `);
    
    console.log('[SecretsManager] Database initialized');
  }
  
  /**
   * Store a secret
   */
  async storeSecret(name: string, value: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Encrypt value
      const encrypted = await this.encryptionService.encrypt(Buffer.from(value));
      
      // Check if secret exists
      const existing = this.getSecretRaw(name);
      
      this.db.prepare(`
        INSERT INTO secrets (name, value, created_at, updated_at, version)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          value = ?,
          updated_at = ?,
          version = version + 1
      `).run(
        name,
        encrypted,
        existing?.createdAt ?? startTime,
        startTime,
        (existing?.version ?? 0) + 1,
        encrypted,
        startTime
      );
      
      this.logAudit('set', name, true);
      console.log(`[SecretsManager] Secret stored: ${name}`);
    } catch (error) {
      this.logAudit('set', name, false);
      throw error;
    }
  }
  
  /**
   * Get a secret value
   */
  async getSecret(name: string): Promise<string | null> {
    this.logAudit('get', name, false, 'pending');
    
    const result = this.getSecretRaw(name);
    
    if (!result) {
      this.logAudit('get', name, false);
      return null;
    }
    
    try {
      // Decrypt value
      const decrypted = await this.encryptionService.decrypt(result.encryptedValue);
      
      this.logAudit('get', name, true);
      console.log(`[SecretsManager] Secret retrieved: ${name}`);
      
      return decrypted.toString('utf-8');
    } catch (error) {
      this.logAudit('get', name, false);
      console.error('[SecretsManager] Decryption failed:', error);
      return null;
    }
  }
  
  /**
   * Delete a secret
   */
  async deleteSecret(name: string): Promise<boolean> {
    const existing = this.getSecretRaw(name);
    
    if (!existing) {
      return false;
    }
    
    this.db.prepare('DELETE FROM secrets WHERE name = ?').run(name);
    
    this.logAudit('delete', name, true);
    console.log(`[SecretsManager] Secret deleted: ${name}`);
    
    return true;
  }
  
  /**
   * List all secret names
   */
  async listSecrets(): Promise<string[]> {
    const rows = this.db.prepare('SELECT name FROM secrets ORDER BY name').all() as Array<{ name: string }>;
    
    this.logAudit('list', '*', true);
    console.log(`[SecretsManager] Listed ${rows.length} secrets`);
    
    return rows.map(row => row.name);
  }
  
  /**
   * Raw secret lookup (for internal use)
   */
  private getSecretRaw(name: string): SecretEntry | undefined {
    const row = this.db.prepare('SELECT * FROM secrets WHERE name = ?').get(name) as SecretEntry | undefined;
    return row;
  }
  
  /**
   * Audit log
   */
  private logAudit(action: AuditLogEntry['action'], secretName: string, success: boolean, pending = false): void {
    const entry: AuditLogEntry = {
      timestamp: pending ? Date.now() : Date.now(),
      action,
      secretName,
      success,
      userId: this.getUserId(),
      ipAddress: this.getIpAddress(),
    };
    
    if (!pending) {
      // Insert into database
      this.db.prepare(`
        INSERT INTO audit_log (timestamp, action, secret_name, user_id, success, ip_address)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        entry.timestamp,
        entry.action,
        entry.secretName,
        entry.userId,
        entry.success ? 1 : 0,
        entry.ipAddress
      );
      
      // Add to memory logs
      this.auditLogs.push(entry);
      
      // Trim old logs
      if (this.auditLogs.length > this.AUDIT_LOG_MAX_SIZE) {
        this.auditLogs = this.auditLogs.slice(-this.AUDIT_LOG_MAX_SIZE);
      }
    }
  }
  
  /**
   * Get audit logs
   */
  getAuditLogs(filter?: {
    action?: AuditLogEntry['action'];
    secretName?: string;
    since?: number;
  }): AuditLogEntry[] {
    let logs = [...this.auditLogs];
    
    if (filter?.action) {
      logs = logs.filter(log => log.action === filter.action);
    }
    
    if (filter?.secretName && filter.secretName !== '*') {
      logs = logs.filter(log => log.secretName === filter.secretName);
    }
    
    if (filter?.since) {
      logs = logs.filter(log => log.timestamp >= filter.since);
    }
    
    return logs.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  /**
   * Clear audit logs
   */
  clearAuditLogs(): void {
    this.auditLogs = [];
    this.db.exec('DELETE FROM audit_log');
  }
  
  /**
   * Export full audit history
   */
  exportAuditHistory(): AuditLogEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM audit_log 
      ORDER BY timestamp DESC 
      LIMIT 10000
    `).all() as AuditLogEntry[];
    
    return rows;
  }
  
  /**
   * Generate identifier for current user
   */
  private getUserId(): string {
    return process.env.USER_ID || 'system';
  }
  
  /**
   * Get IP address from environment
   */
  private getIpAddress(): string {
    return process.env.REMOTE_ADDR || process.env.CLIENT_IP || 'unknown';
  }
  
  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}

// Export singleton instance
const testMode = process.env.NODE_ENV === 'test' || process.env.STANDIN_TEST_MODE === 'true';
let secretsManagerInstance: SecretsManager | null = null;

if (!testMode) {
  // Only create instance in non-test mode
  secretsManagerInstance = new SecretsManager(encryptionService);
}

export function getSecretsManager(): SecretsManager {
  if (!secretsManagerInstance) {
    secretsManagerInstance = new SecretsManager(encryptionService);
  }
  return secretsManagerInstance;
}
