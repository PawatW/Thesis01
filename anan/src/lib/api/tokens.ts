import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * ที่เก็บ token ของแอพ
 *
 * - **access token อยู่ในหน่วยความจำเท่านั้น** ไม่เขียนลงดิสก์ อายุ 15 นาที
 * - **refresh token ไม่ถูกเก็บในที่ที่ JavaScript อ่านได้อีกต่อไป** — คนละทาง
 *   ตาม platform เพราะสองที่นี้มีภัยคนละแบบ:
 *
 *   | | เก็บที่ไหน | ปิดอะไร |
 *   |---|---|---|
 *   | เว็บ | **ไม่เก็บเลย** — อยู่ใน httpOnly cookie ที่ API ตั้งให้ | XSS อ่าน token ไปใช้ต่อนอกเครื่องไม่ได้ |
 *   | มือถือ | `expo-secure-store` (Keychain ของ iOS / EncryptedSharedPreferences ของ Android) | ไฟล์ที่ถูกอ่านจากเครื่องที่ root/jailbreak แล้วได้แค่ ciphertext |
 *
 * ของเดิมคือ `localStorage` บนเว็บกับ `AsyncStorage` บนมือถือ ซึ่งอ่านได้ทั้งคู่
 * (ดู docs/security-design.md §5 — ความเสี่ยงที่ปิดไปแล้ว)
 */

const REFRESH_KEY = 'anan.refreshToken';
const isWeb = Platform.OS === 'web';

/**
 * เว็บใช้ cookie ที่ฝั่ง API เป็นคนตั้งและอ่าน — โค้ดในหน้าเว็บไม่เคยเห็นตัว token
 * ค่านี้จึงเป็นตัวบอกว่า "อย่าไปหา refresh token ในเครื่อง มันไม่มี"
 */
export const usesCookieTransport = isWeb;

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * บนเว็บคืน `null` เสมอ **โดยตั้งใจ** ไม่ใช่เพราะยังไม่ได้ล็อกอิน
 *
 * ผู้เรียกที่ต้องรู้ว่า "มี session ค้างอยู่ไหม" ต้องถาม API ด้วยการยิง refresh
 * ไม่ใช่ดูค่านี้ (`restoreSession()` ใน client.ts ทำให้แล้ว)
 */
export async function getRefreshToken(): Promise<string | null> {
  if (isWeb) return null;
  try {
    const stored = await SecureStore.getItemAsync(REFRESH_KEY);
    if (stored != null) return stored;
    return await migrateFromAsyncStorage();
  } catch {
    // keychain ใช้ไม่ได้ (เครื่องที่ยังไม่ปลดล็อกครั้งแรก) — ถือว่ายังไม่ล็อกอิน
    return null;
  }
}

export async function setRefreshToken(token: string | null): Promise<void> {
  if (isWeb) return;
  try {
    if (token == null) {
      await SecureStore.deleteItemAsync(REFRESH_KEY);
      return;
    }
    await SecureStore.setItemAsync(REFRESH_KEY, token, {
      // ต้องปลดล็อกเครื่องอย่างน้อย 1 ครั้งหลังบูตถึงจะอ่านได้ และไม่ถูกก๊อปไป
      // กับ backup ของเครื่อง — ค่ากลางที่ Apple แนะนำสำหรับ token ของแอพ
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } catch {
    // เขียนไม่ได้ = แค่ไม่จำ session ข้ามการเปิดแอพ ไม่ควรทำให้ล็อกอินล้มเหลว
  }
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  await setRefreshToken(null);
  await forgetLegacyStorage();
}

/**
 * ย้าย token ของผู้ใช้ที่ล็อกอินค้างไว้ตั้งแต่ก่อนอัปเดต จาก AsyncStorage
 * (ไฟล์ธรรมดา) เข้า keychain แล้วลบต้นฉบับทิ้ง
 *
 * ถ้าไม่ทำ ผู้ใช้เดิมทุกคนจะถูกเตะออกจากระบบพร้อมกันตอนอัปเดต **และ** สำเนา
 * ที่อ่านได้ก็ยังนอนอยู่ในเครื่องต่อไปอีก 7 วันอยู่ดี — เท่ากับความเสี่ยงเดิม
 * ยังไม่ถูกปิดจริงสำหรับคนที่ใช้อยู่แล้ว
 */
async function migrateFromAsyncStorage(): Promise<string | null> {
  const legacy = await AsyncStorage.getItem(REFRESH_KEY);
  if (legacy == null) return null;

  await setRefreshToken(legacy);
  await AsyncStorage.removeItem(REFRESH_KEY);
  return legacy;
}

/**
 * ลบร่องรอยของที่เก็บแบบเก่าทิ้งให้หมด
 *
 * บนเว็บสำคัญกว่าที่คิด: ผู้ใช้ที่เคยล็อกอินก่อนอัปเดตยังมี refresh token ตัวจริง
 * นอนอยู่ใน `localStorage` ซึ่ง XSS อ่านได้ และมันจะใช้ได้จริงจนครบ 7 วัน
 * — ถ้าไม่ลบ ก็เท่ากับย้ายไป cookie แล้วแต่ยังทิ้งกุญแจสำรองไว้ที่เดิม
 */
async function forgetLegacyStorage(): Promise<void> {
  try {
    if (isWeb) globalThis.localStorage?.removeItem(REFRESH_KEY);
    else await AsyncStorage.removeItem(REFRESH_KEY);
  } catch {
    // storage ถูกปิด (private mode) — ไม่มีอะไรให้ลบอยู่แล้ว
  }
}

/**
 * เรียกครั้งเดียวตอนแอพบูต — ล้างของเก่าทิ้งก่อนเริ่มใช้ที่เก็บใหม่
 * (บนมือถือการย้ายเกิดใน `getRefreshToken()` จึงล้างเฉพาะฝั่งเว็บที่ไม่มีอะไรให้ย้าย)
 */
export async function purgeLegacyRefreshToken(): Promise<void> {
  if (isWeb) await forgetLegacyStorage();
}
