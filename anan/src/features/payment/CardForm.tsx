import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { ErrorNote } from '@/components/ui';
import { colors, space, type } from '@/lib/theme';

import { CardFace } from './CardFace';
import {
  detectBrand,
  formatCardNumber,
  formatExpiry,
  maxDigitsFor,
  onlyDigits,
  parseExpiry,
  toCardPayload,
  validateCard,
  type CardBrand,
  type CardFieldError,
} from './card';

export type CardPayload = {
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  holderName: string;
};

/**
 * ฟอร์มผูกบัตร — ใช้ร่วมกันระหว่างหน้า "บัตรของฉัน" กับขั้นตอนจ่ายเงิน
 *
 * ★ เลขบัตรกับ CVV อยู่ใน state ของ component นี้เท่านั้น ★ ตอนกดยืนยันจะถูกแปลง
 * เป็น payload ที่มีแค่ เครือข่าย · 4 ตัวท้าย · เดือน/ปีหมดอายุ · ชื่อบนบัตร แล้ว
 * ล้างทิ้งทุกเส้นทาง (ทั้งสำเร็จและล้มเหลว) — ไม่มี persist ไม่มี log ไม่มีการส่งขึ้น
 * network (CLAUDE.md กฎข้อ 1 + security-rules C-2)
 */
export function CardForm({
  idPrefix,
  errorId,
  submitLabel = 'ผูกบัตร',
  variant = 'primary',
  onSubmit,
}: {
  /** ใช้ตั้ง id ของทุกช่องในฟอร์ม — ลงทะเบียนไว้ที่ `e2e/helpers/selectors.ts` */
  idPrefix: string;
  errorId: string;
  submitLabel?: string;
  variant?: 'primary' | 'secondary';
  /** คืนข้อความ error ถ้า API ปฏิเสธ · คืน null ถ้าสำเร็จ */
  onSubmit: (payload: CardPayload) => Promise<string | null>;
}) {
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [holder, setHolder] = useState('');
  const [fieldError, setFieldError] = useState<CardFieldError | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** C-9: state อัปเดตหลัง re-render จึงกันการกดรัวในเฟรมเดียวกันไม่ได้ */
  const submitting = useRef(false);

  const digits = onlyDigits(number);
  const brand = detectBrand(digits);
  const preview = parseExpiry(expiry);

  function reset() {
    setNumber('');
    setExpiry('');
    setCvv('');
    setHolder('');
  }

  async function submit() {
    if (submitting.current) return;

    const draft = { number, expiry, cvv, holder };
    const invalid = validateCard(draft);
    if (invalid != null) {
      setFieldError(invalid);
      setFormError(null);
      return;
    }

    const payload = toCardPayload(draft);
    if (payload == null) return;

    submitting.current = true;
    setBusy(true);
    setFieldError(null);
    setFormError(null);
    // ทิ้งเลขบัตรกับ CVV ตั้งแต่ก่อนยิง request — ไม่ต้องรอผลว่าสำเร็จหรือไม่
    reset();

    const err = await onSubmit(payload);
    submitting.current = false;
    setBusy(false);
    if (err != null) setFormError(err);
  }

  const errorFor = (field: CardFieldError['field']): string | undefined =>
    fieldError?.field === field ? fieldError.message : undefined;

  return (
    <View style={styles.wrap}>
      <CardFace
        id={`${idPrefix}-preview`}
        brand={brand}
        last4={digits.slice(-4).padStart(4, '•')}
        expMonth={preview?.month ?? 0}
        expYear={preview?.year ?? 0}
        holderName={holder}
      />

      <TextField
        id={`${idPrefix}-number`}
        label="เลขบัตร"
        value={formatCardNumber(number)}
        onChangeText={(next) => setNumber(onlyDigits(next).slice(0, maxDigitsFor(onlyDigits(next))))}
        placeholder="0000 0000 0000 0000"
        keyboardType="number-pad"
        autoComplete="cc-number"
        maxLength={23}
        error={errorFor('number')}
      />

      <View style={styles.row}>
        <View style={styles.col}>
          <TextField
            id={`${idPrefix}-expiry`}
            label="วันหมดอายุ"
            value={formatExpiry(expiry)}
            onChangeText={(next) => setExpiry(onlyDigits(next).slice(0, 4))}
            placeholder="ดด/ปป"
            keyboardType="number-pad"
            autoComplete="cc-exp"
            maxLength={5}
            error={errorFor('expiry')}
          />
        </View>
        <View style={styles.col}>
          <TextField
            id={`${idPrefix}-cvv`}
            label={brand === 'amex' ? 'CVV (4 หลัก)' : 'CVV'}
            value={cvv}
            onChangeText={(next) => setCvv(onlyDigits(next).slice(0, 4))}
            placeholder={brand === 'amex' ? '0000' : '000'}
            keyboardType="number-pad"
            autoComplete="cc-csc"
            secureTextEntry
            maxLength={4}
            error={errorFor('cvv')}
          />
        </View>
      </View>

      <TextField
        id={`${idPrefix}-holder`}
        label="ชื่อบนบัตร"
        value={holder}
        onChangeText={setHolder}
        placeholder="ชื่อ-นามสกุล ตามที่พิมพ์บนบัตร"
        autoCapitalize="characters"
        autoComplete="cc-name"
        maxLength={80}
        error={errorFor('holder')}
        onSubmitEditing={() => void submit()}
      />

      <Text style={styles.note}>
        ระบบเก็บเฉพาะเครือข่ายบัตร 4 ตัวท้าย และวันหมดอายุ — เลขบัตรเต็มและ CVV
        ไม่ถูกบันทึกไว้ที่ใด
      </Text>

      {formError != null ? <ErrorNote id={errorId} message={formError} /> : null}

      <Button
        id={`${idPrefix}-add`}
        label={submitLabel}
        variant={variant}
        loading={busy}
        onPress={() => void submit()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  row: { flexDirection: 'row', gap: space.md },
  col: { flex: 1 },
  note: { ...type.caption, color: colors.textFaint },
});
