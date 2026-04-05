import { useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const SearchInput = ({ value, onChange, placeholder = 'Search...' }: SearchInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hadFocusRef = useRef(false);

  // Track if input had focus before re-render
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const onFocus = () => {
      hadFocusRef.current = true;
    };
    const onBlur = () => {
      hadFocusRef.current = false;
    };

    input.addEventListener('focus', onFocus);
    input.addEventListener('blur', onBlur);
    return () => {
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('blur', onBlur);
    };
  }, []);

  // Restore focus after re-render if it was focused before
  useEffect(() => {
    if (hadFocusRef.current && inputRef.current) {
      inputRef.current.focus();
    }
  });

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-bb-warm-gray" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-9 text-ellipsis bg-bb-white"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-bb-warm-gray"
          onClick={() => onChange('')}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
};
