/**
 * Reporter ที่เขียน `e2e/reports/report.md` — 1 แถวต่อ 1 test case
 *
 * ทำไมต้องมีนอกเหนือจาก HTML report ของ Playwright: รายงานในเล่ม thesis ต้องเป็น
 * ตารางที่แปะลงเอกสารได้และ diff ได้ใน git — HTML report เปิดดูได้แต่ยกไปวางไม่ได้
 *
 * ข้อมูลในตารางมาจาก annotation ที่ `helpers/test-case.ts` ผูกไว้กับทุกเคส
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

interface Row {
  id: string;
  priority: string;
  feature: string;
  title: string;
  status: TestResult['status'] | 'skipped';
  durationMs: number;
  retries: number;
  error: string;
}

const STATUS_LABEL: Record<string, string> = {
  passed: '✅ ผ่าน',
  failed: '❌ ไม่ผ่าน',
  timedOut: '⏱ หมดเวลา',
  skipped: '⏭ ข้าม',
  interrupted: '⚠️ ถูกขัดจังหวะ',
};

function annotation(test: TestCase, type: string): string {
  return test.annotations.find((a) => a.type === type)?.description ?? '';
}

/** ตัดให้เหลือบรรทัดเดียว — ตาราง markdown พังทันทีถ้ามี `|` หรือขึ้นบรรทัดใหม่ */
function cell(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export default class MarkdownReporter implements Reporter {
  private readonly rows: Row[] = [];
  private outputFile = 'reports/report.md';
  private startedAt = Date.now();

  constructor(options: { outputFile?: string } = {}) {
    if (options.outputFile != null) this.outputFile = options.outputFile;
  }

  onBegin(config: FullConfig): void {
    this.startedAt = Date.now();
    // อ้างจากที่อยู่ของไฟล์ config ไม่ใช่ `config.rootDir` — rootDir คือ `testDir`
    // (`e2e/specs`) รายงานจึงไปโผล่ใน specs/ แทนที่จะอยู่ข้าง ๆ config
    const base = config.configFile != null ? dirname(config.configFile) : resolve(__dirname, '..');
    this.outputFile = resolve(base, this.outputFile);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const id = annotation(test, 'tc-id');
    // เคสที่ไม่ได้ห่อด้วย testCase() ไม่มีรหัส — ไม่ใส่ในตารางที่อ้างในเล่ม
    if (id === '') return;

    this.rows.push({
      id,
      priority: annotation(test, 'priority'),
      feature: annotation(test, 'feature'),
      // ตัด "TC-001 · " ที่ testCase() เติมไว้ข้างหน้าออก เหลือเฉพาะชื่อจริง
      title: test.title.replace(/^TC-\d{3}\s·\s/, ''),
      status: result.status,
      durationMs: result.duration,
      retries: result.retry,
      error: result.error?.message ?? '',
    });
  }

  async onEnd(result: FullResult): Promise<void> {
    // globalSetup ล้ม = ไม่มีเคสไหนได้รันเลย · เขียนทับตอนนั้นเท่ากับลบผลรอบก่อน
    // ที่ยังใช้อ้างได้ทิ้งไปเพราะ error ที่ไม่เกี่ยวกับตัวเทสสักเคส
    if (this.rows.length === 0 && existsSync(this.outputFile)) {
      console.log('[e2e] ไม่มีเคสที่รันในรอบนี้ — คงรายงานเดิมไว้');
      return;
    }

    this.rows.sort((a, b) => a.id.localeCompare(b.id));

    const counts = this.rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});

    const lines: string[] = [
      '# ANAN — ผลการทดสอบ e2e (Playwright)',
      '',
      `> สร้างอัตโนมัติโดย \`e2e/reporters/markdown-reporter.ts\` — อย่าแก้ไฟล์นี้ด้วยมือ`,
      `> รันเมื่อ ${new Date(this.startedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} · ใช้เวลา ${formatDuration(Date.now() - this.startedAt)}`,
      '',
      '## สรุป',
      '',
      `- ผลรวม: **${result.status === 'passed' ? 'ผ่านทั้งหมด' : result.status}**`,
      `- จำนวนเคส: ${this.rows.length}`,
      ...Object.entries(counts).map(([status, n]) => `- ${STATUS_LABEL[status] ?? status}: ${n}`),
      '',
      '## รายการเคส',
      '',
      '| TC | ระดับ | Feature | สิ่งที่ทดสอบ | ผล | เวลา | หมายเหตุ |',
      '|---|---|---|---|---|---|---|',
    ];

    for (const row of this.rows) {
      const note =
        row.error !== ''
          ? cell(row.error)
          : row.retries > 0
            ? `ผ่านหลังลองใหม่ ${row.retries} ครั้ง`
            : '';
      lines.push(
        `| ${row.id} | ${row.priority} | ${cell(row.feature, 40)} | ${cell(row.title, 90)} | ${STATUS_LABEL[row.status] ?? row.status} | ${formatDuration(row.durationMs)} | ${note} |`,
      );
    }

    if (this.rows.length === 0) {
      lines.push('| — | — | — | ไม่มีเคสที่ห่อด้วย testCase() ในรอบนี้ | — | — | — |');
    }

    lines.push('');

    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, `${lines.join('\n')}\n`, 'utf8');
    console.log(`[e2e] เขียนรายงานแล้ว: ${this.outputFile}`);
  }
}
