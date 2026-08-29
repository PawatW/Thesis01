import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { ProductCardData } from '@/features/catalog/api';

/** เทียบ 2-4 ชิ้นตามสเปก — น้อยกว่า 2 ไม่มีความหมาย มากกว่า 4 ตารางอ่านไม่ไหว */
export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;

export type AddResult = 'added' | 'removed' | 'full' | 'other-category';

type CompareState = {
  items: ProductCardData[];
  /** หมวดของถาดปัจจุบัน — เทียบข้ามหมวดไม่ได้ (คนละมิติกันจนเทียบไม่มีความหมาย) */
  categoryId: number | null;
  has: (productId: string) => boolean;
  toggle: (item: ProductCardData, categoryId: number) => AddResult;
  /** ล้างของเดิมแล้วเริ่มใหม่ด้วยชิ้นนี้ — ทางออกของ toast "คนละหมวด" */
  restartWith: (item: ProductCardData, categoryId: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
};

const CompareContext = createContext<CompareState | null>(null);

/**
 * ถาดเปรียบเทียบ (feature 04)
 *
 * ★ เป็น client state ล้วน ไม่แตะฐานข้อมูลเลย ★ ข้อมูลสินค้าที่ใช้เทียบคือชุด
 * เดียวกับที่หน้าหมวดโหลดมาแล้ว — เปิดหน้าตารางจึงไม่ยิง request เพิ่มแม้แต่ครั้งเดียว
 *
 * ใช้ Context ไม่ใช่ zustand อย่างที่สเปกร่างไว้ เพราะสถานะมีแค่ 2 ตัว (รายการ +
 * หมวด) และไม่มีใครนอกฟีเจอร์นี้ใช้ — เพิ่ม dependency ใหม่ไม่คุ้ม (CLAUDE.md ข้อ 6)
 */
export function CompareProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ProductCardData[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);

  const has = useCallback(
    (productId: string) => items.some((i) => i.id === productId),
    [items],
  );

  const toggle = useCallback(
    (item: ProductCardData, itemCategoryId: number): AddResult => {
      if (has(item.id)) {
        setItems((prev) => {
          const next = prev.filter((i) => i.id !== item.id);
          if (next.length === 0) setCategoryId(null);
          return next;
        });
        return 'removed';
      }
      if (categoryId !== null && categoryId !== itemCategoryId) {
        return 'other-category';
      }
      if (items.length >= MAX_COMPARE) return 'full';

      setCategoryId(itemCategoryId);
      setItems((prev) => [...prev, item]);
      return 'added';
    },
    [categoryId, has, items.length],
  );

  const restartWith = useCallback(
    (item: ProductCardData, itemCategoryId: number) => {
      setCategoryId(itemCategoryId);
      setItems([item]);
    },
    [],
  );

  const remove = useCallback((productId: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== productId);
      if (next.length === 0) setCategoryId(null);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setCategoryId(null);
  }, []);

  const value = useMemo<CompareState>(
    () => ({ items, categoryId, has, toggle, restartWith, remove, clear }),
    [items, categoryId, has, toggle, restartWith, remove, clear],
  );

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export function useCompare(): CompareState {
  const ctx = useContext(CompareContext);
  if (ctx == null) {
    throw new Error('useCompare ต้องอยู่ภายใต้ <CompareProvider>');
  }
  return ctx;
}
