import { useCallback, useState } from 'react';
import { readRecentItems, rememberRecentItem, type RecentItem } from '../helpers/recentItems';

/** Recent palette destinations from this browser (localStorage, guarded), and a way to add one. */
export const useRecentItems = () => {
  const [recent, setRecent] = useState<RecentItem[]>(readRecentItems);
  const remember = useCallback((item: RecentItem) => setRecent(rememberRecentItem(item)), []);
  return { recent, remember };
};
