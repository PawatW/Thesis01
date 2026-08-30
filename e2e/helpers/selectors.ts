/**
 * จุดเกาะของเทสทั้งหมด — **DOM id จริงที่ประกาศไว้ในโค้ดแอป**
 *
 * ทำไมไม่ใช้ข้อความหรือ label: ข้อความ UI เป็นภาษาไทยและแก้บ่อย (`ยืนยันสมัครรับสินค้า`
 * เปลี่ยนเป็นอย่างอื่นเมื่อไหร่เทสก็แดงทั้งชุด) ส่วน accessibilityRole ของ
 * react-native-web ก็ให้ปุ่มหลายตัวหน้าตาเหมือนกันหมดจนต้องเลือกด้วยลำดับ
 * `id` เป็นสัญญาเดียวที่ตั้งใจประกาศไว้ให้เทสจับ
 *
 * ทุกรายการต่อไปนี้เปิดไฟล์ต้นทางมาดูแล้ว บรรทัดคอมเมนต์คือที่อยู่ของ id นั้น
 * ถ้าลบ id ออกจาก source ต้องมาลบที่นี่ด้วย
 */

/** `anan/app/(auth)/login.tsx` */
export const login = {
  email: '#login-email',
  emailError: '#login-email-error',
  password: '#login-password',
  submit: '#login-submit',
  /** ErrorNote ของทั้งฟอร์ม — ข้อความเดียวกันไม่ว่าอีเมลผิดหรือรหัสผิด (กัน user enumeration) */
  formError: '#login-error',
  linkRegister: '#login-link-register',
  linkForgot: '#login-link-forgot',
} as const;

/** `anan/app/(auth)/forgot-password.tsx` — ขั้นที่ 1 ของการลืมรหัสผ่าน */
export const forgotPassword = {
  email: '#forgot-email',
  emailError: '#forgot-email-error',
  submit: '#forgot-submit',
  /** error ที่บอกได้ (รูปแบบอีเมลผิด / ขอถี่เกินไป) — ไม่เคยบอกว่าอีเมลมีในระบบไหม */
  formError: '#forgot-error',
  /** ★ ข้อความยืนยันหลังส่ง — ต้องเหมือนกันทั้งกรณีที่มีบัญชีและไม่มี ★ */
  sent: '#forgot-sent',
  resend: '#forgot-resend',
  linkLogin: '#forgot-link-login',
} as const;

/** `anan/app/(auth)/reset-password.tsx` — ขั้นที่ 2 (เปิดจากลิงก์ในอีเมล) */
export const resetPassword = {
  password: '#reset-password',
  passwordError: '#reset-password-error',
  confirm: '#reset-confirm',
  confirmError: '#reset-confirm-error',
  submit: '#reset-submit',
  /** ครอบทุกสาเหตุที่ลิงก์ใช้ไม่ได้ — API ตอบข้อความเดียวกันหมด */
  formError: '#reset-error',
  done: '#reset-done',
  gotoLogin: '#reset-goto-login',
  /** เปิดหน้านี้โดยไม่มี ?token= — ต้องได้หน้าอธิบาย ไม่ใช่จอขาว */
  missingToken: '#reset-missing-token',
  requestAgain: '#reset-request-again',
  linkForgot: '#reset-link-forgot',
} as const;

/** `anan/app/(auth)/register.tsx` */
export const register = {
  name: '#register-name',
  nameError: '#register-name-error',
  email: '#register-email',
  emailError: '#register-email-error',
  password: '#register-password',
  passwordError: '#register-password-error',
  submit: '#register-submit',
  formError: '#register-error',
  linkLogin: '#register-link-login',
} as const;

/** `anan/app/(buyer)/index.tsx` + `anan/src/features/catalog/ProductCard.tsx` */
export const home = {
  greeting: '#home-greeting',
  featured: '#home-featured',
  subsEmpty: '#home-subs-empty',
  subsError: '#home-subs-error',
  /** เช็คบ็อกซ์หมวด — ติ๊กได้หลายหมวด แล้วกรองการ์ดในหน้าแรกเลย (2026-08-30) */
  category: (categoryId: number) => `#home-category-${categoryId}`,
  categoryClear: '#home-category-clear',
  featuredCount: '#home-featured-count',
  featuredEmpty: '#home-featured-empty',
  subscriptionRow: (subscriptionId: string) => `#home-sub-${subscriptionId}`,
  /**
   * การ์ดสินค้าถูกตั้ง id ตามหน้าจอที่ใช้ ไม่ใช่ตามรหัสสินค้าอย่างเดียว
   * เพราะ expo-router คาหน้าเดิมไว้ในต้นไม้ตอน push หน้าใหม่ — สินค้าชิ้นเดียวกัน
   * จึงอยู่ทั้งหน้าแรกและหน้าหมวดพร้อมกันได้ (เจอตอน TC-011 แดงด้วย strict mode)
   */
  productCard: (productId: string) => `#home-product-${productId}`,
  anyProductCard: '[id^="home-product-"]',
  /** ช่องค้นหาใน hero ของหน้าแรก (feature 02, 2026-08-30) — `SearchBar` จาก `@/components/SearchBar` */
  search: '#home-search',
  searchSubmit: '#home-search-submit',
} as const;

/** `anan/app/category/[id].tsx` */
export const category = {
  search: '#category-search',
  sortPopular: '#category-sort-popular',
  sortPrice: '#category-sort-price',
  grid: '#category-grid',
  empty: '#category-empty',
  productCard: (productId: string) => `#category-product-${productId}`,
} as const;

/**
 * `anan/app/search.tsx` — หน้าค้นหารวม (feature 02, 2026-08-30)
 *
 * ช่องเดียวค้นได้ทั้งชื่อสินค้าและชื่อร้าน — `#search-empty` ใช้ร่วมกัน 2 สถานะ
 * (ยังไม่พิมพ์คำค้น vs. ค้นแล้วไม่พบ) ข้อความต่างกันแต่ id เดียวกัน ต้อง assert
 * ข้อความด้วยเสมอ ไม่ใช่แค่ว่า element โผล่ (ดู `catalog.spec.ts` TC-122)
 */
export const search = {
  input: '#search-input',
  submit: '#search-submit',
  /** container ของแถบร้าน — มีเฉพาะเมื่อผลค้นหามีร้านอย่างน้อย 1 ร้าน */
  shops: '#search-shops',
  shop: (shopId: string) => `#search-shop-${shopId}`,
  grid: '#search-grid',
  product: (productId: string) => `#search-product-${productId}`,
  empty: '#search-empty',
  sortPopular: '#search-sort-popular',
  sortNewest: '#search-sort-newest',
  sortPriceAsc: '#search-sort-price-asc',
  sortPriceDesc: '#search-sort-price-desc',
} as const;

/** `anan/app/product/[id].tsx` */
export const product = {
  title: '#product-title',
  notFound: '#product-not-found',
  plansEmpty: '#product-plans-empty',
  /** cycle เป็น '2w' | '1m' | '2m' — สินค้าหนึ่งตัวมีรอบซ้ำกันไม่ได้ */
  plan: (cycle: string) => `#product-plan-${cycle}`,
  qtyIncrease: '#product-qty-inc',
  qtyDecrease: '#product-qty-dec',
  qtyValue: '#product-qty-value',
  total: '#product-total',
  subscribe: '#product-subscribe',
} as const;

/** `anan/app/checkout/[planId].tsx` */
export const checkout = {
  productName: '#checkout-product-name',
  meta: '#checkout-meta',
  total: '#checkout-total',
  planNotFound: '#checkout-plan-not-found',
  addressEmpty: '#checkout-address-empty',
  addressAdd: '#checkout-address-add',
  address: (addressId: string) => `#checkout-address-${addressId}`,
  card: (paymentMethodId: string) => `#checkout-card-${paymentMethodId}`,
  /** ฟอร์มผูกบัตรในหน้าจ่ายเงิน — `anan/src/features/payment/CardForm.tsx` */
  cardPreview: '#checkout-card-preview',
  cardNumber: '#checkout-card-number',
  cardExpiry: '#checkout-card-expiry',
  cardCvv: '#checkout-card-cvv',
  cardHolder: '#checkout-card-holder',
  cardAdd: '#checkout-card-add',
  /** error ที่ API ตอบกลับ (ต่างจาก error รายช่องที่ TextField ต่อท้าย `-error` ให้เอง) */
  cardError: '#checkout-card-error',
  cardNumberError: '#checkout-card-number-error',
  cardExpiryError: '#checkout-card-expiry-error',
  cardCvvError: '#checkout-card-cvv-error',
  /** จำนวนวันก่อนเริ่มรอบแรก: 1 | 3 | 7 | 14 */
  startOffset: (days: number) => `#checkout-start-${days}`,
  /** คูปองรอบแรก (feature 18) — การ์ดโผล่เฉพาะเมื่อมีคูปองที่ใช้ได้ */
  coupons: '#checkout-coupons',
  couponTier: (tier: 'platform' | 'shop') => `#checkout-coupon-tier-${tier}`,
  coupon: (couponId: string) => `#checkout-coupon-${couponId}`,
  couponSave: (couponId: string) => `#checkout-coupon-save-${couponId}`,
  couponSummary: '#checkout-coupon-summary',
  confirm: '#checkout-confirm',
  notReady: '#checkout-not-ready',
  error: '#checkout-error',
} as const;

/** `anan/app/(buyer)/subscriptions.tsx` */
export const subscriptions = {
  spend: '#subs-spend',
  /**
   * ปฏิทินการตัดเงินของเดือนนี้ — ไม่มีธาตุนี้เลยแปลว่าเดือนนี้ไม่มีรอบที่ต้องจ่าย
   * (การ์ดสรุปนับเฉพาะรอบที่ตกในเดือนปฏิทินปัจจุบันจริง ๆ ไม่ใช่ค่าเฉลี่ยต่อเดือน)
   */
  schedule: '#subs-schedule',
  scheduleRow: (id: string, date: string) => `#subs-schedule-row-${id}-${date}`,
  empty: '#subs-empty',
  error: '#subs-error',
  toast: '#subs-toast',
  groupActive: '#subs-group-active',
  groupPaused: '#subs-group-paused',
  groupCancelled: '#subs-group-cancelled',
  item: (id: string) => `#subs-item-${id}`,
  status: (id: string) => `#subs-status-${id}`,
  frozenNote: (id: string) => `#subs-frozen-note-${id}`,
  action: {
    skip: (id: string) => `#subs-action-skip-${id}`,
    reschedule: (id: string) => `#subs-action-reschedule-${id}`,
    pause: (id: string) => `#subs-action-pause-${id}`,
    resume: (id: string) => `#subs-action-resume-${id}`,
    plan: (id: string) => `#subs-action-plan-${id}`,
    address: (id: string) => `#subs-action-address-${id}`,
    cancel: (id: string) => `#subs-action-cancel-${id}`,
    review: (id: string) => `#subs-action-review-${id}`,
    /** feature 18 — เปิดกล่องเลือกคูปองของรอบถัดไป */
    coupon: (id: string) => `#subs-action-coupon-${id}`,
  },
  /** บรรทัดคูปองบนการ์ด — มีเฉพาะรายการที่จองคูปองไว้กับรอบถัดไปแล้ว */
  couponLine: (id: string) => `#subs-coupon-line-${id}`,
  confirm: '#subs-confirm',
  confirmTitle: '#subs-confirm-title',
  confirmBody: '#subs-confirm-body',
  confirmOk: '#subs-confirm-ok',
  confirmClose: '#subs-confirm-close',
  addressModal: '#subs-address-modal',
  addressOption: (addressId: string) => `#subs-address-option-${addressId}`,
  addressClose: '#subs-address-close',
  /**
   * กล่องเลือกคูปองรายรอบ (`anan/src/features/coupons/CouponSheet.tsx`)
   * — จองไว้กับ "รอบถัดไป" ไม่ใช่ใช้ทันที (feature 18 · W13 Flow C)
   */
  couponModal: '#subs-coupon-modal',
  couponCycle: '#subs-coupon-cycle',
  /** ยอดรวมของทั้งสองระดับ — มาจาก API ทั้งก้อน หน้าจอไม่บวกเอง */
  couponTotal: '#subs-coupon-total',
  /** หนึ่งช่องต่อหนึ่งระดับ (feature 18 รอบ 2) */
  couponTier: (tier: 'platform' | 'shop') => `#subs-coupon-tier-${tier}`,
  couponApplied: (tier: 'platform' | 'shop') => `#subs-coupon-applied-${tier}`,
  couponRemove: (tier: 'platform' | 'shop') => `#subs-coupon-remove-${tier}`,
  couponTierBlocked: (tier: 'platform' | 'shop') =>
    `#subs-coupon-blocked-${tier}`,
  couponTierEmpty: (tier: 'platform' | 'shop') => `#subs-coupon-empty-${tier}`,
  couponOption: (couponId: string) => `#subs-coupon-option-${couponId}`,
  couponSave: (couponId: string) => `#subs-coupon-save-${couponId}`,
  couponBlocked: '#subs-coupon-blocked',
  couponError: '#subs-coupon-error',
  couponClose: '#subs-coupon-close',
  /** กล่องเปลี่ยนรอบส่ง — ตัวเลือกมีเฉพาะแผนที่ยังเปิดรับของสินค้าชิ้นเดียวกัน */
  planModal: '#subs-plan-modal',
  planOption: (planId: string) => `#subs-plan-option-${planId}`,
  planEmpty: '#subs-plan-empty',
  planClose: '#subs-plan-close',
  /** การ์ดรีวิว (feature 17) — ปุ่มถูกล็อกจนกว่าจะมีออเดอร์ที่ส่งถึงจริง */
  reviewLocked: (id: string) => `#subs-review-locked-${id}`,
  reviewCycles: (id: string) => `#subs-review-cycles-${id}`,
  reviewModal: '#subs-review-modal',
  reviewStar: (n: number) => `#subs-review-star-${n}`,
  reviewComment: '#subs-review-comment',
  reviewEdited: '#subs-review-edited',
  reviewSubmit: '#subs-review-submit',
  reviewClose: '#subs-review-close',
} as const;

/** `anan/app/(seller)/index.tsx` — dashboard ของร้าน */
export const sellerDashboard = {
  subscribers: '#seller-stat-subscribers',
  mrr: '#seller-stat-mrr',
  churn: '#seller-stat-churn',
  pendingOrders: '#seller-pending-orders',
  activeProducts: '#seller-active-products',
  events: '#seller-recent-events',
  eventsEmpty: '#seller-events-empty',
  error: '#seller-dashboard-error',
  suspendedPill: '#seller-suspended-pill',
} as const;

/** `anan/app/(seller)/products.tsx` */
export const sellerProducts = {
  empty: '#seller-products-empty',
  error: '#seller-products-error',
  toast: '#seller-toast',
  newOpen: '#seller-new-open',
  newForm: '#seller-new-form',
  newName: '#seller-new-name',
  newCategory: (categoryId: number) => `#seller-new-category-${categoryId}`,
  newPrice: '#seller-new-price',
  newImage: '#seller-new-image',
  newPlan: (cycle: string) => `#seller-new-plan-${cycle}`,
  newPlanPrice: (cycle: string) => `#seller-new-plan-price-${cycle}`,
  newPlanDiscount: (cycle: string) => `#seller-new-plan-discount-${cycle}`,
  newSubmit: '#seller-new-submit',
  newError: '#seller-new-error',
  item: (productId: string) => `#seller-product-${productId}`,
  status: (productId: string) => `#seller-product-status-${productId}`,
  subscribers: (productId: string) => `#seller-product-subs-${productId}`,
  toggleActive: (productId: string) => `#seller-product-toggle-${productId}`,
  plan: (planId: string) => `#seller-plan-${planId}`,
  planStatus: (planId: string) => `#seller-plan-status-${planId}`,
  planPrice: (planId: string) => `#seller-plan-price-${planId}`,
  planSave: (planId: string) => `#seller-plan-save-${planId}`,
  planToggle: (planId: string) => `#seller-plan-toggle-${planId}`,
  priceConfirmBody: '#seller-price-confirm-body',
  priceConfirmOk: '#seller-price-confirm-ok',
  priceConfirmClose: '#seller-price-confirm-close',
} as const;

/** `anan/app/(seller)/orders.tsx` */
export const sellerOrders = {
  tab: (tab: 'open' | 'shipped' | 'issues' | 'forecast' | 'history') =>
    `#seller-orders-tab-${tab}`,
  empty: '#seller-orders-empty',
  error: '#seller-orders-error',
  toast: '#seller-orders-toast',
  item: (orderId: string) => `#seller-order-${orderId}`,
  status: (orderId: string) => `#seller-order-status-${orderId}`,
  address: (orderId: string) => `#seller-order-address-${orderId}`,
  tracking: (orderId: string) => `#seller-order-tracking-${orderId}`,
  advance: (orderId: string) => `#seller-order-advance-${orderId}`,
  shipModal: '#seller-ship-modal',
  shipTracking: '#seller-ship-tracking',
  shipConfirm: '#seller-ship-confirm',
  forecast: '#seller-forecast',
  forecastRange: (days: number) => `#seller-forecast-range-${days}`,
  forecastNote: '#seller-forecast-note',
  forecastEmpty: '#seller-forecast-empty',
  forecastItem: (productId: string) => `#seller-forecast-${productId}`,
  /** ยกเลิกออเดอร์ + คืนเงินจำลอง (feature 15) */
  cancel: (orderId: string) => `#seller-order-cancel-${orderId}`,
  cancelModal: '#seller-cancel-modal',
  cancelPreset: (key: string) => `#seller-cancel-preset-${key}`,
  cancelReason: '#seller-cancel-reason',
  cancelConfirm: '#seller-cancel-confirm',
  cancelClose: '#seller-cancel-close',
  /** แท็บ "ปัญหา" (feature 16) */
  issueTab: (status: 'open' | 'closed') => `#seller-issue-tab-${status}`,
  issuesEmpty: '#seller-issues-empty',
  issue: (issueId: string) => `#seller-issue-${issueId}`,
  issueStatus: (issueId: string) => `#seller-issue-status-${issueId}`,
  issueStale: (issueId: string) => `#seller-issue-stale-${issueId}`,
  issueNoteOn: (issueId: string) => `#seller-issue-note-${issueId}`,
  issueAnswer: (issueId: string) => `#seller-issue-answer-${issueId}`,
  issueModal: '#seller-issue-modal',
  issueNote: '#seller-issue-note',
  issueResolve: '#seller-issue-resolve',
  issueReject: '#seller-issue-reject',
  issueClose: '#seller-issue-close',
} as const;

/** `anan/app/(buyer)/orders/index.tsx` + `anan/app/(buyer)/orders/[id].tsx` */
export const orders = {
  tab: (tab: 'open' | 'done') => `#orders-tab-${tab}`,
  empty: '#orders-empty',
  error: '#orders-error',
  card: (orderId: string) => `#order-card-${orderId}`,
  status: (orderId: string) => `#order-status-${orderId}`,
  confirmedPill: (orderId: string) => `#order-confirmed-${orderId}`,
  issuePill: (orderId: string) => `#order-issue-${orderId}`,
  refundedPill: (orderId: string) => `#order-refunded-${orderId}`,
  /** หน้ารายละเอียด */
  detail: '#order-detail',
  detailStatus: '#order-detail-status',
  detailError: '#order-error',
  notFound: '#order-not-found',
  toast: '#order-toast',
  stepper: '#order-stepper',
  steps: '#order-steps',
  step: (key: string) => `#order-step-${key}`,
  tracking: '#order-tracking',
  confirmedAt: '#order-confirmed-at',
  autoClosed: '#order-auto-closed',
  address: '#order-address',
  subCancelled: '#order-sub-cancelled',
  /** ยืนยันรับของ + แจ้งปัญหา (feature 16) */
  confirm: '#order-confirm',
  report: '#order-report',
  issueSheet: '#order-issue-sheet',
  issueType: (type: string) => `#order-issue-type-${type}`,
  issueDetail: '#order-issue-detail',
  issueSubmit: '#order-issue-submit',
  issueClose: '#order-issue-close',
  issueCard: '#order-issue-card',
  issueStatus: '#order-issue-status',
  issueNote: '#order-issue-note',
  /** จ่ายไม่ผ่าน + ใบเสร็จจำลอง (feature 09 · เฟส 5) */
  unpaidPill: (orderId: string) => `#order-unpaid-${orderId}`,
  unpaidCard: '#order-unpaid',
  retryPayment: '#order-retry-payment',
  receiptOpen: '#order-receipt-open',
  receipt: '#order-receipt',
  receiptNo: '#order-receipt-no',
  receiptAmount: '#order-receipt-amount',
  /** ส่วนลดคูปองของรอบนี้ (feature 18) — มีเฉพาะออเดอร์ที่ใช้คูปอง */
  discount: '#order-discount',
  receiptDiscount: '#order-receipt-discount',
  receiptRefunded: '#order-receipt-refunded',
  receiptClose: '#order-receipt-close',
  /** ร้านยกเลิก + คืนเงิน (feature 15) */
  cancelBanner: '#order-cancel-banner',
  cancelReason: '#order-cancel-reason',
  refundBadge: '#order-refund-badge',
} as const;

/** `anan/app/(seller)/shop.tsx` + `anan/app/(buyer)/profile/open-shop.tsx` */
export const shopSettings = {
  name: '#shop-name',
  description: '#shop-description',
  logo: '#shop-logo',
  save: '#shop-save',
  saved: '#shop-saved',
  error: '#shop-error',
  toggleActive: '#shop-toggle-active',
  switchToBuyer: '#shop-switch-buyer',
  suspendedPill: '#shop-suspended',
  suspendedNote: '#shop-suspended-note',
  closedPill: '#shop-closed',
  openName: '#open-shop-name',
  openDescription: '#open-shop-description',
  openSubmit: '#open-shop-submit',
  openError: '#open-shop-error',
} as const;

/** `anan/app/(buyer)/profile/index.tsx` */
export const profile = {
  displayName: '#profile-display-name',
  email: '#profile-email',
  name: '#profile-name',
  nameError: '#profile-name-error',
  phone: '#profile-phone',
  save: '#profile-save',
  saved: '#profile-saved',
  error: '#profile-error',
  linkAddresses: '#profile-link-addresses',
  /** ModeSwitcher — ปุ่มเปลี่ยนความหมายตามว่ามีร้านแล้วหรือยัง (W02) */
  linkOpenShop: '#profile-link-open-shop',
  linkSeller: '#profile-link-seller',
  linkAdmin: '#profile-link-admin',
  linkCards: '#profile-link-cards',
  signOut: '#profile-signout',
} as const;

/** `anan/app/(buyer)/profile/addresses.tsx` */
export const addresses = {
  empty: '#address-empty',
  createFirst: '#address-create-first',
  create: '#address-create',
  listError: '#address-list-error',
  form: '#address-form',
  formError: '#address-form-error',
  label: '#address-label',
  recipient: '#address-recipient',
  recipientError: '#address-recipient-error',
  phone: '#address-phone',
  line: '#address-line',
  province: '#address-province',
  postcode: '#address-postcode',
  postcodeError: '#address-postcode-error',
  toggleDefault: '#address-toggle-default',
  submit: '#address-submit',
  cancel: '#address-cancel',
  item: (id: string) => `#address-item-${id}`,
  defaultBadge: (id: string) => `#address-default-${id}`,
  edit: (id: string) => `#address-edit-${id}`,
  setDefault: (id: string) => `#address-set-default-${id}`,
  remove: (id: string) => `#address-delete-${id}`,
} as const;

/** `anan/app/compare.tsx` + `anan/src/features/compare/*` (feature 04) */
export const compare = {
  toggle: (productId: string) => `#category-compare-${productId}`,
  toast: '#category-compare-toast',
  restart: '#category-compare-restart',
  tray: '#compare-tray',
  trayOpen: '#compare-tray-open',
  trayClear: '#compare-tray-clear',
  empty: '#compare-empty',
  clear: '#compare-clear',
  column: (productId: string) => `#compare-col-${productId}`,
  remove: (productId: string) => `#compare-remove-${productId}`,
  row: (key: string) => `#compare-row-${key}`,
  cell: (rowKey: string, productId: string) => `#compare-${rowKey}-${productId}`,
  subscribe: (productId: string) => `#compare-subscribe-${productId}`,
} as const;

/**
 * `anan/src/features/notifications/NotificationFeed.tsx` (feature 08)
 *
 * กล่องเดียวกันถูกใช้สองที่ ต่างกันที่ `idPrefix` — ผู้ซื้อ `noti-*`
 * และคอนโซลร้าน `seller-noti-*` (ดู `sellerNotifications` ด้านล่าง)
 */
export const notifications = {
  tab: (tab: 'all' | 'unread') => `#noti-tab-${tab}`,
  markAll: '#noti-mark-all',
  empty: '#noti-empty',
  error: '#noti-error',
  item: (id: number) => `#noti-item-${id}`,
  unreadDot: (id: number) => `#noti-dot-${id}`,
} as const;

/** `anan/app/(seller)/notifications.tsx` — กล่องแจ้งเตือนของคอนโซลร้าน */
export const sellerNotifications = {
  tab: (tab: 'all' | 'unread') => `#seller-noti-tab-${tab}`,
  markAll: '#seller-noti-mark-all',
  empty: '#seller-noti-empty',
  error: '#seller-noti-error',
  item: (id: number) => `#seller-noti-item-${id}`,
  unreadDot: (id: number) => `#seller-noti-dot-${id}`,
} as const;

/**
 * `anan/src/components/console/*` — เปลือกของคอนโซลแต่ละบทบาท
 *
 * แถบนำทาง ตัวตนบนหัว ตัวสลับโหมด และปุ่มออกจากระบบ ใช้ component ชุดเดียว
 * ทั้งสามโหมด id จึงตั้งเป็นชุดเดียวกัน (`nav-<role>-<หน้า>`)
 */
export const shell = {
  /** ชื่อบนหัวคอนโซล — ฝั่งร้านคือชื่อร้านจริง */
  brand: '#console-brand',
  /** บรรทัดบอกโหมด: "โหมดผู้ซื้อ" / "โหมดร้านค้า" / "โหมดผู้ดูแลระบบ" */
  role: '#console-role',
  signOut: '#console-signout',
  switchTo: (role: 'buyer' | 'seller' | 'admin') => `#mode-switch-${role}`,
  navBuyer: {
    home: '#nav-buyer-home',
    subscriptions: '#nav-buyer-subscriptions',
    orders: '#nav-buyer-orders',
    notifications: '#nav-buyer-notifications',
    profile: '#nav-buyer-profile',
  },
  navSeller: {
    overview: '#nav-seller-overview',
    products: '#nav-seller-products',
    orders: '#nav-seller-orders',
    notifications: '#nav-seller-notifications',
    shop: '#nav-seller-shop',
  },
  /** ตัวเลขที่ยังไม่ได้อ่านบนเมนู — ไม่มีธาตุนี้เลยแปลว่าอ่านครบแล้ว */
  navBadge: (navId: string) => `${navId}-badge`,
} as const;

/** `anan/app/(admin)/settings.tsx` — ตั้งค่าเมลของระบบ */
export const mailSettings = {
  statusMode: '#mail-status-mode',
  statusSmtp: '#mail-status-smtp',
  /** แถบเตือนที่ขึ้นเฉพาะตอนโหมดเปลี่ยนเส้นทางทำงานอยู่ */
  activeWarning: '#mail-active-warning',
  /** ขึ้นเมื่อเครื่องไม่อนุญาตให้เปิดโหมด (`MAIL_UAT_MODE_AVAILABLE` ไม่ใช่ true) */
  lockedNote: '#mail-locked-note',
  toggle: '#mail-redirect-toggle',
  redirectTo: '#mail-redirect-to',
  redirectCc: '#mail-redirect-cc',
  smtpHost: '#mail-smtp-host',
  smtpPort: '#mail-smtp-port',
  smtpSecure: '#mail-smtp-secure',
  mailFrom: '#mail-from',
  save: '#mail-settings-save',
  error: '#mail-settings-error',
  toast: '#mail-settings-toast',
} as const;

/** `anan/app/(admin)/logs.tsx` — log ระบบ (2 แท็บ) */
export const adminLogs = {
  tab: (key: 'audit' | 'email') => `#admin-logs-tab-${key}`,
  filterAll: '#admin-logs-filter-all',
  filter: (key: string) => `#admin-logs-filter-${key}`,
  auditRow: (id: number) => `#admin-audit-${id}`,
  auditSummary: (id: number) => `#admin-audit-summary-${id}`,
  anyAuditRow: '[id^="admin-audit-"]',
  emailRow: (id: number) => `#admin-email-${id}`,
  emailIntended: (id: number) => `#admin-email-intended-${id}`,
  emailActual: (id: number) => `#admin-email-actual-${id}`,
  emailRedirected: (id: number) => `#admin-email-redirected-${id}`,
  anyEmailRow: '[id^="admin-email-"]',
  auditEmpty: '#admin-logs-audit-empty',
  emailEmpty: '#admin-logs-email-empty',
  error: '#admin-logs-error',
  page: '#admin-logs-page',
  prev: '#admin-logs-prev',
  next: '#admin-logs-next',
} as const;

/** `anan/app/shop/[id].tsx` — หน้าร้านสาธารณะ */
export const shopPage = {
  card: '#shop-page',
  productCount: '#shop-product-count',
  grid: '#shop-grid',
  notFound: '#shop-not-found',
  product: (productId: string) => `#shop-product-${productId}`,
  /** ★ ห้ามใช้ `#shop-name` — ชนกับหน้า shop-settings ฝั่งร้าน ★ (feature 02, 2026-08-30) */
  name: '#shop-page-name',
  /** แถบสถิติ 4 ช่อง — ตัวเลขมาจาก aggregate เดียวกับ `search.shop()` บนหน้าค้นหา */
  statProducts: '#shop-stat-products',
  statSubscribers: '#shop-stat-subscribers',
  statRating: '#shop-stat-rating',
  /** วันที่แสดงเป็น พ.ศ. (locale th-TH) — อย่า assert ข้อความวันที่ แค่เช็คว่ามี element */
  statJoined: '#shop-stat-joined',
} as const;

/** `anan/app/(buyer)/profile/payment-methods.tsx` (feature 09) */
export const cards = {
  empty: '#cards-empty',
  error: '#cards-error',
  toast: '#cards-toast',
  item: (id: string) => `#card-${id}`,
  remove: (id: string) => `#card-delete-${id}`,
  /** ฟอร์มผูกบัตร — `anan/src/features/payment/CardForm.tsx` */
  preview: '#card-preview',
  number: '#card-number',
  expiry: '#card-expiry',
  cvv: '#card-cvv',
  holder: '#card-holder',
  add: '#card-add',
  /** error ที่ API ตอบกลับ · error รายช่องมาจาก TextField เป็น `<id>-error` */
  formError: '#card-form-error',
  numberError: '#card-number-error',
  expiryError: '#card-expiry-error',
  cvvError: '#card-cvv-error',
  holderError: '#card-holder-error',
} as const;

/** `anan/app/(seller)/products/[id].tsx` — แก้ไขสินค้าเต็มรูป */
export const sellerEdit = {
  open: (productId: string) => `#seller-product-edit-${productId}`,
  card: '#seller-edit-card',
  name: '#seller-edit-name',
  description: '#seller-edit-description',
  image: '#seller-edit-image',
  category: (categoryId: number) => `#seller-edit-category-${categoryId}`,
  oneTime: '#seller-edit-one-time',
  net: '#seller-edit-net',
  unit: '#seller-edit-unit',
  save: '#seller-edit-save',
  saved: '#seller-edit-saved',
  error: '#seller-edit-error',
  /** คูปองที่ร่วมรายการ (`anan/src/features/coupons/ProductCouponPicker.tsx`) */
  couponsCard: '#seller-coupons-card',
  couponsEmpty: '#seller-coupons-empty',
  couponsSave: '#seller-coupons-save',
  couponsSaved: '#seller-coupons-saved',
  couponsError: '#seller-coupons-error',
  coupon: (couponId: string) => `#seller-coupon-${couponId}`,
  couponCost: (couponId: string) => `#seller-coupon-cost-${couponId}`,
  /** นโยบายคูปองรายสินค้า (feature 18 รอบ 2) — ร้านตั้งเองว่ารับระดับไหนบ้าง */
  couponPolicy: (p: 'both' | 'platform_only' | 'shop_only' | 'none') =>
    `#seller-coupon-policy-${p}`,
  couponGroup: (tier: 'platform' | 'shop') => `#seller-coupon-group-${tier}`,
  couponsEmptyTier: (tier: 'platform' | 'shop') =>
    `#seller-coupons-empty-${tier}`,
  /** ป้าย "ครอบอยู่แล้วเพราะตั้งเป็นทั้งร้าน" — checkbox ถูกล็อกไว้ */
  couponCoveredAll: (couponId: string) => `#seller-coupon-all-${couponId}`,
} as const;

/** `anan/app/(seller)/coupons.tsx` — คูปองที่ร้านออกเอง (feature 18 รอบ 2) */
export const sellerCoupons = {
  nav: '#nav-seller-coupons',
  error: '#seller-coupons-page-error',
  toast: '#seller-coupons-toast',
  empty: '#seller-coupons-page-empty',
  code: '#seller-coupon-code',
  title: '#seller-coupon-title',
  type: (t: 'percent' | 'fixed') => `#seller-coupon-type-${t}`,
  value: '#seller-coupon-value',
  cap: '#seller-coupon-cap',
  min: '#seller-coupon-min',
  starts: '#seller-coupon-starts',
  ends: '#seller-coupon-ends',
  /** ปฏิทินของ DateField (`anan/src/components/DateField.tsx`) — พิมพ์เองก็ยังได้ */
  startsOpen: '#seller-coupon-starts-open',
  endsOpen: '#seller-coupon-ends-open',
  endsCalendar: '#seller-coupon-ends-calendar',
  endsMonth: '#seller-coupon-ends-month',
  endsPrevMonth: '#seller-coupon-ends-prev',
  endsNextMonth: '#seller-coupon-ends-next',
  /** วันในปฏิทิน — รับ `YYYY-MM-DD` */
  endsDay: (iso: string) => `#seller-coupon-ends-day-${iso}`,
  endsToday: '#seller-coupon-ends-today',
  quota: '#seller-coupon-quota',
  scope: (s: 'all' | 'some') => `#seller-coupon-scope-${s}`,
  product: (productId: string) => `#seller-coupon-product-${productId}`,
  create: '#seller-coupon-create',
  item: (couponId: string) => `#seller-coupon-item-${couponId}`,
  itemLabel: (couponId: string) => `#seller-coupon-label-${couponId}`,
  itemUsage: (couponId: string) => `#seller-coupon-usage-${couponId}`,
  itemState: (couponId: string) => `#seller-coupon-state-${couponId}`,
  itemDeactivate: (couponId: string) => `#seller-coupon-deactivate-${couponId}`,
} as const;

/** `anan/app/(admin)/*` — โหมดผู้ดูแล (feature 14) */
export const admin = {
  navOverview: '#nav-admin-overview',
  navCategories: '#nav-admin-categories',
  navModeration: '#nav-admin-moderation',
  navCoupons: '#nav-admin-coupons',
  navEngine: '#nav-admin-engine',
  navLogs: '#nav-admin-logs',
  navSettings: '#nav-admin-settings',
  error: '#admin-error',
  /** dashboard */
  statUsers: '#admin-stat-users',
  statShops: '#admin-stat-shops',
  statProducts: '#admin-stat-products',
  statSubscriptions: '#admin-stat-subscriptions',
  statOrdersToday: '#admin-stat-orders-today',
  statMrr: '#admin-stat-mrr',
  statCancelled: '#admin-stat-cancelled',
  statIssues: '#admin-stat-issues',
  recentRuns: '#admin-recent-runs',
  /** หมวดสินค้า */
  categoryName: '#admin-category-name',
  categoryIcon: '#admin-category-icon',
  categoryAdd: '#admin-category-add',
  categoriesError: '#admin-categories-error',
  categoriesToast: '#admin-categories-toast',
  category: (id: number) => `#admin-category-${id}`,
  categoryCount: (id: number) => `#admin-category-count-${id}`,
  categoryEdit: (id: number) => `#admin-category-edit-${id}`,
  categoryDelete: (id: number) => `#admin-category-delete-${id}`,
  categoryEditName: '#admin-category-edit-name',
  categoryEditSave: '#admin-category-edit-save',
  /** moderation */
  modTab: (tab: 'shops' | 'products' | 'issues') => `#admin-mod-tab-${tab}`,
  modSearch: '#admin-mod-search',
  modError: '#admin-mod-error',
  modToast: '#admin-mod-toast',
  shop: (shopId: string) => `#admin-shop-${shopId}`,
  shopStatus: (shopId: string) => `#admin-shop-status-${shopId}`,
  shopSubs: (shopId: string) => `#admin-shop-subs-${shopId}`,
  shopIssues: (shopId: string) => `#admin-shop-issues-${shopId}`,
  shopCancels: (shopId: string) => `#admin-shop-cancels-${shopId}`,
  shopSuspend: (shopId: string) => `#admin-shop-suspend-${shopId}`,
  productSuspend: (productId: string) => `#admin-product-suspend-${productId}`,
  suspendModal: '#admin-suspend-modal',
  suspendWarning: '#admin-suspend-warning',
  suspendReason: '#admin-suspend-reason',
  suspendConfirm: '#admin-suspend-confirm',
  suspendClose: '#admin-suspend-close',
  issue: (issueId: string) => `#admin-issue-${issueId}`,
  issuesEmpty: '#admin-issues-empty',
  /** engine */
  engineDate: '#admin-engine-date',
  engineRun: '#admin-engine-run',
  engineToast: '#admin-engine-toast',
  engineError: '#admin-engine-error',
  engineRuns: '#admin-engine-runs',
  /** คูปอง (`anan/app/(admin)/coupons.tsx` · feature 18 · W13 Flow A) */
  couponsError: '#admin-coupons-error',
  couponsToast: '#admin-coupons-toast',
  couponsEmpty: '#admin-coupons-empty',
  couponsTab: (tab: 'active' | 'inactive' | 'all') => `#admin-coupons-tab-${tab}`,
  couponCode: '#admin-coupon-code',
  couponTitle: '#admin-coupon-title',
  couponType: (t: 'percent' | 'fixed') => `#admin-coupon-type-${t}`,
  couponValue: '#admin-coupon-value',
  couponCap: '#admin-coupon-cap',
  couponMin: '#admin-coupon-min',
  couponStarts: '#admin-coupon-starts',
  couponEnds: '#admin-coupon-ends',
  /** ปฏิทินของ DateField (`anan/src/components/DateField.tsx`) — พิมพ์เองก็ยังได้ */
  couponStartsOpen: '#admin-coupon-starts-open',
  couponEndsOpen: '#admin-coupon-ends-open',
  couponEndsCalendar: '#admin-coupon-ends-calendar',
  couponEndsMonth: '#admin-coupon-ends-month',
  couponEndsPrevMonth: '#admin-coupon-ends-prev',
  couponEndsNextMonth: '#admin-coupon-ends-next',
  /** วันในปฏิทิน — รับ `YYYY-MM-DD` */
  couponEndsDay: (iso: string) => `#admin-coupon-ends-day-${iso}`,
  couponEndsToday: '#admin-coupon-ends-today',
  couponQuota: '#admin-coupon-quota',
  couponCreate: '#admin-coupon-create',
  coupon: (id: string) => `#admin-coupon-${id}`,
  couponLabel: (id: string) => `#admin-coupon-label-${id}`,
  couponUsage: (id: string) => `#admin-coupon-usage-${id}`,
  couponState: (id: string) => `#admin-coupon-state-${id}`,
  couponDeactivate: (id: string) => `#admin-coupon-deactivate-${id}`,
  /** ระดับของคูปองบนแถว + ตัวกรองระดับ (feature 18 รอบ 2) */
  couponTier: (id: string) => `#admin-coupon-tier-${id}`,
  couponsTierTab: (t: 'all' | 'platform' | 'shop') =>
    `#admin-coupons-tier-${t}`,
} as const;

/** `anan/src/components/ui.tsx` — ตัวโหลดเต็มจอ ใช้รอให้หน้าจอ resolve เสร็จ */
export const splash = '#splash';
