import type { OrbitPlugin } from '../sdk/types';
import { bookmarksPlugin } from './bookmarks';
import { clipboardPlugin } from './clipboard';
import { clockPlugin } from './clock';
import { hitokotoPlugin } from './hitokoto';
import { monitorPlugin } from './monitor';
import { searchPlugin } from './search';
import { transferPlugin } from './transfer';
import { weatherPlugin } from './weather';

export const BUILTIN_PLUGINS: OrbitPlugin[] = [
  clockPlugin,
  searchPlugin,
  weatherPlugin,
  hitokotoPlugin,
  bookmarksPlugin,
  monitorPlugin,
  clipboardPlugin,
  transferPlugin,
];

export { BookmarkModal } from './bookmarks';
export { ShareModal } from './transfer';
