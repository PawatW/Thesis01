import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { onAuthLost, restoreSession } from '@/lib/api/client';
import { getRefreshToken } from '@/lib/api/tokens';
import { fetchMe, signOut as signOutApi, type Profile } from './api';

export type { Profile };

type AuthState = {
  /** null = ยังไม่ได้ล็อกอิน */
  profile: Profile | null;
  initializing: boolean;
  /** เรียกหลัง login/register สำเร็จ เพื่อดึงโปรไฟล์เข้า context */
  setProfile: (profile: Profile | null) => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState(true);

  /**
   * ลำดับของการดึงโปรไฟล์ — ออกจากบัญชี A แล้วเข้าบัญชี B บนเครื่องเดียวกัน
   * ถ้าคำตอบของ A มาช้ากว่า มันจะทับของ B ซึ่งเป็นเรื่องใหญ่เพราะ profile
   * คือที่อยู่ของ isAdmin / isSeller
   */
  const fetchSeq = useRef(0);

  const loadProfile = useCallback(async () => {
    const mine = ++fetchSeq.current;
    const { data } = await fetchMe();
    if (mine === fetchSeq.current) setProfileState(data);
  }, []);

  const setProfile = useCallback((next: Profile | null) => {
    fetchSeq.current += 1;
    setProfileState(next);
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      // มี refresh token เก็บไว้ไหม → แลก access token ใหม่ก่อนค่อยดึงโปรไฟล์
      const restored = await restoreSession();
      if (!active) return;
      if (restored) await loadProfile();
      if (active) setInitializing(false);
    })();

    // refresh ไม่สำเร็จที่ไหนก็ตามในแอพ = session จบแล้ว ต้องเคลียร์หน้าจอทันที
    const unsubscribe = onAuthLost(() => {
      fetchSeq.current += 1;
      setProfileState(null);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    // เคลียร์ฝั่งเราก่อน: ถ้า network ล้ม ต้องไม่ค้างหน้าจอที่ยังเห็นข้อมูลคนเดิม
    const refreshToken = await getRefreshToken();
    fetchSeq.current += 1;
    setProfileState(null);
    await signOutApi(refreshToken);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      profile,
      initializing,
      setProfile,
      refreshProfile: loadProfile,
      signOut,
    }),
    [profile, initializing, setProfile, loadProfile, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx == null) throw new Error('useAuth ต้องอยู่ภายใน <AuthProvider>');
  return ctx;
}
