import { ref, get, runTransaction, update, push, set } from 'firebase/database';
import { database } from './firebase';

// Cache configuration
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Maximum number of cached items

interface WalletBalance {
  earnedBalance: number;
  addedBalance: number;
  pendingAddMoney: number;
  totalWithdrawn: number;
}

interface CacheEntry {
  data: any;
  timestamp: number;
  expiry: number;
}

// Interface for user profile to validate permissions
interface UserProfile {
  uid: string;
  email: string;
  role: 'user' | 'admin';
  isBlocked: boolean;
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

// Verify user authorization
const verifyUserAuthorization = async (currentUserId: string, targetUserId: string, requiredRole?: 'admin'): Promise<boolean> => {
  if (!currentUserId || !targetUserId) {
    return false;
  }
  
  if (requiredRole === 'admin') {
    // Check if current user is an admin
    const userRef = ref(database, `users/${currentUserId}`);
    const userSnap = await get(userRef);
    
    if (userSnap.exists()) {
      const userData = userSnap.val() as UserProfile;
      return userData.role === 'admin' && !userData.isBlocked;
    }
    return false;
  }
  
  // For regular operations, user must match target or be admin
  if (currentUserId === targetUserId) return true;
  
  // Check if current user is admin
  const userRef = ref(database, `users/${currentUserId}`);
  const userSnap = await get(userRef);
  
  if (userSnap.exists()) {
    const userData = userSnap.val() as UserProfile;
    return userData.role === 'admin' && !userData.isBlocked;
  }
  
  return false;
};

// Validate wallet data to prevent invalid values
const validateWalletData = (walletData: WalletBalance): boolean => {
  if (!walletData) return false;
  
  // Check for negative values
  if (walletData.earnedBalance < 0 || 
      walletData.addedBalance < 0 || 
      walletData.pendingAddMoney < 0 || 
      walletData.totalWithdrawn < 0) {
    return false;
  }
  
  // Check for reasonable upper limits
  if (walletData.earnedBalance > 10000000 || 
      walletData.addedBalance > 10000000 || 
      walletData.pendingAddMoney > 10000000 || 
      walletData.totalWithdrawn > 10000000) {
    return false;
  }
  
  return true;
};

// Validate transaction data
const validateTransactionData = (transaction: any): boolean => {
  if (!transaction || !transaction.type || !transaction.amount || !transaction.status || !transaction.createdAt) {
    return false;
  }
  
  // Validate transaction type
  const validTypes = ['add_money', 'withdrawal', 'earning', 'campaign_spend'];
  if (!validTypes.includes(transaction.type)) {
    return false;
  }
  
  // Validate amount
  if (typeof transaction.amount !== 'number' || transaction.amount <= 0 || transaction.amount > 100000) {
    return false;
  }
  
  // Validate status
  const validStatuses = ['pending', 'approved', 'rejected', 'paid'];
  if (!validStatuses.includes(transaction.status)) {
    return false;
  }
  
  // Validate timestamp
  if (typeof transaction.createdAt !== 'number' || transaction.createdAt > Date.now() + 60000) { // Allow 1 min future drift
    return false;
  }
  
  return true;
};

// Validate campaign data
const validateCampaignData = (campaignData: any): boolean => {
  if (!campaignData || !campaignData.title || !campaignData.description || !campaignData.creatorId || 
      campaignData.totalWorkers === undefined || campaignData.rewardPerWorker === undefined || 
      campaignData.totalBudget === undefined || campaignData.remainingBudget === undefined || 
      campaignData.createdAt === undefined) {
    return false;
  }
  
  // Validate string fields
  if (typeof campaignData.title !== 'string' || 
      campaignData.title.length < 1 || campaignData.title.length > 100 ||
      typeof campaignData.description !== 'string' ||
      campaignData.description.length < 1 || campaignData.description.length > 1000) {
    return false;
  }
  
  // Validate numeric fields
  if (typeof campaignData.totalWorkers !== 'number' || 
      campaignData.totalWorkers <= 0 || campaignData.totalWorkers > 10000 ||
      typeof campaignData.rewardPerWorker !== 'number' ||
      campaignData.rewardPerWorker < 0.5 || campaignData.rewardPerWorker > 10000 ||
      typeof campaignData.totalBudget !== 'number' ||
      campaignData.totalBudget < 0 ||
      typeof campaignData.remainingBudget !== 'number' ||
      campaignData.remainingBudget < 0 ||
      typeof campaignData.createdAt !== 'number') {
    return false;
  }
  
  // Validate budget consistency
  if (campaignData.remainingBudget > campaignData.totalBudget) {
    return false;
  }
  
  return true;
};

// Atomic wallet operations using Firebase transactions
export const updateWalletBalance = async (
  uid: string, 
  updateFn: (currentBalance: WalletBalance) => Partial<WalletBalance> | null,
  currentUserId?: string
): Promise<WalletBalance | null> => {
  // Verify authorization if currentUserId is provided
  if (currentUserId && !(await verifyUserAuthorization(currentUserId, uid))) {
    throw new Error('Unauthorized: You can only update your own wallet balance');
  }
  
  const walletRef = ref(database, `wallets/${uid}`);
  const cacheKey = `wallet:${uid}`;
  
  try {
    const result = await runTransaction(walletRef, (currentData) => {
      const currentBalance: WalletBalance = currentData || {
        earnedBalance: 0,
        addedBalance: 0,
        pendingAddMoney: 0,
        totalWithdrawn: 0,
      };
      
      const updateValues = updateFn(currentBalance);
      if (updateValues === null) {
        // Return undefined to abort the transaction
        return undefined;
      }
      
      // Apply the updates to the current data
      const updatedBalance = { ...currentBalance, ...updateValues };
      
      // Validate the updated balance before committing
      if (!validateWalletData(updatedBalance)) {
        console.error('Invalid wallet data after update:', updatedBalance);
        return undefined; // Abort transaction
      }
      
      return updatedBalance;
    });
    
    if (result.committed) {
      const finalData = result.snapshot.val();
      
      // Final validation after transaction
      if (!validateWalletData(finalData)) {
        console.error('Invalid wallet data returned from transaction:', finalData);
        throw new Error('Wallet validation failed after update');
      }
      
      // Update cache with new data
      dataCache.set(cacheKey, finalData);
      return finalData;
    } else {
      // Transaction was aborted
      return null;
    }
  } catch (error) {
    console.error('Error updating wallet balance:', error);
    throw error;
  }
};

// Atomic transaction creation and wallet update
export const createTransactionAndAdjustWallet = async (
  uid: string,
  transaction: any,
  walletUpdate: Partial<WalletBalance>,
  currentUserId?: string
): Promise<void> => {
  // Verify authorization if currentUserId is provided
  if (currentUserId && !(await verifyUserAuthorization(currentUserId, uid))) {
    throw new Error('Unauthorized: You can only update your own wallet');
  }
  
  // Validate transaction data before creating
  if (!validateTransactionData(transaction)) {
    throw new Error('Invalid transaction data');
  }
  
  const transactionRef = ref(database, `transactions/${uid}`);
  const walletRef = ref(database, `wallets/${uid}`);
  const cacheKey = `wallet:${uid}`;
  
  try {
    // Create transaction record
    const transRef = await push(transactionRef);
    await set(transRef, transaction);
    
    // Update wallet atomically
    const result = await runTransaction(walletRef, (currentData) => {
      const currentBalance: WalletBalance = currentData || {
        earnedBalance: 0,
        addedBalance: 0,
        pendingAddMoney: 0,
        totalWithdrawn: 0,
      };
      
      // Apply the wallet updates
      const updatedBalance = { ...currentBalance };
      if (walletUpdate.earnedBalance !== undefined) {
        updatedBalance.earnedBalance = currentBalance.earnedBalance + walletUpdate.earnedBalance;
      }
      if (walletUpdate.addedBalance !== undefined) {
        updatedBalance.addedBalance = currentBalance.addedBalance + walletUpdate.addedBalance;
      }
      if (walletUpdate.pendingAddMoney !== undefined) {
        updatedBalance.pendingAddMoney = currentBalance.pendingAddMoney + walletUpdate.pendingAddMoney;
      }
      if (walletUpdate.totalWithdrawn !== undefined) {
        updatedBalance.totalWithdrawn = currentBalance.totalWithdrawn + walletUpdate.totalWithdrawn;
      }
      
      // Ensure no negative balances
      updatedBalance.earnedBalance = Math.max(0, updatedBalance.earnedBalance);
      updatedBalance.addedBalance = Math.max(0, updatedBalance.addedBalance);
      updatedBalance.pendingAddMoney = Math.max(0, updatedBalance.pendingAddMoney);
      updatedBalance.totalWithdrawn = Math.max(0, updatedBalance.totalWithdrawn);
      
      // Validate the updated balance before committing
      if (!validateWalletData(updatedBalance)) {
        console.error('Invalid wallet data after transaction:', updatedBalance);
        return undefined; // Abort transaction
      }
      
      return updatedBalance;
    });
    
    if (result.committed) {
      const finalData = result.snapshot.val();
      
      // Final validation after transaction
      if (!validateWalletData(finalData)) {
        console.error('Invalid wallet data returned from transaction:', finalData);
        throw new Error('Wallet validation failed after transaction');
      }
      
      // Update cache with new data
      dataCache.set(cacheKey, finalData);
    }
  } catch (error) {
    console.error('Error creating transaction and updating wallet:', error);
    throw error;
  }
};

// Utility function for safe campaign budget deduction
export const deductCampaignBudget = async (
  campaignId: string,
  amount: number,
  uid: string,
  currentUserId?: string
): Promise<boolean> => {
  // Verify authorization if currentUserId is provided
  if (currentUserId && !(await verifyUserAuthorization(currentUserId, uid))) {
    throw new Error('Unauthorized: You can only deduct from your own campaigns');
  }
  
  // Validate input parameters
  if (typeof amount !== 'number' || amount <= 0 || amount > 10000000) {
    throw new Error('Invalid amount for campaign budget deduction');
  }
  
  const campaignRef = ref(database, `campaigns/${campaignId}`);
  const walletRef = ref(database, `wallets/${uid}`);
  
  try {
    // Verify that the campaign belongs to the user
    const campaignSnap = await get(campaignRef);
    if (!campaignSnap.exists()) {
      throw new Error('Campaign does not exist');
    }
    
    const campaignData = campaignSnap.val();
    if (campaignData.creatorId !== uid) {
      throw new Error('Unauthorized: You can only deduct from your own campaigns');
    }
    
    // Validate campaign data
    if (!validateCampaignData(campaignData)) {
      throw new Error('Invalid campaign data');
    }
    
    // Update campaign budget atomically
    const campaignResult = await runTransaction(campaignRef, (currentData) => {
      if (!currentData) return undefined; // Abort if campaign doesn't exist
      
      // Validate campaign data during transaction
      if (!validateCampaignData(currentData)) {
        console.error('Invalid campaign data during transaction:', currentData);
        return undefined; // Abort transaction
      }
      
      // Check if there's enough remaining budget
      if (currentData.remainingBudget < amount) {
        return undefined; // Abort transaction
      }
      
      // Deduct from remaining budget
      const updatedCampaign = {
        ...currentData,
        remainingBudget: currentData.remainingBudget - amount
      };
      
      // Validate updated campaign data
      if (!validateCampaignData(updatedCampaign)) {
        console.error('Invalid campaign data after update:', updatedCampaign);
        return undefined; // Abort transaction
      }
      
      return updatedCampaign;
    });
    
    if (campaignResult.committed) {
      // Update user's added balance atomically
      const walletResult = await runTransaction(walletRef, (currentData) => {
        const currentBalance: WalletBalance = currentData || {
          earnedBalance: 0,
          addedBalance: 0,
          pendingAddMoney: 0,
          totalWithdrawn: 0,
        };
        
        // Check if there's enough added balance
        if (currentBalance.addedBalance < amount) {
          return undefined; // Abort transaction
        }
        
        // Deduct from added balance
        const updatedBalance = {
          ...currentBalance,
          addedBalance: currentBalance.addedBalance - amount
        };
        
        // Validate updated wallet data
        if (!validateWalletData(updatedBalance)) {
          console.error('Invalid wallet data after deduction:', updatedBalance);
          return undefined; // Abort transaction
        }
        
        return updatedBalance;
      });
      
      if (walletResult.committed) {
        // Final validation after both transactions
        const finalWalletData = walletResult.snapshot.val();
        if (!validateWalletData(finalWalletData)) {
          console.error('Invalid wallet data returned from transaction:', finalWalletData);
          // Rollback campaign budget if wallet data is invalid
          await update(campaignRef, { remainingBudget: campaignResult.snapshot.val().remainingBudget + amount });
          throw new Error('Wallet validation failed after deduction');
        }
        
        // Invalidate cache
        dataCache.clear(`wallet:${uid}`);
        dataCache.clear(`campaigns:all`);
        return true;
      } else {
        // Rollback campaign budget if wallet update failed
        await update(campaignRef, { remainingBudget: campaignResult.snapshot.val().remainingBudget + amount });
        return false;
      }
    } else {
      return false;
    }
  } catch (error) {
    console.error('Error deducting campaign budget:', error);
    throw error;
  }
};

// Utility function for safe work approval
export const approveWorkAndCredit = async (
  workId: string,
  userId: string,
  campaignId: string,
  reward: number,
  currentAdminId?: string
): Promise<boolean> => {
  // Verify admin authorization
  if (currentAdminId && !(await verifyUserAuthorization(currentAdminId, userId, 'admin'))) {
    throw new Error('Unauthorized: Only admins can approve work');
  }
  
  // Validate input parameters
  if (typeof reward !== 'number' || reward <= 0 || reward > 10000) {
    throw new Error('Invalid reward amount for work approval');
  }
  
  const workRef = ref(database, `works/${userId}/${workId}`);
  const walletRef = ref(database, `wallets/${userId}`);
  const userRef = ref(database, `users/${userId}`);
  
  try {
    // Verify that the work exists and is pending
    const workSnap = await get(workRef);
    if (!workSnap.exists()) {
      throw new Error('Work does not exist');
    }
    
    const workData = workSnap.val();
    if (workData.status !== 'pending') {
      throw new Error('Work is not in pending status');
    }
    
    // Validate work data
    if (typeof workData.reward !== 'number' || workData.reward <= 0 || workData.reward > 10000) {
      throw new Error('Invalid reward in work data');
    }
    
    // Update work status atomically
    const workResult = await runTransaction(workRef, (currentData) => {
      if (!currentData || currentData.status !== 'pending') {
        return undefined; // Abort if work doesn't exist or is not pending
      }
      
      // Validate work data during transaction
      if (typeof currentData.reward !== 'number' || currentData.reward <= 0 || currentData.reward > 10000) {
        console.error('Invalid reward in work data during transaction:', currentData);
        return undefined; // Abort transaction
      }
      
      return {
        ...currentData,
        status: 'approved'
      };
    });
    
    if (workResult.committed) {
      // Update user's earned balance atomically
      const walletResult = await runTransaction(walletRef, (currentData) => {
        const currentBalance: WalletBalance = currentData || {
          earnedBalance: 0,
          addedBalance: 0,
          pendingAddMoney: 0,
          totalWithdrawn: 0,
        };
        
        // Add to earned balance
        const updatedBalance = {
          ...currentBalance,
          earnedBalance: currentBalance.earnedBalance + reward
        };
        
        // Validate updated wallet data
        if (!validateWalletData(updatedBalance)) {
          console.error('Invalid wallet data after work approval:', updatedBalance);
          return undefined; // Abort transaction
        }
        
        return updatedBalance;
      });
      
      if (walletResult.committed) {
        // Update user profile's earned money
        const userSnap = await get(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.val();
          
          // Validate user data before updating
          const currentEarnedMoney = typeof userData.earnedMoney === 'number' ? userData.earnedMoney : 0;
          const currentApprovedWorks = typeof userData.approvedWorks === 'number' ? userData.approvedWorks : 0;
          
          // Validate new values
          if (currentEarnedMoney + reward < 0 || currentApprovedWorks + 1 < 0) {
            throw new Error('Invalid user data values');
          }
          
          await update(userRef, {
            earnedMoney: currentEarnedMoney + reward,
            approvedWorks: currentApprovedWorks + 1
          });
        }
        
        // Final validation after transaction
        const finalWalletData = walletResult.snapshot.val();
        if (!validateWalletData(finalWalletData)) {
          console.error('Invalid wallet data returned from transaction:', finalWalletData);
          // Rollback work status if wallet data is invalid
          await update(workRef, { status: 'pending' });
          // Rollback user profile update
          const userSnap = await get(userRef);
          if (userSnap.exists()) {
            const userData = userSnap.val();
            await update(userRef, {
              earnedMoney: Math.max(0, (userData.earnedMoney || 0) - reward),
              approvedWorks: Math.max(0, (userData.approvedWorks || 0) - 1)
            });
          }
          throw new Error('Wallet validation failed after work approval');
        }
        
        // Invalidate cache
        dataCache.clear(`wallet:${userId}`);
        dataCache.clear(`works:${userId}`);
        return true;
      } else {
        // Rollback work status if wallet update failed
        await update(workRef, { status: 'pending' });
        return false;
      }
    } else {
      return false;
    }
  } catch (error) {
    console.error('Error approving work and crediting:', error);
    throw error;
  }
};

// Utility function for safe money request processing
export const processMoneyRequest = async (
  requestId: string,
  type: 'add_money' | 'withdrawal',
  userId: string,
  amount: number,
  status: 'approved' | 'rejected',
  currentAdminId?: string
): Promise<boolean> => {
  // Verify admin authorization
  if (currentAdminId && !(await verifyUserAuthorization(currentAdminId, userId, 'admin'))) {
    throw new Error('Unauthorized: Only admins can process money requests');
  }
  
  // Validate input parameters
  if (typeof amount !== 'number' || amount <= 0 || 
      (type === 'add_money' && (amount < 10 || amount > 100000)) ||
      (type === 'withdrawal' && (amount < 500 || amount > 50000))) {
    throw new Error('Invalid amount for money request processing');
  }
  
  const requestPath = type === 'add_money' ? 'adminRequests/addMoney' : 'adminRequests/withdrawals';
  const requestRef = ref(database, `${requestPath}/${requestId}`);
  const walletRef = ref(database, `wallets/${userId}`);
  const transactionRef = ref(database, `transactions/${userId}`);
  
  try {
    // Verify that the request exists
    const requestSnap = await get(requestRef);
    if (!requestSnap.exists()) {
      throw new Error('Request does not exist');
    }
    
    const requestData = requestSnap.val();
    if (requestData.status !== 'pending') {
      throw new Error('Request is not in pending status');
    }
    
    // Validate request data
    if (requestData.amount !== amount || requestData.type !== type || requestData.userId !== userId) {
      throw new Error('Request data does not match provided parameters');
    }
    
    // Update request status
    await update(requestRef, { status });
    
    if (status === 'approved') {
      if (type === 'add_money') {
        // Add to addedBalance
        const result = await runTransaction(walletRef, (currentData) => {
          const currentBalance: WalletBalance = currentData || {
            earnedBalance: 0,
            addedBalance: 0,
            pendingAddMoney: 0,
            totalWithdrawn: 0,
          };
          
          // Validate current wallet data
          if (!validateWalletData(currentBalance)) {
            console.error('Invalid wallet data during add money transaction:', currentBalance);
            return undefined; // Abort transaction
          }
          
          const updatedBalance = {
            ...currentBalance,
            addedBalance: currentBalance.addedBalance + amount,
            pendingAddMoney: Math.max(0, currentBalance.pendingAddMoney - amount)
          };
          
          // Validate updated wallet data
          if (!validateWalletData(updatedBalance)) {
            console.error('Invalid wallet data after add money:', updatedBalance);
            return undefined; // Abort transaction
          }
          
          return updatedBalance;
        });
        
        if (result.committed) {
          const finalWalletData = result.snapshot.val();
          
          // Final validation after transaction
          if (!validateWalletData(finalWalletData)) {
            console.error('Invalid wallet data returned from transaction:', finalWalletData);
            // Rollback request status if wallet data is invalid
            await update(requestRef, { status: 'pending' });
            throw new Error('Wallet validation failed after add money');
          }
          
          dataCache.clear(`wallet:${userId}`);
          return true;
        } else {
          // Rollback request status if wallet update failed
          await update(requestRef, { status: 'pending' });
          return false;
        }
      } else {
        // Withdrawal: Deduct from earnedBalance
        const result = await runTransaction(walletRef, (currentData) => {
          const currentBalance: WalletBalance = currentData || {
            earnedBalance: 0,
            addedBalance: 0,
            pendingAddMoney: 0,
            totalWithdrawn: 0,
          };
          
          // Validate current wallet data
          if (!validateWalletData(currentBalance)) {
            console.error('Invalid wallet data during withdrawal transaction:', currentBalance);
            return undefined; // Abort transaction
          }
          
          // Check if user has enough earned balance
          if (currentBalance.earnedBalance < amount) {
            return undefined; // Abort transaction
          }
          
          const updatedBalance = {
            ...currentBalance,
            earnedBalance: currentBalance.earnedBalance - amount,
            totalWithdrawn: currentBalance.totalWithdrawn + amount
          };
          
          // Validate updated wallet data
          if (!validateWalletData(updatedBalance)) {
            console.error('Invalid wallet data after withdrawal:', updatedBalance);
            return undefined; // Abort transaction
          }
          
          return updatedBalance;
        });
        
        if (result.committed) {
          const finalWalletData = result.snapshot.val();
          
          // Final validation after transaction
          if (!validateWalletData(finalWalletData)) {
            console.error('Invalid wallet data returned from transaction:', finalWalletData);
            // Rollback request status if wallet data is invalid
            await update(requestRef, { status: 'pending' });
            throw new Error('Wallet validation failed after withdrawal');
          }
          
          // Update user profile total withdrawn
          const userSnap = await get(ref(database, `users/${userId}`));
          if (userSnap.exists()) {
            const userData = userSnap.val();
            
            // Validate user data before updating
            const currentTotalWithdrawn = typeof userData.totalWithdrawn === 'number' ? userData.totalWithdrawn : 0;
            
            // Validate new value
            if (currentTotalWithdrawn + amount < 0) {
              throw new Error('Invalid total withdrawn value');
            }
            
            await update(ref(database, `users/${userId}`), {
              totalWithdrawn: currentTotalWithdrawn + amount
            });
          }
          
          dataCache.clear(`wallet:${userId}`);
          return true;
        } else {
          // Rollback request status if wallet update failed
          await update(requestRef, { status: 'pending' });
          return false;
        }
      }
    } else {
      // Request was rejected - just update the status
      return true;
    }
  } catch (error) {
    console.error('Error processing money request:', error);
    throw error;
  }
};

// Utility function for applying to a campaign
export const applyToCampaign = async (
  campaignId: string,
  userId: string,
  userName: string,
  reward: number,
  currentUserId?: string
): Promise<boolean> => {
  // Verify user authorization
  if (currentUserId && currentUserId !== userId) {
    throw new Error('Unauthorized: You can only apply to campaigns for yourself');
  }
  
  // Validate input parameters
  if (!campaignId || !userId || !userName || typeof reward !== 'number' || reward <= 0 || reward > 10000) {
    throw new Error('Invalid parameters for campaign application');
  }

  const campaignRef = ref(database, `campaigns/${campaignId}`);
  const workRef = ref(database, `works/${userId}/${campaignId}`);

  try {
    // Check if user has already applied
    const workSnap = await get(workRef);
    if (workSnap.exists()) {
      throw new Error('You have already applied to this campaign');
    }

    // Get campaign data to check availability
    const campaignSnap = await get(campaignRef);
    if (!campaignSnap.exists()) {
      throw new Error('Campaign does not exist');
    }

    const campaignData = campaignSnap.val();
    
    // Validate campaign data
    if (!validateCampaignData(campaignData)) {
      throw new Error('Invalid campaign data');
    }
    
    if (campaignData.status !== 'active') {
      throw new Error('Campaign is not active');
    }

    if (campaignData.completedWorkers >= campaignData.totalWorkers) {
      throw new Error('Campaign is full');
    }

    // Create work entry
    const workData = {
      id: campaignId,
      userId,
      userName,
      campaignId,
      proofUrl: '',
      status: 'pending',
      submittedAt: Date.now(),
      reward,
    };
    
    // Validate work data before creating
    if (typeof workData.reward !== 'number' || workData.reward <= 0 || workData.reward > 10000) {
      throw new Error('Invalid reward in work data');
    }

    await set(workRef, workData);

    // Update campaign completed workers count
    await update(campaignRef, {
      completedWorkers: campaignData.completedWorkers + 1
    });

    // Invalidate cache
    dataCache.clear(`works:${userId}`);
    dataCache.clear(`campaigns:all`);
    dataCache.clear(`campaign:${campaignId}`);

    return true;
  } catch (error) {
    console.error('Error applying to campaign:', error);
    throw error;
  }
};

// Utility function for submitting work for a campaign
export const submitWorkForCampaign = async (
  campaignId: string,
  userId: string,
  proofUrl: string,
  currentUserId?: string
): Promise<boolean> => {
  // Verify user authorization
  if (currentUserId && currentUserId !== userId) {
    throw new Error('Unauthorized: You can only submit work for yourself');
  }
  
  // Validate input parameters
  if (!campaignId || !userId || !proofUrl) {
    throw new Error('Invalid parameters for work submission');
  }
  
  // Validate proof URL
  if (!proofUrl.startsWith('http://') && !proofUrl.startsWith('https://')) {
    throw new Error('Invalid proof URL');
  }

  const workRef = ref(database, `works/${userId}/${campaignId}`);

  try {
    // Verify work exists
    const workSnap = await get(workRef);
    if (!workSnap.exists()) {
      throw new Error('You have not applied to this campaign');
    }

    const workData = workSnap.val();
    if (workData.status !== 'pending' && workData.status !== 'rejected') {
      throw new Error('Work has already been submitted and is awaiting review');
    }
    
    // Validate work data
    if (typeof workData.reward !== 'number' || workData.reward <= 0 || workData.reward > 10000) {
      throw new Error('Invalid reward in work data');
    }

    // Update work with proof
    await update(workRef, {
      proofUrl,
      status: 'pending',
      submittedAt: Date.now(),
    });

    // Invalidate cache
    dataCache.clear(`works:${userId}`);
    dataCache.clear(`works:${userId}:${campaignId}`);

    return true;
  } catch (error) {
    console.error('Error submitting work:', error);
    throw error;
  }
};

// Utility function for rejecting work and updating campaign budget
export const rejectWorkAndRestoreCampaignBudget = async (
  workId: string,
  userId: string,
  campaignId: string,
  currentAdminId?: string
): Promise<boolean> => {
  // Verify admin authorization
  if (currentAdminId && !(await verifyUserAuthorization(currentAdminId, userId, 'admin'))) {
    throw new Error('Unauthorized: Only admins can reject work');
  }
  
  // Validate input parameters
  if (!workId || !userId || !campaignId) {
    throw new Error('Invalid parameters for work rejection');
  }

  const workRef = ref(database, `works/${userId}/${workId}`);
  const campaignRef = ref(database, `campaigns/${campaignId}`);

  try {
    // Get current work data to verify status
    const workSnap = await get(workRef);
    if (!workSnap.exists()) {
      throw new Error('Work does not exist');
    }

    const workData = workSnap.val();
    if (workData.status !== 'pending') {
      throw new Error('Work is not in pending status');
    }
    
    // Validate work data
    if (typeof workData.reward !== 'number' || workData.reward <= 0 || workData.reward > 10000) {
      throw new Error('Invalid reward in work data');
    }

    // Update work status to rejected
    await update(workRef, {
      status: 'rejected'
    });

    // Update campaign completed workers count
    const campaignSnap = await get(campaignRef);
    if (campaignSnap.exists()) {
      const campaignData = campaignSnap.val();
      
      // Validate campaign data
      if (!validateCampaignData(campaignData)) {
        throw new Error('Invalid campaign data');
      }
      
      if (campaignData.completedWorkers > 0) {
        await update(campaignRef, {
          completedWorkers: Math.max(0, campaignData.completedWorkers - 1)
        });
      }
    }

    // Invalidate cache
    dataCache.clear(`works:${userId}`);
    dataCache.clear(`campaigns:all`);
    dataCache.clear(`campaign:${campaignId}`);

    return true;
  } catch (error) {
    console.error('Error rejecting work:', error);
    throw error;
  }
};

<<<<<<< Updated upstream
=======
// Utility function to fetch time-based leaderboard data
export const fetchTimeBasedLeaderboard = async (
  period: 'daily' | 'weekly' | 'monthly'
): Promise<any> => {
  const cacheKey = `leaderboard:${period}`;
  
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
    get(ref(database, 'users')),
    get(ref(database, 'works'))
  ])
    .then(async ([usersSnap, worksSnap]) => {
      if (!usersSnap.exists() || !worksSnap.exists()) {
        return [];
      }

      const usersData = usersSnap.val();
      const worksData = worksSnap.val();
      
      // Calculate time thresholds
      const now = Date.now();
      let timeThreshold = 0;
      
      switch (period) {
        case 'daily':
          timeThreshold = now - (24 * 60 * 60 * 1000); // 24 hours ago
          break;
        case 'weekly':
          timeThreshold = now - (7 * 24 * 60 * 60 * 1000); // 7 days ago
          break;
        case 'monthly':
          timeThreshold = now - (30 * 24 * 60 * 60 * 1000); // 30 days ago
          break;
      }

      // Process works to count approved works by user and time period
      const userWorkCounts: Record<string, number> = {};
      
      for (const [userId, userWorks] of Object.entries(worksData)) {
        if (typeof userWorks === 'object' && userWorks !== null) {
          for (const [workId, workData] of Object.entries(userWorks as Record<string, any>)) {
            const work = workData as any;
            // Validate work data before processing
            if (work && work.status === 'approved' && 
                typeof work.submittedAt === 'number' && 
                work.submittedAt > timeThreshold &&
                work.submittedAt <= now + 60000) { // Allow 1 min future drift
              if (!userWorkCounts[userId]) {
                userWorkCounts[userId] = 0;
              }
              userWorkCounts[userId]++; 
            }
          }
        }
      }

      // Create leaderboard array
      const leaderboard = Object.entries(usersData)
        .map(([uid, userData]: [string, any]) => ({
          uid,
          fullName: typeof userData.fullName === 'string' ? userData.fullName : 'Unknown',
          profileImage: typeof userData.profileImage === 'string' ? userData.profileImage : null,
          approvedWorks: typeof userWorkCounts[uid] === 'number' ? userWorkCounts[uid] : 0,
        }))
        .filter((user: any) => user.approvedWorks > 0)
        .sort((a: any, b: any) => b.approvedWorks - a.approvedWorks)
        .slice(0, 50)
        .map((user: any, index: number) => ({ ...user, rank: index + 1 }));

      dataCache.set(cacheKey, leaderboard);
      return leaderboard;
    })
    .catch((error) => {
      console.error(`Error fetching ${period} leaderboard:`, error);
      throw error;
    })
    .finally(() => {
      dataCache.clearPending(cacheKey);
    });

  dataCache.setPending(cacheKey, promise);
  return promise;
};

>>>>>>> Stashed changes
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