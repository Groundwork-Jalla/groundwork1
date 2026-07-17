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
  sm: { wordmark: 'text-sm',           byline: 'text-[10px]' },
  md: { wordmark: 'text-base',         byline: 'text-[11px]' },
  lg: { wordmark: 'text-lg',           byline: 'text-xs' },
  xl: { wordmark: 'text-xl sm:text-2xl', byline: 'text-[11px] sm:text-sm' },
};

export function GroundworkLogo({
  linkTo,
  size = 'md',
  variant = 'dark',
  showByline = true,
  className,
}: GroundworkLogoProps) {
  const { wordmark, byline } = sizeMap[size];

  const wordmarkColor = variant === 'light'
    ? 'text-white'
    : 'text-brand-near-black';

  const bylineColor = variant === 'light'
    ? 'text-white/50'
    : 'text-brand-mid-grey';

  const inner = (
    <span className={cn('flex flex-col leading-none', className)}>
      <span className={cn('font-sans font-black tracking-tight', wordmark, wordmarkColor)}>
        Groundwork
      </span>
      {showByline && (
        <span className={cn('font-normal mt-0.5', byline, bylineColor)}>
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
