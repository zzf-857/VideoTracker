import React, { useState, useRef, useEffect } from 'react';

export interface SelectOption {
  value: any;
  label: string;
}

interface CustomSelectProps {
  value: any;
  onChange: (value: any) => void;
  options: SelectOption[];
  className?: string;
  variant?: 'card' | 'flat';
  dropdownAlign?: 'left' | 'right';
  fullWidth?: boolean;
}

export default function CustomSelect({
  value,
  onChange,
  options,
  className = '',
  variant = 'card',
  dropdownAlign = 'left',
  fullWidth = false
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value) || options[0];

  // 点击外部关闭下拉菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (val: any) => {
    onChange(val);
    setIsOpen(false);
  };

  const isFlat = variant === 'flat';

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* 下拉触发按钮 */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between gap-1 transition-all duration-200 cursor-pointer select-none text-left w-full ${
          isFlat
            ? 'text-[10px] font-extrabold text-on-surface-variant hover:text-on-surface bg-transparent p-0'
            : 'px-3 py-1.5 text-xs border border-black/10 rounded-lg font-bold bg-white text-on-surface shadow-sm hover:border-black/20 hover:shadow-md active:scale-95'
        }`}
      >
        <span className="truncate">{selectedOption?.label || ''}</span>
        <span className={`material-symbols-outlined transition-transform duration-200 ${
          isFlat ? 'text-[11px]' : 'text-[16px] text-on-surface-variant'
        } ${isOpen ? 'rotate-180' : ''}`}>
          keyboard_arrow_down
        </span>
      </button>

      {/* 下拉选择面板 */}
      {isOpen && (
        <div
          className={`absolute z-[250] mt-1.5 py-1 rounded-xl bg-white/90 backdrop-blur-md border border-black/5 shadow-xl min-w-[130px] max-h-60 overflow-y-auto custom-scrollbar ${
            dropdownAlign === 'right' ? 'right-0' : 'left-0'
          } ${fullWidth ? 'w-full left-0 right-0' : ''}`}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={`w-full text-left px-3 py-1.5 text-[11px] font-semibold transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                  isSelected
                    ? 'bg-primary text-white font-bold'
                    : 'text-on-surface hover:bg-black/[0.04]'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && (
                  <span className="material-symbols-outlined text-[12px] font-bold">check</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
