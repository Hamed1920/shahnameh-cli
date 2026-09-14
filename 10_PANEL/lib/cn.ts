import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Compose class names, letting later classes win over earlier ones in the same
 * Tailwind group. Lets a primitive ship a default (`bg-panel`) that a caller
 * can override (`bg-raise`) without the two fighting on specificity.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
