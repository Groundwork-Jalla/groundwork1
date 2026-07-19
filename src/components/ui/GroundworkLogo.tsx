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
  sm: { wordmark: 'text-sm',             byline: 'text-[9px]'           },
  md: { wordmark: 'text-base',           byline: 'text-[10px]'          },
  lg: { wordmark: 'text-lg',             byline: 'text-[11px]'          },
  xl: { wordmark: 'text-xl sm:text-2xl', byline: 'text-[10px] sm:text-xs' },
};

export function GroundworkLogo({
  linkTo,
  size = 'md',
  variant = 'dark',
  showByline = true,
  className,
}: GroundworkLogoProps) {
  const { wordmark, byline } = sizeMap[size];

  const primaryColor   = variant === 'light' ? 'text-white'     : 'text-brand-near-black';
  const secondaryColor = variant === 'light' ? 'text-white/55'  : 'text-brand-mid-grey';

  const inner = (
    <span className={cn('inline-flex flex-col items-start leading-none', className)}>
      <span className={cn('font-sans font-black tracking-tight', wordmark, primaryColor)}>
        Groundwork
      </span>
      {showByline && (
        <span className={cn('font-sans font-medium tracking-wide mt-0.5', byline, secondaryColor)}>
          by Jalla
        </span>
      )}
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
