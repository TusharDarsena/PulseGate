import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useXlmPrice() {
  const [usdPerXlm, setUsdPerXlm] = useState<number | null>(null);

  useEffect(() => {
    async function fetchPrice() {
      const { data, error } = await supabase
        .from('app_cache')
        .select('value')
        .eq('key', 'xlm_usd_price')
        .single();
      
      if (!error && data && data.value && typeof data.value.price === 'number') {
        setUsdPerXlm(data.value.price);
      }
    }
    fetchPrice();
  }, []);

  return { usdPerXlm };
}
