import { useSyncExternalStore } from 'react';
import { Dimensions, Platform } from 'react-native';

/**
 * ความกว้างหน้าต่างที่ **อัปเดตจริงเมื่อผู้ใช้ย่อ/ขยายจอ**
 *
 * ── ทำไมไม่ใช้ `useWindowDimensions()` ของ react-native ─────────────────
 * บน react-native-web 0.21 ชุดนี้ มันคืนค่าที่ค้างตั้งแต่ตอน mount
 * ทดสอบแล้ว: ย่อจอจาก 1280 → 900 (ทั้งผ่าน devtools และยิง `resize` event เอง)
 * ค่าที่ hook คืนไม่ขยับเลย ผลคือ sidebar กับ rail ของจอกว้างยังค้างอยู่บนจอแคบ
 * แล้วบีบคอลัมน์สินค้าจนการ์ดล้น — จอจะกลับมาถูกก็ต่อเมื่อ reload
 *
 * (ปัญหาตระกูลเดียวกับ `onLayout` ที่ไม่ยิงเลย ดู `useProductGrid.ts`)
 *
 * ตัวนี้จึงฟัง event ตรงจากแพลตฟอร์ม:
 *  - web    → `window.resize`
 *  - native → `Dimensions.change` (ของ RN ทำงานถูกต้องอยู่แล้วบนมือถือ)
 *
 * ใช้ `useSyncExternalStore` เพื่อให้ค่าที่อ่านตรงกับตอน render เสมอ ไม่ใช่
 * `useState` + `useEffect` ที่ทำให้เฟรมแรกเป็นค่าเก่าเสมอ
 */

function subscribe(onChange: () => void): () => void {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
    };
  }
  const sub = Dimensions.addEventListener('change', onChange);
  return () => sub.remove();
}

function readWidth(): number {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.innerWidth;
  return Dimensions.get('window').width;
}

/**
 * ค่าตอน render ฝั่ง server (expo-router มี static render) — ไม่มี `window`
 * ให้ถือว่าเป็นจอมือถือไว้ก่อน ปลอดภัยกว่าเดาว่าเป็นเดสก์ท็อปแล้ววาด sidebar
 * ที่ผู้ใช้จริงไม่มีที่ให้วาง
 */
function serverWidth(): number {
  return 375;
}

export function useWindowWidth(): number {
  return useSyncExternalStore(subscribe, readWidth, serverWidth);
}
