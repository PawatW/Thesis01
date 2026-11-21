/**
 * ชั้นข้อมูลของการแจ้งเตือน (feature 08)
 *
 * ★ ไม่มีฟังก์ชัน "สร้าง" ★ แจ้งเตือนทุกใบเกิดจาก service ฝั่ง API ในทรานแซกชัน
 * เดียวกับเหตุการณ์ที่ทำให้มันเกิด — ฝั่งแอปทำได้แค่ "อ่าน" และ "ทำเครื่องหมาย"
 */

import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { ApiError, apiFetch } from '@/lib/api/client';

export type Notification = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationList = {
  items: Notification[];
  unreadCount: number;
};

export type Result<T> = { data: T; error: null } | { data: null; error: string };

async function call<T>(
  path: string,
  init?: { method: 'POST' },
): Promise<Result<T>> {
  try {
    return { data: await apiFetch<T>(path, { method: init?.method ?? 'GET' }), error: null };
  } catch (e) {
    return {
      data: null,
      error: e instanceof ApiError ? e.message : 'โหลดการแจ้งเตือนไม่สำเร็จ',
    };
  }
}

/**
 * `scope` = กล่องของคอนโซลที่กำลังเปิดอยู่ (ผู้ซื้อ / ร้าน)
 *
 * บัญชีเดียวได้ทั้งแจ้งเตือน "ใกล้ถึงรอบส่ง" (ผู้ซื้อ) และ "มีผู้สมัครใหม่" (ร้าน)
 * การกรองอยู่ที่ API เสมอ ไม่ใช่ที่หน้าจอ — ไม่งั้นเพดาน 50 แถวจะเต็มไปด้วย
 * ของอีกฝั่งจนกล่องนี้ดูเหมือนว่างทั้งที่มีของค้างอยู่
 */
export type NotificationScope = 'buyer' | 'seller';

export const listNotifications = (
  filter: 'all' | 'unread',
  scope: NotificationScope,
): Promise<Result<NotificationList>> =>
  call<NotificationList>(`/notifications?filter=${filter}&scope=${scope}`);

export const markRead = (id: number): Promise<Result<Notification>> =>
  call<Notification>(`/notifications/${id}/read`, { method: 'POST' });

export const markAllRead = (scope: NotificationScope): Promise<Result<{ marked: number }>> =>
  call<{ marked: number }>(`/notifications/read?scope=${scope}`, { method: 'POST' });

/**
 * ไอคอนต่อชนิด — ให้กวาดตาแล้วรู้ว่าเรื่องอะไรโดยไม่ต้องอ่านหัวข้อ
 *
 * คืน type ของ Ionicons จริง ไม่ใช่ `string` — ไม่งั้นหน้าจอต้อง cast ทิ้ง
 * และชื่อไอคอนที่พิมพ์ผิดจะหลุดไปโผล่เป็นช่องว่างบนจอโดยไม่มีใครรู้
 */
export function notificationIcon(type: string): ComponentProps<typeof Ionicons>['name'] {
  if (type === 'upcoming_cycle') return 'time-outline';
  if (type === 'order_created') return 'cube-outline';
  if (type === 'order_status') return 'car-outline';
  if (type === 'price_changed') return 'pricetag-outline';
  if (type === 'subscription_frozen') return 'snow-outline';
  if (type === 'subscription_resumed') return 'play-outline';
  if (type === 'new_subscriber') return 'person-add-outline';
  if (type === 'subscriber_cancelled') return 'person-remove-outline';
  // Phase 8.3 — ผู้ซื้อกด "ส่งรอบนี้เลย"
  if (type === 'early_order') return 'flash-outline';
  return 'notifications-outline';
}
