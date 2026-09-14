import { cn } from '@/lib/cn'

/**
 * Shared table shell for /entities and /queue. The wrapper owns the horizontal
 * scroll pane so a wide table scrolls inside its own border rather than
 * widening the page.
 */
export function Table({ className, children }: React.ComponentProps<'table'>) {
  return (
    <div className="scroll-pane-x rounded-xl border border-edge bg-panel/60">
      <table className={cn('w-full border-collapse text-sm', className)}>{children}</table>
    </div>
  )
}

export function Thead({ children }: React.ComponentProps<'thead'>) {
  return <thead className="text-left text-faint">{children}</thead>
}

export function Th({ className, children, ...props }: React.ComponentProps<'th'>) {
  return (
    <th className={cn('eyebrow px-5 pt-4 pb-3.5 font-medium whitespace-nowrap', className)} {...props}>
      {children}
    </th>
  )
}

export function Tr({ className, children, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-t border-edge align-top transition-colors duration-150 hover:bg-white/[0.02]',
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  )
}

export function Td({ className, children, ...props }: React.ComponentProps<'td'>) {
  return (
    <td className={cn('px-5 py-4', className)} {...props}>
      {children}
    </td>
  )
}
