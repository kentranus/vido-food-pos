import { getJSON, setJSON } from './storage';
import { DEFAULT_MENU, DEFAULT_CATEGORIES } from '../data/defaultMenu';

const MENU_KEY = 'vido_menu';
const CAT_KEY  = 'vido_categories';

export async function loadMenu()       { return getJSON(MENU_KEY, DEFAULT_MENU); }
export async function loadCategories() { return getJSON(CAT_KEY, DEFAULT_CATEGORIES); }
export async function saveMenu(menu)   { return setJSON(MENU_KEY, menu); }
export async function saveCategories(cats) { return setJSON(CAT_KEY, cats); }

export async function resetMenuToDefaults() {
  await setJSON(MENU_KEY, DEFAULT_MENU);
  await setJSON(CAT_KEY, DEFAULT_CATEGORIES);
}
