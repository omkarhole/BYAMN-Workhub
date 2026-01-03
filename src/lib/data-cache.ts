import { ref, get } from 'firebase/database';
import { database } from './firebase';

// Cache configuration
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Maximum number of cached items

interface CacheEntry {
  data: any;
  timestamp: number;
  expiry: number;
}

class DataCache {
  private cache: Map<string, CacheEntry>;
  private pendingRequests: Map<string, Promise<any>>;

  constructor() {
    this.cache = new Map();
    this.pendingRequests = new Map();
  }

  // Get data from cache if it's still valid
  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  // Set data in cache
  set(key: string, data: any): void {
    // Remove oldest entries if cache is full
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiry: Date.now() + CACHE_DURATION,
    });
  }

  // Clear specific cache entry
  clear(key: string): void {
    this.cache.delete(key);
  }

  // Clear all cache
  clearAll(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  // Check if data is being fetched
  isFetching(key: string): boolean {
    return this.pendingRequests.has(key);
  }

  // Get pending request
  getPending(key: string): Promise<any> | undefined {
    return this.pendingRequests.get(key);
  }

  // Set pending request
  setPending(key: string, promise: Promise<any>): void {
    this.pendingRequests.set(key, promise);
  }

  // Clear pending request
  clearPending(key: string): void {
    this.pendingRequests.delete(key);
  }
  
  // Get all cache keys
  getCacheKeys(): string[] {
    return Array.from(this.cache.keys());
  }
}

// Global cache instance
export const dataCache = new DataCache();

// Utility functions for common data fetching operations
export const fetchUserData = async (uid: string): Promise<any> => {
  const cacheKey = `user:${uid}`;
  
  // Check cache first
  const cached = dataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Check if already fetching
  if (dataCache.isFetching(cacheKey)) {
    return dataCache.getPending(cacheKey);
  }

  // Fetch data
  const promise = get(ref(database, `users/${uid}`))
    .then((snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        dataCache.set(cacheKey, data);
        return data;
      }
      return null;
    })
    .catch((error) => {
      console.error('Error fetching user data:', error);
      throw error;
    })
    .finally(() => {
      dataCache.clearPending(cacheKey);
    });

  dataCache.setPending(cacheKey, promise);
  return promise;
};

export const fetchWalletData = async (uid: string): Promise<any> => {
  const cacheKey = `wallet:${uid}`;
  
  // Check cache first
  const cached = dataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Check if already fetching
  if (dataCache.isFetching(cacheKey)) {
    return dataCache.getPending(cacheKey);
  }

  // Fetch data
  const promise = get(ref(database, `wallets/${uid}`))
    .then((snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        dataCache.set(cacheKey, data);
        return data;
      }
      return null;
    })
    .catch((error) => {
      console.error('Error fetching wallet data:', error);
      throw error;
    })
    .finally(() => {
      dataCache.clearPending(cacheKey);
    });

  dataCache.setPending(cacheKey, promise);
  return promise;
};

export const fetchTransactions = async (uid: string): Promise<any> => {
  const cacheKey = `transactions:${uid}`;
  
  // Check cache first
  const cached = dataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Check if already fetching
  if (dataCache.isFetching(cacheKey)) {
    return dataCache.getPending(cacheKey);
  }

  // Fetch data
  const promise = get(ref(database, `transactions/${uid}`))
    .then((snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        dataCache.set(cacheKey, data);
        return data;
      }
      return [];
    })
    .catch((error) => {
      console.error('Error fetching transactions:', error);
      throw error;
    })
    .finally(() => {
      dataCache.clearPending(cacheKey);
    });

  dataCache.setPending(cacheKey, promise);
  return promise;
};

export const fetchCampaigns = async (): Promise<any> => {
  const cacheKey = `campaigns:all`;
  
  // Check cache first
  const cached = dataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Check if already fetching
  if (dataCache.isFetching(cacheKey)) {
    return dataCache.getPending(cacheKey);
  }

  // Fetch data
  const promise = get(ref(database, `campaigns`))
    .then((snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        dataCache.set(cacheKey, data);
        return data;
      }
      return {};
    })
    .catch((error) => {
      console.error('Error fetching campaigns:', error);
      throw error;
    })
    .finally(() => {
      dataCache.clearPending(cacheKey);
    });

  dataCache.setPending(cacheKey, promise);
  return promise;
};

export const fetchWorks = async (uid: string): Promise<any> => {
  const cacheKey = `works:${uid}`;
  
  // Check cache first
  const cached = dataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Check if already fetching
  if (dataCache.isFetching(cacheKey)) {
    return dataCache.getPending(cacheKey);
  }

  // Fetch data
  const promise = get(ref(database, `works/${uid}`))
    .then((snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        dataCache.set(cacheKey, data);
        return data;
      }
      return {};
    })
    .catch((error) => {
      console.error('Error fetching works:', error);
      throw error;
    })
    .finally(() => {
      dataCache.clearPending(cacheKey);
    });

  dataCache.setPending(cacheKey, promise);
  return promise;
};

export const fetchAdminData = async (): Promise<any> => {
  const cacheKey = `admin:data`;
  
  // Check cache first
  const cached = dataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Check if already fetching
  if (dataCache.isFetching(cacheKey)) {
    return dataCache.getPending(cacheKey);
  }

  // Fetch data
  const promise = Promise.all([
    get(ref(database, `users`)),
    get(ref(database, `campaigns`)),
    get(ref(database, `works`)),
    get(ref(database, `adminRequests/addMoney`)),
    get(ref(database, `adminRequests/withdrawals`)),
  ])
    .then(([users, campaigns, works, addMoneyRequests, withdrawalRequests]) => {
      const result = {
        users: users.exists() ? users.val() : {},
        campaigns: campaigns.exists() ? campaigns.val() : {},
        works: works.exists() ? works.val() : {},
        addMoneyRequests: addMoneyRequests.exists() ? addMoneyRequests.val() : {},
        withdrawalRequests: withdrawalRequests.exists() ? withdrawalRequests.val() : {},
      };
      
      dataCache.set(cacheKey, result);
      return result;
    })
    .catch((error) => {
      console.error('Error fetching admin data:', error);
      throw error;
    })
    .finally(() => {
      dataCache.clearPending(cacheKey);
    });

  dataCache.setPending(cacheKey, promise);
  return promise;
};

// Utility to clear specific cache entries when data is updated
export const invalidateCache = (keyPattern: string): void => {
  const keys = dataCache.getCacheKeys();
  for (const key of keys) {
    if (key.includes(keyPattern)) {
      dataCache.clear(key);
    }
  }
};

// Clear user-specific cache when user data is updated
export const invalidateUserCache = (uid: string): void => {
  invalidateCache(`user:${uid}`);
  invalidateCache(`wallet:${uid}`);
  invalidateCache(`transactions:${uid}`);
  invalidateCache(`works:${uid}`);
};

// Clear all caches related to a specific user
export const clearUserCache = (uid: string): void => {
  dataCache.clear(`user:${uid}`);
  dataCache.clear(`wallet:${uid}`);
  dataCache.clear(`transactions:${uid}`);
  dataCache.clear(`works:${uid}`);
};