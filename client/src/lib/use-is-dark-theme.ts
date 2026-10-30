import { useEffect, useState } from 'react';

function readIsDark(): boolean {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  return root.dataset.theme === 'dark' || root.classList.contains('dark');
}

export function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(readIsDark);

  useEffect(() => {
    setDark(readIsDark());
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(readIsDark()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}
