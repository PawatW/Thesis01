import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Card, EmptyState, ErrorNote, Pill, Screen, SectionHeader, Splash } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  createAddress,
  deleteAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
  validateAddress,
  type Address,
  type AddressDraft,
} from '@/features/auth/api';
import { colors, radius, space, type } from '@/lib/theme';

const emptyDraft: AddressDraft = {
  label: '',
  recipientName: '',
  phone: '',
  addressLine: '',
  province: '',
  postcode: '',
  isDefault: false,
};

export default function AddressesScreen() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<AddressDraft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof AddressDraft, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const { data, error } = await listAddresses();
    setItems(data);
    setListError(error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function openCreate() {
    setDraft({ ...emptyDraft, isDefault: items.length === 0 });
    setEditingId(null);
    setFieldErrors({});
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(address: Address) {
    setDraft({
      label: address.label ?? '',
      recipientName: address.recipientName,
      phone: address.phone,
      addressLine: address.addressLine,
      province: address.province,
      postcode: address.postcode,
      isDefault: address.isDefault,
    });
    setEditingId(address.id);
    setFieldErrors({});
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit() {
    if (profile == null) return;
    setFormError(null);
    const problems = validateAddress(draft);
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    const { error } =
      editingId != null ? await updateAddress(editingId, draft) : await createAddress(draft);
    setBusy(false);

    if (error != null) {
      setFormError(error);
      return;
    }
    setFormOpen(false);
    await reload();
  }

  async function handleDelete(id: string) {
    setListError(null);
    const { error } = await deleteAddress(id);
    // the DB refuses when a live subscription points at it, in Thai
    if (error != null) {
      setListError(error);
      return;
    }
    await reload();
  }

  async function handleSetDefault(id: string) {
    const { error } = await setDefaultAddress(id);
    if (error != null) {
      setListError(error);
      return;
    }
    await reload();
  }

  if (loading) return <Splash />;

  return (
    <Screen>
      {listError != null ? <ErrorNote id="address-list-error" message={listError} /> : null}

      {items.length === 0 && !formOpen ? (
        <Card>
          <EmptyState
            id="address-empty"
            title="ยังไม่มีที่อยู่จัดส่ง"
            body="เพิ่มที่อยู่ไว้ล่วงหน้า จะได้สมัครรับสินค้าได้เร็วขึ้น"
            action={<Button id="address-create-first" label="เพิ่มที่อยู่" onPress={openCreate} />}
          />
        </Card>
      ) : null}

      {items.map((address) => (
        <Card key={address.id} id={`address-item-${address.id}`}>
          <View style={styles.cardHead}>
            <View style={styles.cardTitle}>
              <Text style={type.h4}>{address.label != null && address.label !== '' ? address.label : 'ที่อยู่'}</Text>
              {address.isDefault ? <Pill id={`address-default-${address.id}`} label="ที่อยู่หลัก" tone="active" /> : null}
            </View>
          </View>
          <Text style={type.body}>{address.recipientName}</Text>
          <Text style={styles.muted}>{address.phone}</Text>
          <Text style={styles.muted}>
            {address.addressLine} {address.province} {address.postcode}
          </Text>
          <View style={styles.actions}>
            <Button
              id={`address-edit-${address.id}`}
              label="แก้ไข"
              variant="secondary"
              onPress={() => openEdit(address)}
            />
            {!address.isDefault ? (
              <Button
                id={`address-set-default-${address.id}`}
                label="ตั้งเป็นหลัก"
                variant="ghost"
                onPress={() => void handleSetDefault(address.id)}
              />
            ) : null}
            <Button
              id={`address-delete-${address.id}`}
              label="ลบ"
              variant="ghost"
              onPress={() => void handleDelete(address.id)}
            />
          </View>
        </Card>
      ))}

      {formOpen ? (
        <Card id="address-form">
          <SectionHeader title={editingId != null ? 'แก้ไขที่อยู่' : 'เพิ่มที่อยู่ใหม่'} />
          <TextField
            id="address-label"
            label="ป้ายกำกับ (ไม่บังคับ)"
            value={draft.label ?? ''}
            onChangeText={(v) => setDraft({ ...draft, label: v })}
            placeholder="บ้าน / ที่ทำงาน"
            maxLength={40}
          />
          <TextField
            id="address-recipient"
            label="ชื่อผู้รับ"
            value={draft.recipientName}
            onChangeText={(v) => setDraft({ ...draft, recipientName: v })}
            autoCapitalize="words"
            error={fieldErrors.recipientName}
            maxLength={100}
          />
          <TextField
            id="address-phone"
            label="เบอร์โทร"
            value={draft.phone}
            onChangeText={(v) => setDraft({ ...draft, phone: v })}
            keyboardType="phone-pad"
            error={fieldErrors.phone}
            maxLength={20}
          />
          <TextField
            id="address-line"
            label="ที่อยู่"
            value={draft.addressLine}
            onChangeText={(v) => setDraft({ ...draft, addressLine: v })}
            multiline
            error={fieldErrors.addressLine}
            maxLength={300}
          />
          <TextField
            id="address-province"
            label="จังหวัด"
            value={draft.province}
            onChangeText={(v) => setDraft({ ...draft, province: v })}
            error={fieldErrors.province}
            maxLength={100}
          />
          <TextField
            id="address-postcode"
            label="รหัสไปรษณีย์"
            value={draft.postcode}
            onChangeText={(v) => setDraft({ ...draft, postcode: v })}
            keyboardType="number-pad"
            error={fieldErrors.postcode}
            maxLength={5}
          />
          <View style={styles.defaultRow}>
            <Button
              id="address-toggle-default"
              label={draft.isDefault ? 'ตั้งเป็นที่อยู่หลัก ✓' : 'ตั้งเป็นที่อยู่หลัก'}
              variant={draft.isDefault ? 'secondary' : 'ghost'}
              onPress={() => setDraft({ ...draft, isDefault: !draft.isDefault })}
            />
          </View>
          {formError != null ? <ErrorNote id="address-form-error" message={formError} /> : null}
          <View style={styles.actions}>
            <Button id="address-submit" label="บันทึก" onPress={handleSubmit} loading={busy} />
            <Button id="address-cancel" label="ยกเลิก" variant="ghost" onPress={() => setFormOpen(false)} />
          </View>
        </Card>
      ) : items.length > 0 ? (
        <Button id="address-create" label="เพิ่มที่อยู่ใหม่" variant="secondary" onPress={openCreate} fullWidth />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  muted: { ...type.small, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginTop: space.xs },
  defaultRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md, borderRadius: radius.sm },
});
