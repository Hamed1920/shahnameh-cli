import { HelpTip } from '@/components/ui/help-tip'

/**
 * The asset `role` vocabulary, explained in Persian for the reviewer.
 * English definitions live in 00_PROJECT/INDEXING.md section 8 -- keep the two in step.
 */
const ROLES: { role: string; text: string; example?: string }[] = [
  {
    role: 'HERO',
    text: 'تصویر اصلی؛ اولین و بهترین تصویری که نشان می‌دهد این چیز چه شکلی است.',
    example: 'نمای بنای سیاه LOC-007',
  },
  {
    role: 'PLATE',
    text: 'یک ظاهر یا نسخهٔ مشخص. چند PLATE از یک چیز کنار هم به‌صورت V01، V02 و … قرار می‌گیرند.',
    example: 'ضحاک V01 با عصای ساده، V02 با ردای اژدها',
  },
  {
    role: 'TURNAROUND',
    text: 'یک شیء از چند زاویه (رو، پهلو، پشت) در یک برگه.',
    example: 'برگهٔ چرخشی عصای کبرا PRP-001',
  },
  {
    role: 'DETAIL',
    text: 'نمای نزدیک از یک بخش؛ مثل نقاب، دست یا نقش‌ونگار.',
  },
  {
    role: 'BOARD',
    text: 'صفحهٔ حال‌وهوا یا مجموعه‌ای از چند تصویر در یک شبکه، نه یک شیء تنها.',
    example: 'برگهٔ طبقات تمدن REF-001',
  },
  {
    role: 'RENDER',
    text: 'ویدیو یا تصویری که ساخته شده و در پنل تأیید شده است. خود سیستم این را می‌گذارد، برای همین در این فهرست نیست.',
  },
]

export function RoleHelp() {
  return (
    <HelpTip label="What does role mean?" dir="rtl" lang="fa" width={400}>
      <p className="text-[13px] font-semibold text-fg">«نقش» یعنی چه؟</p>
      <p className="mt-1 text-muted">
        نقش فقط برچسبی است که می‌گوید این تصویر چه نوع تصویری است. روی ساخت ویدیو هیچ اثری ندارد
        و فقط برای مرتب نگه‌داشتن فایل‌هاست.
      </p>

      <dl className="mt-3 space-y-2.5">
        {ROLES.map((r) => (
          <div key={r.role}>
            <dt>
              <span dir="ltr" className="font-mono text-[11px] font-semibold text-fg">
                {r.role}
              </span>
            </dt>
            <dd className="text-muted">
              {r.text}
              {r.example && <span className="block text-faint">مثال: {r.example}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 border-t border-edge pt-2.5 text-muted">
        <span className="text-fg">اگر مطمئن نیستید:</span> اولین تصویر خوب از یک چیز جدید ←{' '}
        <span dir="ltr" className="font-mono">HERO</span>، ظاهر دیگری از چیزی که از قبل تصویر دارد ←{' '}
        <span dir="ltr" className="font-mono">PLATE</span>، کلاژ یا شبکهٔ حال‌وهوا ←{' '}
        <span dir="ltr" className="font-mono">BOARD</span>. گزینهٔ پیش‌فرض{' '}
        <span dir="ltr" className="font-mono">PLATE</span> همیشه قابل قبول است.
      </p>
    </HelpTip>
  )
}
