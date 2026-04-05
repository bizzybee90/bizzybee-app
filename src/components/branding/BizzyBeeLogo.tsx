import standardLogo from '@/assets/bizzybee-logo-standard.svg';
import beeMark from '@/assets/bee-logo.png';
import { cn } from '@/lib/utils';

type BizzyBeeLogoVariant = 'full' | 'mark';
type BizzyBeeLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'hero';
type BizzyBeeLogoChip = 'none' | 'light' | 'gold' | 'dark';

interface BizzyBeeLogoProps {
  variant?: BizzyBeeLogoVariant;
  size?: BizzyBeeLogoSize;
  chip?: BizzyBeeLogoChip;
  className?: string;
  imgClassName?: string;
  alt?: string;
}

const fullSizeClasses: Record<BizzyBeeLogoSize, string> = {
  xs: 'h-5 w-auto',
  sm: 'h-6 w-auto',
  md: 'h-8 w-auto',
  lg: 'h-10 w-auto',
  xl: 'h-14 w-auto',
  hero: 'h-20 w-auto sm:h-24',
};

const markSizeClasses: Record<BizzyBeeLogoSize, string> = {
  xs: 'h-5 w-5',
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
  xl: 'h-12 w-12',
  hero: 'h-16 w-16 sm:h-20 sm:w-20',
};

const chipClasses: Record<BizzyBeeLogoChip, string> = {
  none: '',
  light:
    'rounded-2xl border border-[#eadfcb] bg-[#fffaf1] px-3 py-2 shadow-[0_10px_30px_rgba(28,21,16,0.08)]',
  gold: 'rounded-2xl border border-[#e7c87a] bg-[#f4d173] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.26)]',
  dark: 'rounded-2xl border border-[#4c3520] bg-[#1b140d]/90 px-3 py-2 shadow-[0_20px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl',
};

export function BizzyBeeLogo({
  variant = 'full',
  size = 'md',
  chip = 'none',
  className,
  imgClassName,
  alt = 'BizzyBee',
}: BizzyBeeLogoProps) {
  const src = variant === 'full' ? standardLogo : beeMark;
  const sizeClass = variant === 'full' ? fullSizeClasses[size] : markSizeClasses[size];

  return (
    <div className={cn('inline-flex items-center justify-center', chipClasses[chip], className)}>
      <img src={src} alt={alt} className={cn('block object-contain', sizeClass, imgClassName)} />
    </div>
  );
}
