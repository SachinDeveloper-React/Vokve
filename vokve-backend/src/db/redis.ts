import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Redis is used for rate limits and the device heartbeat debounce. When no
 * REDIS_URL is set (tests, a laptop without Docker) an in-memory map stands in
 * — same interface, single process only.
 */
export interface KeyValue {
  incrWithTtl(key: string, ttlSeconds: number): Promise<number>;
  setIfAbsent(key: string, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
  quit(): Promise<void>;
}

class MemoryKV implements KeyValue {
  private store = new Map<string, { value: number; expiresAt: number }>();
  private live(key: string) {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt < Date.now()) this.store.delete(key);
    return this.store.get(key);
  }
  async incrWithTtl(key: string, ttlSeconds: number) {
    const entry = this.live(key);
    if (!entry) {
      this.store.set(key, { value: 1, expiresAt: Date.now() + ttlSeconds * 1000 });
      return 1;
    }
    entry.value += 1;
    return entry.value;
  }
  async setIfAbsent(key: string, ttlSeconds: number) {
    if (this.live(key)) return false;
    this.store.set(key, { value: 1, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  }
  async del(key: string) {
    this.store.delete(key);
  }
  async quit() {
    this.store.clear();
  }
}

class RedisKV implements KeyValue {
  constructor(private client: Redis) {}
  async incrWithTtl(key: string, ttlSeconds: number) {
    const value = await this.client.incr(key);
    if (value === 1) await this.client.expire(key, ttlSeconds);
    return value;
  }
  async setIfAbsent(key: string, ttlSeconds: number) {
    const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }
  async del(key: string) {
    await this.client.del(key);
  }
  async quit() {
    await this.client.quit();
  }
}

let kv: KeyValue | null = null;

export function getKV(): KeyValue {
  if (kv) return kv;
  if (env.REDIS_URL && env.NODE_ENV !== 'test') {
    const client = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 2 });
    client.on('error', (err: Error) => logger.warn({ err }, 'redis error'));
    kv = new RedisKV(client);
  } else {
    kv = new MemoryKV();
  }
  return kv;
}
