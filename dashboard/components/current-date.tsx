'use client';

import { useState, useEffect } from 'react';
import { formatDate } from '@/lib/formatters';

export function CurrentDate() {
  const [dateStr, setDateStr] = useState('');

  useEffect(() => {
    setDateStr(formatDate(new Date(), 'EEEE, MMMM d, yyyy'));
  }, []);

  return <>{dateStr}</>;
}
