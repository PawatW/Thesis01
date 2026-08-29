import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ProductImage } from '@/components/Media';
import { TextField } from '@/components/TextField';
import {
  Card,
  EmptyState,
  ErrorNote,
  Pill,
  Screen,
  SectionHeader,
  Splash,
} from '@/components/ui';
import { listCategories, type Category } from '@/features/catalog/api';
import { ProductCouponPicker } from '@/features/coupons/ProductCouponPicker';
import { listMyProducts, updateProduct, type SellerProduct } from '@/features/seller/api';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

/**
 * แก้ไขสินค้าเต็มรูป (feature 11)
 *
 * หน้ารายการแก้ได้แค่ราคา/เปิด-ปิดขาย เพราะเป็นของที่ร้านแตะบ่อย — ส่วนชื่อ
 * คำอธิบาย รูป หมวด และขนาดบรรจุ อยู่ที่นี่ เพื่อไม่ให้หน้ารายการกลายเป็นฟอร์มยาว
 *
 * ★ ราคาต่อรอบของแต่ละแผนไม่ได้อยู่ในหน้านี้ ★ การขึ้นราคาต้องแจ้งสมาชิกทุกคน
 * จึงมีขั้นตอนยืนยันของตัวเองในหน้ารายการ (feature 11 · consumer protection)
 */
export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [product, setProduct] = useState<SellerProduct | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [categoryId, setCategoryId] = useState(0);
  const [oneTimePrice, setOneTimePrice] = useState('');
  const [netAmount, setNetAmount] = useState('');
  const [unit, setUnit] = useState('');

  const reload = useCallback(async () => {
    const [{ data, error: err }, cats] = await Promise.all([
      listMyProducts(),
      listCategories(),
    ]);
    const found = (data ?? []).find((p) => p.id === id) ?? null;
    setProduct(found);
    setCategories(cats);
    if (found != null) {
      setName(found.name);
      setDescription(found.description ?? '');
      setImage(found.images[0] ?? '');
      setCategoryId(found.categoryId);
      setOneTimePrice(String(found.oneTimePrice));
      setNetAmount(found.netAmount == null ? '' : String(found.netAmount));
      setUnit(found.unit ?? '');
    }
    setError(err);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save() {
    if (submitting.current || product == null) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);

    const price = Number(oneTimePrice);
    const net = netAmount.trim() === '' ? undefined : Number(netAmount);
    const { error: err } = await updateProduct(product.id, {
      name: name.trim(),
      description: description.trim(),
      categoryId,
      images: [image.trim()],
      oneTimePrice: Number.isFinite(price) ? price : undefined,
      ...(net === undefined || !Number.isFinite(net) ? {} : { netAmount: net }),
      ...(unit.trim() === '' ? {} : { unit: unit.trim() }),
    });

    submitting.current = false;
    setBusy(false);
    if (err != null) {
      await reload();
      setError(err);
      return;
    }
    setSaved(true);
    await reload();
  }

  if (loading) return <Splash />;

  if (product == null) {
    return (
      <Screen>
        <Card>
          <EmptyState
            id="seller-edit-not-found"
            title="ไม่พบสินค้านี้"
            body={error ?? 'สินค้าอาจถูกลบไปแล้ว หรือไม่ใช่สินค้าของร้านนี้'}
            action={<Button label="กลับไปหน้ารายการ" onPress={() => router.back()} />}
          />
        </Card>
      </Screen>
    );
  }

  const locked = product.isSuspended;

  return (
    <Screen>
      <Card id="seller-edit-card">
        <SectionHeader
          title={product.name}
          action={
            locked ? (
              <Pill id="seller-edit-suspended" label="ถูกระงับ" tone="frozen" />
            ) : (
              <Pill
                label={product.isActive ? 'เปิดขาย' : 'ปิดการขาย'}
                tone={product.isActive ? 'active' : 'cancelled'}
              />
            )
          }
        />
        <Text style={styles.muted}>
          สมาชิกที่ใช้อยู่ {product.activeSubscribers} ราย · แผนรอบส่ง {product.plans.length} แบบ
          (แก้ราคาที่หน้ารายการ เพราะต้องแจ้งสมาชิกก่อน)
        </Text>
        {locked ? (
          <Text id="seller-edit-locked" style={styles.warn}>
            สินค้าถูกผู้ดูแลระงับ — แก้ไขไม่ได้จนกว่าจะได้รับการปลดระงับ
          </Text>
        ) : null}
      </Card>

      {error != null ? <ErrorNote id="seller-edit-error" message={error} /> : null}
      {saved ? (
        <View style={styles.toast}>
          <Text id="seller-edit-saved" style={styles.toastText}>
            บันทึกแล้ว
          </Text>
        </View>
      ) : null}

      <Card>
        <SectionHeader title="ข้อมูลสินค้า" />
        <TextField
          id="seller-edit-name"
          label="ชื่อสินค้า"
          value={name}
          onChangeText={setName}
          maxLength={120}
          editable={!locked}
        />
        <TextField
          id="seller-edit-description"
          label="คำอธิบาย"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={2000}
          editable={!locked}
        />
        <TextField
          id="seller-edit-image"
          label="ลิงก์รูปสินค้า (https)"
          value={image}
          onChangeText={setImage}
          maxLength={500}
          editable={!locked}
          hint="ต้องเป็น https · อัปโหลดจากเครื่องยังไม่เปิดใช้ (รอตั้งค่า Cloudinary)"
        />
        {/*
          ตัวอย่างรูปแบบเดียวกับที่ผู้ซื้อจะเห็น — ลิงก์เสียจะตกกลับไปเป็นไอคอนหมวด
          ให้เห็นทันทีตั้งแต่ตอนกรอก ไม่ต้องบันทึกแล้วไปเปิดหน้าสินค้าดูเอง
        */}
        <ProductImage
          images={image.trim() === '' ? [] : [image.trim()]}
          categoryIcon={categories.find((c) => c.id === categoryId)?.icon ?? null}
          height={160}
          iconSize={56}
        />

        <Text style={styles.label}>หมวดสินค้า</Text>
        <View style={styles.chips}>
          {categories.map((c) => (
            <Pressable
              key={c.id}
              id={`seller-edit-category-${c.id}`}
              accessibilityRole="button"
              disabled={locked}
              onPress={() => setCategoryId(c.id)}
              style={[styles.chip, categoryId === c.id && styles.chipOn]}
            >
              <Text style={[styles.chipText, categoryId === c.id && styles.chipTextOn]}>
                {c.name}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextField
          id="seller-edit-one-time"
          label="ราคาซื้อครั้งเดียว (บาท)"
          value={oneTimePrice}
          onChangeText={setOneTimePrice}
          keyboardType="decimal-pad"
          editable={!locked}
          hint="ใช้คำนวณป้าย ถูกกว่าซื้อครั้งเดียว X%"
        />
        <View style={styles.pair}>
          <View style={styles.pairItem}>
            <TextField
              id="seller-edit-net"
              label="ขนาดบรรจุ"
              value={netAmount}
              onChangeText={setNetAmount}
              keyboardType="decimal-pad"
              editable={!locked}
            />
          </View>
          <View style={styles.pairItem}>
            <TextField
              id="seller-edit-unit"
              label="หน่วย (g / ml / ชิ้น)"
              value={unit}
              onChangeText={setUnit}
              maxLength={16}
              editable={!locked}
            />
          </View>
        </View>
        <Text style={styles.muted}>
          ขนาดบรรจุ + หน่วย คือสิ่งที่ทำให้ผู้ซื้อเทียบ ราคาต่อหน่วย ข้ามยี่ห้อได้
        </Text>

        {!locked ? (
          <Button id="seller-edit-save" label="บันทึก" loading={busy} onPress={() => void save()} />
        ) : null}
      </Card>

      {/* คูปองอยู่คนละการ์ดกับข้อมูลสินค้า เพราะบันทึกคนละคำสั่งกัน (feature 18) */}
      <ProductCouponPicker productId={id} disabled={locked} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.caption, color: colors.textMuted },
  warn: { ...type.caption, color: colors.statusFrozen },
  label: { ...type.caption, color: colors.textMuted },
  toast: { backgroundColor: statusTones.active.bg, borderRadius: radius.md, padding: space.md },
  toastText: { ...type.small, color: statusTones.active.fg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { ...type.caption, color: colors.text },
  chipTextOn: { color: colors.primaryStrong },
  pair: { flexDirection: 'row', gap: space.md },
  pairItem: { flex: 1 },
});
