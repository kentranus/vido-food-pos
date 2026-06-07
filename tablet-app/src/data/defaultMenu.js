/**
 * defaultMenu.js — Default boba shop menu.
 * Editable in-app via Menu Editor (Settings → Menu).
 * User edits persist to storage; this is just the starting point.
 */

export const DEFAULT_CATEGORIES = [
  { id: 'milk-tea',  name: 'Milk Tea',  icon: '🧋', order: 1 },
  { id: 'fruit-tea', name: 'Fruit Tea', icon: '🍑', order: 2 },
  { id: 'coffee',    name: 'Coffee',    icon: '☕', order: 3 },
  { id: 'smoothie',  name: 'Smoothies', icon: '🥤', order: 4 },
  { id: 'snack',     name: 'Snacks',    icon: '🥐', order: 5 },
  { id: 'topping',   name: 'Toppings',  icon: '🟤', order: 6 },
];

export const DEFAULT_MENU = [
  // === MILK TEA ===
  { id: 'classic',     category: 'milk-tea', name: 'Classic Milk Tea',  price: 5.50, popular: false, available: true,
    emoji: '🧋', gradient: 'linear-gradient(135deg, #F4D9B0, #C9A87C)' },
  { id: 'brown-sugar', category: 'milk-tea', name: 'Brown Sugar Boba',  price: 6.75, popular: true, available: true,
    emoji: '🧋', gradient: 'linear-gradient(135deg, #C9A87C, #6B4F2A)' },
  { id: 'oolong',      category: 'milk-tea', name: 'Oolong Milk Tea',   price: 5.75, popular: false, available: true,
    emoji: '🧋', gradient: 'linear-gradient(135deg, #DBB48A, #B8916B)' },
  { id: 'matcha',      category: 'milk-tea', name: 'Matcha Latte',      price: 6.25, popular: false, available: true,
    emoji: '🍵', gradient: 'linear-gradient(135deg, #BFE2A8, #84CC16)' },
  { id: 'thai',        category: 'milk-tea', name: 'Thai Milk Tea',     price: 5.75, popular: true, available: true,
    emoji: '🧋', gradient: 'linear-gradient(135deg, #FFB088, #FB923C)' },
  { id: 'taro',        category: 'milk-tea', name: 'Taro Milk Tea',     price: 6.25, popular: false, available: true,
    emoji: '🧋', gradient: 'linear-gradient(135deg, #D4C0E8, #9B6FAF)' },
  { id: 'jasmine',     category: 'milk-tea', name: 'Jasmine Milk Tea',  price: 5.75, popular: false, available: true,
    emoji: '🌼', gradient: 'linear-gradient(135deg, #F5E8B0, #ECDB80)' },
  { id: 'honeydew',    category: 'milk-tea', name: 'Honeydew Milk Tea', price: 6.00, popular: false, available: true,
    emoji: '🍈', gradient: 'linear-gradient(135deg, #BFE2A8, #A3D977)' },

  // === FRUIT TEA ===
  { id: 'mango',      category: 'fruit-tea', name: 'Mango Green Tea',  price: 5.75, popular: false, available: true,
    emoji: '🥭', gradient: 'linear-gradient(135deg, #FCD34D, #F59E0B)' },
  { id: 'strawberry', category: 'fruit-tea', name: 'Strawberry Tea',   price: 6.25, popular: false, available: true,
    emoji: '🍓', gradient: 'linear-gradient(135deg, #FCA5A5, #EF4444)' },
  { id: 'passion',    category: 'fruit-tea', name: 'Passion Fruit',    price: 5.95, popular: false, available: true,
    emoji: '🍊', gradient: 'linear-gradient(135deg, #FCD34D, #FB923C)' },
  { id: 'lychee',     category: 'fruit-tea', name: 'Lychee Tea',       price: 5.95, popular: false, available: true,
    emoji: '🌸', gradient: 'linear-gradient(135deg, #FBCFE8, #EC4899)' },

  // === COFFEE ===
  { id: 'latte',       category: 'coffee', name: 'Latte',              price: 5.50, popular: false, available: true,
    emoji: '☕', gradient: 'linear-gradient(135deg, #D2B48C, #8B6F47)' },
  { id: 'iced-coffee', category: 'coffee', name: 'Iced Coffee',        price: 4.95, popular: false, available: true,
    emoji: '☕', gradient: 'linear-gradient(135deg, #92400E, #451A03)' },
  { id: 'viet-coffee', category: 'coffee', name: 'Vietnamese Coffee',  price: 5.25, popular: true, available: true,
    emoji: '☕', gradient: 'linear-gradient(135deg, #78350F, #422006)' },

  // === SMOOTHIES ===
  { id: 'mango-sm',   category: 'smoothie', name: 'Mango Smoothie',      price: 6.50, popular: false, available: true,
    emoji: '🥤', gradient: 'linear-gradient(135deg, #FCD34D, #F97316)' },
  { id: 'straw-sm',   category: 'smoothie', name: 'Strawberry Smoothie', price: 6.50, popular: false, available: true,
    emoji: '🥤', gradient: 'linear-gradient(135deg, #FCA5A5, #DC2626)' },

  // === SNACKS ===
  { id: 'waffle', category: 'snack', name: 'Bubble Waffle', price: 5.50, popular: false, available: true,
    emoji: '🧇', gradient: 'linear-gradient(135deg, #FCD34D, #F59E0B)' },
  { id: 'mochi',  category: 'snack', name: 'Mochi (3 pcs)', price: 4.25, popular: false, available: true,
    emoji: '🍡', gradient: 'linear-gradient(135deg, #FBCFE8, #EC4899)' },

  // === TOPPINGS (addons) ===
  { id: 'tapioca',     category: 'topping', name: 'Tapioca Pearls', price: 0.75, isAddon: true, available: true,
    emoji: '⚫', gradient: 'linear-gradient(135deg, #8B6F47, #451A03)' },
  { id: 'cheese-foam', category: 'topping', name: 'Cheese Foam',    price: 1.25, isAddon: true, available: true,
    emoji: '🧀', gradient: 'linear-gradient(135deg, #FEF3C7, #FCD34D)' },
  { id: 'aloe',        category: 'topping', name: 'Aloe Vera',      price: 0.75, isAddon: true, available: true,
    emoji: '🟢', gradient: 'linear-gradient(135deg, #D1FAE5, #10B981)' },
  { id: 'jelly',       category: 'topping', name: 'Lychee Jelly',   price: 0.75, isAddon: true, available: true,
    emoji: '🟣', gradient: 'linear-gradient(135deg, #DDD6FE, #A855F7)' },
  { id: 'pudding',     category: 'topping', name: 'Egg Pudding',    price: 0.95, isAddon: true, available: true,
    emoji: '🟡', gradient: 'linear-gradient(135deg, #FEF3C7, #F59E0B)' },
];
