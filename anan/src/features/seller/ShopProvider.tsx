import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getMyShop, type Shop } from './api';

/**
 * ข้อมูลร้านของ session นี้ ที่ทั้งคอนโซลใช้ร่วมกัน
 *
 * ทำไมต้องมี context: หัวของคอนโซลร้านแสดง**ชื่อร้านจริง** ไม่ใช่คำว่า "ร้านของฉัน"
 * (นั่นคือสิ่งที่ทำให้รู้ว่ากำลังสวมหมวกใบไหน) แต่แถบนำทางไม่ได้ถูก unmount
 * ตอนเดินไปหน้าอื่น ถ้าให้แต่ละหน้าดึงเองชื่อบนหัวจะค้างค่าเก่าหลังแก้ชื่อร้าน
 *
 * `refreshShop()` จึงเปิดให้หน้าตั้งค่าเรียกหลังบันทึกสำเร็จ — ที่เดียวที่ต้องรู้
 * ว่ามีคนแก้ข้อมูลร้าน
 */
type ShopState = {
  shop: Shop | null;
  loading: boolean;
  refreshShop: () => Promise<void>;
};

const ShopContext = createContext<ShopState | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshShop = useCallback(async () => {
    const { data } = await getMyShop();
    // โหลดไม่สำเร็จ = ไม่รู้ ไม่ใช่ "ไม่มีร้าน" — คงค่าเดิมไว้ อย่าล้างหัวคอนโซล
    if (data != null) setShop(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // ห่อด้วย async IIFE ไม่ใช่ `void refreshShop()` เฉย ๆ — การเรียกตรง ๆ
    // ในตัว effect ถูก `react-hooks/set-state-in-effect` นับว่าเป็นการ setState
    // แบบซิงโครนัส (เตือนเรื่อง cascading render)
    void (async () => {
      await refreshShop();
    })();
  }, [refreshShop]);

  const value = useMemo<ShopState>(
    () => ({ shop, loading, refreshShop }),
    [shop, loading, refreshShop],
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useMyShop(): ShopState {
  const ctx = useContext(ShopContext);
  if (ctx == null) throw new Error('useMyShop ต้องอยู่ภายใน <ShopProvider>');
  return ctx;
}
