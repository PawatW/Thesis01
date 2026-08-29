import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Card, EmptyState, ErrorNote, SectionHeader, Splash } from '@/components/ui';
import {
  createCategory,
  listCategories,
  removeCategory,
  updateCategory,
  type AdminCategory,
} from '@/features/admin/api';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

/**
 * จัดการหมวดสินค้า (feature 14 · W10 Flow B)
 *
 * จำนวนสินค้าในหมวดโชว์ข้างชื่อเสมอ เพราะการลบหมวดที่ยังมีของถูก FK บล็อกอยู่แล้ว
 * — ผู้ดูแลควรเห็นสาเหตุก่อนกด ไม่ใช่หลังจากโดนปฏิเสธ
 */
export default function AdminCategoriesScreen() {
  const [items, setItems] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [editName, setEditName] = useState('');

  const reload = useCallback(async () => {
    const { data, error: err } = await listCategories();
    setItems(data ?? []);
    setError(err);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  /** กันกดรัวด้วย ref เพราะ `busy` เป็น state ที่มีผลหลัง re-render (C-9) */
  async function run(
    action: () => Promise<{ error: string | null }>,
    okMessage: string,
  ): Promise<boolean> {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const { error: err } = await action();
    submitting.current = false;
    setBusy(false);
    if (err != null) {
      await reload();
      setError(err);
      return false;
    }
    setToast(okMessage);
    await reload();
    return true;
  }

  if (loading) return <Splash />;

  return (
    <>
      <SectionHeader title="หมวดสินค้า" />
      {error != null ? <ErrorNote id="admin-categories-error" message={error} /> : null}
      {toast != null ? (
        <Pressable id="admin-categories-toast" onPress={() => setToast(null)}>
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </Pressable>
      ) : null}

      <Card>
        <SectionHeader title="เพิ่มหมวดใหม่" />
        <TextField
          id="admin-category-name"
          label="ชื่อหมวด"
          value={name}
          onChangeText={setName}
          maxLength={60}
        />
        <TextField
          id="admin-category-icon"
          label="ไอคอน (ชื่อของ Ionicons เช่น sparkles)"
          value={icon}
          onChangeText={setIcon}
          maxLength={40}
        />
        <Button
          id="admin-category-add"
          label="เพิ่มหมวด"
          loading={busy}
          disabled={name.trim() === ''}
          onPress={() => {
            const payload = {
              name: name.trim(),
              ...(icon.trim() === '' ? {} : { icon: icon.trim() }),
            };
            void run(() => createCategory(payload), 'เพิ่มหมวดแล้ว').then((ok) => {
              if (!ok) return;
              setName('');
              setIcon('');
            });
          }}
        />
      </Card>

      {items.length === 0 ? (
        <Card>
          <EmptyState id="admin-categories-empty" title="ยังไม่มีหมวดสินค้า" />
        </Card>
      ) : null}

      {items.map((item) => (
        <Card key={item.id} id={`admin-category-${item.id}`}>
          <View style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={type.bodyStrong}>
                {item.name}{' '}
                <Text id={`admin-category-count-${item.id}`} style={styles.muted}>
                  · สินค้า {item.productCount} ชิ้น
                </Text>
              </Text>
              <Text style={styles.muted}>
                ลำดับ {item.sortOrder}
                {item.icon != null ? ` · ไอคอน ${item.icon}` : ''}
              </Text>
            </View>
            <View style={styles.rowActions}>
              <Action
                id={`admin-category-edit-${item.id}`}
                label="แก้ชื่อ"
                disabled={busy}
                onPress={() => {
                  setEditing(item);
                  setEditName(item.name);
                }}
              />
              <Action
                id={`admin-category-delete-${item.id}`}
                label="ลบ"
                danger
                disabled={busy}
                onPress={() => void run(() => removeCategory(item.id), 'ลบหมวดแล้ว')}
              />
            </View>
          </View>

          {editing?.id === item.id ? (
            <View style={styles.editRow}>
              <TextField
                id="admin-category-edit-name"
                label="ชื่อใหม่"
                value={editName}
                onChangeText={setEditName}
                maxLength={60}
              />
              <View style={styles.rowActions}>
                <Button
                  id="admin-category-edit-save"
                  label="บันทึก"
                  loading={busy}
                  disabled={editName.trim() === ''}
                  onPress={() => {
                    void run(
                      () => updateCategory(item.id, { name: editName.trim() }),
                      'แก้ชื่อหมวดแล้ว',
                    ).then((ok) => {
                      if (ok) setEditing(null);
                    });
                  }}
                />
                <Button
                  id="admin-category-edit-cancel"
                  label="ยกเลิก"
                  variant="ghost"
                  onPress={() => setEditing(null)}
                />
              </View>
            </View>
          ) : null}
        </Card>
      ))}
    </>
  );
}

function Action({
  label,
  onPress,
  disabled,
  danger,
  id,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  danger?: boolean;
  id: string;
}) {
  return (
    <Pressable
      id={id}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        danger === true && styles.actionDanger,
        pressed && styles.actionPressed,
        disabled && styles.actionDisabled,
      ]}
    >
      <Text style={[styles.actionText, danger === true && styles.actionTextDanger]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.caption, color: colors.textMuted },
  toast: { backgroundColor: statusTones.active.bg, borderRadius: radius.md, padding: space.md },
  toastText: { ...type.small, color: statusTones.active.fg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
  },
  rowMain: { gap: 2, flexShrink: 1 },
  rowActions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  editRow: {
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.md,
  },
  action: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  actionPressed: { borderColor: colors.primary },
  actionDisabled: { opacity: 0.5 },
  actionDanger: { borderColor: colors.dangerSoftBorder, backgroundColor: colors.dangerSoft },
  actionText: { ...type.caption, color: colors.text },
  actionTextDanger: { color: colors.danger },
});
