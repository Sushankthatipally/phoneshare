import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ADJECTIVES = [
  'Tidy', 'Fantastic', 'Quiet', 'Bright', 'Eager', 'Gentle', 'Brave', 'Calm',
  'Clever', 'Cosmic', 'Crisp', 'Dapper', 'Daring', 'Dashing', 'Dazzling', 'Dreamy',
  'Drifting', 'Earnest', 'Easy', 'Electric', 'Endless', 'Fierce', 'Floating', 'Fluffy',
  'Friendly', 'Frosty', 'Gleaming', 'Glowing', 'Golden', 'Graceful', 'Happy', 'Hidden',
  'Honest', 'Humble', 'Jolly', 'Jovial', 'Kind', 'Lively', 'Lucky', 'Lush',
  'Magic', 'Mellow', 'Merry', 'Mighty', 'Misty', 'Mystic', 'Nimble', 'Noble',
  'Plucky', 'Polished', 'Proud', 'Quick', 'Quirky', 'Radiant', 'Rapid', 'Restless',
  'Royal', 'Rustic', 'Savvy', 'Serene', 'Sharp', 'Shiny', 'Silent', 'Silver',
  'Smooth', 'Snappy', 'Sparkling', 'Spry', 'Steady', 'Stellar', 'Sturdy', 'Sunny',
  'Swift', 'Tame', 'Tender', 'Timid', 'Trusty', 'Vivid', 'Warm', 'Wise',
];

const NOUNS = [
  'Strawberry', 'Lettuce', 'Forest', 'Comet', 'Harbor', 'Lantern', 'Aurora', 'Badger',
  'Basket', 'Bay', 'Beacon', 'Berry', 'Birch', 'Blossom', 'Boulder', 'Branch',
  'Breeze', 'Brook', 'Cactus', 'Canyon', 'Cedar', 'Cherry', 'Cliff', 'Cloud',
  'Coast', 'Cove', 'Crane', 'Crescent', 'Crystal', 'Daisy', 'Dawn', 'Delta',
  'Drift', 'Dune', 'Eagle', 'Ember', 'Falcon', 'Fern', 'Field', 'Finch',
  'Flame', 'Foxglove', 'Garden', 'Geyser', 'Glacier', 'Glade', 'Granite', 'Grove',
  'Harvest', 'Heron', 'Hollow', 'Horizon', 'Island', 'Ivy', 'Juniper', 'Lagoon',
  'Lake', 'Lily', 'Lynx', 'Maple', 'Marsh', 'Meadow', 'Mesa', 'Mirage',
  'Moss', 'Mountain', 'Nebula', 'Olive', 'Orchard', 'Otter', 'Owl', 'Peak',
  'Pebble', 'Pine', 'Plateau', 'Pond', 'Quartz', 'Raven', 'Reef', 'Ridge',
];

// Lightweight deterministic 32-bit hash; avoids react-native-quick-crypto so
// this helper stays usable before the connection layer has initialized.
function djb2(input: string, salt: string): number {
  let hash = 5381;
  const combined = `${input}|${salt}`;
  for (let i = 0; i < combined.length; i += 1) {
    hash = ((hash << 5) + hash + combined.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function generateFriendlyName(seed: string): string {
  if (!seed) return 'Unnamed Device';
  const adj = ADJECTIVES[djb2(seed, 'adj') % ADJECTIVES.length];
  const noun = NOUNS[djb2(seed, 'noun') % NOUNS.length];
  return `${adj} ${noun}`;
}

export function generateRandomFriendlyName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

export function computeHashtag(seed: string): string {
  if (!seed) return '#0000';
  const hex = djb2(seed, 'hashtag').toString(16).padStart(8, '0');
  return `#${hex.slice(0, 4)}`;
}

const STORAGE_KEY_NAME = '@dropbeam/friendly-name';
const STORAGE_KEY_QUICKSAVE = '@dropbeam/quick-save';
const STORAGE_KEY_FAVORITES = '@dropbeam/favorites';

export type QuickSaveValue = 'off' | 'favorites' | 'on';

export interface MobileIdentity {
  friendlyName: string;
  hashtag: string;
  quickSave: QuickSaveValue;
  favorites: string[];
  hydrated: boolean;
}

export interface MobileIdentityActions {
  setFriendlyName: (next: string) => Promise<void>;
  regenerateName: () => Promise<void>;
  setQuickSave: (next: QuickSaveValue) => Promise<void>;
  toggleFavorite: (fingerprint: string) => Promise<void>;
  isFavorite: (fingerprint: string) => boolean;
}

export function useMobileIdentity(deviceFingerprint: string): MobileIdentity & MobileIdentityActions {
  const [friendlyName, setFriendlyNameState] = useState(() => generateFriendlyName(deviceFingerprint));
  const [quickSave, setQuickSaveState] = useState<QuickSaveValue>('off');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const hashtag = computeHashtag(deviceFingerprint);

  useEffect(() => {
    if (!deviceFingerprint) return;
    let cancelled = false;
    (async () => {
      try {
        const [storedName, storedQS, storedFavs] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_NAME),
          AsyncStorage.getItem(STORAGE_KEY_QUICKSAVE),
          AsyncStorage.getItem(STORAGE_KEY_FAVORITES),
        ]);
        if (cancelled) return;
        if (storedName) setFriendlyNameState(storedName);
        else setFriendlyNameState(generateFriendlyName(deviceFingerprint));
        if (storedQS === 'off' || storedQS === 'favorites' || storedQS === 'on') {
          setQuickSaveState(storedQS);
        }
        if (storedFavs) {
          try {
            const parsed = JSON.parse(storedFavs);
            if (Array.isArray(parsed)) setFavorites(parsed.filter((s) => typeof s === 'string'));
          } catch {
            /* corrupt — ignore */
          }
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceFingerprint]);

  const setFriendlyName = useCallback(async (next: string) => {
    const trimmed = next.trim().slice(0, 64);
    if (!trimmed) return;
    setFriendlyNameState(trimmed);
    await AsyncStorage.setItem(STORAGE_KEY_NAME, trimmed);
  }, []);

  const regenerateName = useCallback(async () => {
    const next = generateRandomFriendlyName();
    setFriendlyNameState(next);
    await AsyncStorage.setItem(STORAGE_KEY_NAME, next);
  }, []);

  const setQuickSave = useCallback(async (next: QuickSaveValue) => {
    setQuickSaveState(next);
    await AsyncStorage.setItem(STORAGE_KEY_QUICKSAVE, next);
  }, []);

  const toggleFavorite = useCallback(
    async (fingerprint: string) => {
      const fp = fingerprint?.trim();
      if (!fp) return;
      setFavorites((current) => {
        const next = current.includes(fp) ? current.filter((entry) => entry !== fp) : [...current, fp];
        AsyncStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [],
  );

  const isFavorite = useCallback(
    (fingerprint: string) => Boolean(fingerprint && favorites.includes(fingerprint)),
    [favorites],
  );

  return {
    friendlyName,
    hashtag,
    quickSave,
    favorites,
    hydrated,
    setFriendlyName,
    regenerateName,
    setQuickSave,
    toggleFavorite,
    isFavorite,
  };
}
