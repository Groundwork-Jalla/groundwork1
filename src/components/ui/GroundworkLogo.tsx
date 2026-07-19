import { Link } from 'react-router';
import { cn } from '@/lib/utils';

interface GroundworkLogoProps {
  linkTo?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'dark' | 'light';
  showByline?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { jalla: 'text-[10px]', wordmark: 'text-sm',            divider: 'h-3.5' },
  md: { jalla: 'text-[11px]', wordmark: 'text-base',          divider: 'h-4'   },
  lg: { jalla: 'text-xs',     wordmark: 'text-lg',            divider: 'h-5'   },
  xl: { jalla: 'text-xs sm:text-sm', wordmark: 'text-xl sm:text-2xl', divider: 'h-5 sm:h-6' },
};

export function GroundworkLogo({
  linkTo,
  size = 'md',
  variant = 'dark',
  showByline = true,
  className,
}: GroundworkLogoProps) {
  const { jalla, wordmark, divider } = sizeMap[size];

  const primaryColor  = variant === 'light' ? 'text-white'      : 'text-brand-near-black';
  const secondaryColor = variant === 'light' ? 'text-white/60'  : 'text-brand-mid-grey';
  const dividerColor  = variant === 'light' ? 'bg-white/30'     : 'bg-brand-border-grey';

  const inner = (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {showByline && (
        <span className={cn('font-sans font-semibold tracking-wide uppercase', jalla, secondaryColor)}>
          by Jalla
        </span>
      )}
      {showByline && (
        <span className={cn('w-px self-stretch my-0.5 rounded-full', divider, dividerColor)} />
      )}
      <span className={cn('font-sans font-black tracking-tight leading-none', wordmark, primaryColor)}>
        Groundwork
      </span>
    </span>
  );

  if (!linkTo) return inner;

  return (
    <Link
      to={linkTo}
      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current rounded-sm"
    >
      {inner}
    </Link>
  );
}
