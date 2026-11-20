import { useEffect, useRef } from 'react';
import { useProductConfig } from '@/hooks/useProductConfig';
import { startTour, tourSeen, stopTour, tourRunning } from '@/lib/tour';
import { useAuth } from '@/store/auth';
export function TourBootstrap() {
  const q = useProductConfig(),
    id = useAuth((s) => s.user?.id),
    started = useRef(false);
  useEffect(() => {
    if (!id || q.isLoading || q.isError || started.current) return;
    const timer = setTimeout(() => {
      if (!tourSeen()) {
        started.current = true;
        if (!tourRunning()) startTour();
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [id, q.isLoading, q.isError]);
  useEffect(() => () => stopTour(), [id]);
  return null;
}
