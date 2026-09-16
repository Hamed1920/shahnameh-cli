import { cn } from '@/lib/cn'

/** One recipe for every text control in the panel. Flat: a hairline that brightens on focus. */
export const CONTROL = cn(
  'w-full rounded-md border border-edge-strong bg-white/[0.02] px-3 py-2 text-sm text-fg',
  'placeholder:text-faint',
  'transition-[background-color,border-color] duration-150',
  'hover:border-[#505050]',
  'focus:border-fg/45 focus:bg-transparent focus:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-50',
)
