import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Playback clock for the heat map. With a media file it follows the <video>/<audio> element; the
 * demo and transcript-only analyses have no media, so a virtual clock plays through the timeline.
 */
export interface PlayClock {
  now(): number;
  playing(): boolean;
  /** virtual clock only (media files use their own player controls) */
  play(): void;
  pause(): void;
  seek(t: number): void;
  virtual: boolean;
}

export function usePlayClock(player: React.RefObject<HTMLMediaElement | null>, hasMedia: boolean, duration: number, onTick: (t: number) => void): { clock: PlayClock; isPlaying: boolean } {
  const v = useRef({ offset: 0, startedAt: 0, running: false });
  const [isPlaying, setIsPlaying] = useState(false);
  const tick = useRef(onTick);
  tick.current = onTick;

  const clock = useMemo<PlayClock>(() => {
    const vnow = () => {
      const s = v.current;
      const t = s.running ? s.offset + (performance.now() - s.startedAt) / 1000 : s.offset;
      return Math.min(duration, Math.max(0, t));
    };
    return {
      virtual: !hasMedia,
      now: () => (hasMedia ? (player.current?.currentTime ?? 0) : vnow()),
      playing: () => (hasMedia ? !!player.current && !player.current.paused && !player.current.ended : v.current.running),
      play: () => {
        if (hasMedia) return void player.current?.play().catch(() => undefined);
        const s = v.current;
        if (s.running) return;
        if (s.offset >= duration - 0.05) s.offset = 0;
        s.startedAt = performance.now();
        s.running = true;
        setIsPlaying(true);
      },
      pause: () => {
        if (hasMedia) return void player.current?.pause();
        const s = v.current;
        s.offset = vnow();
        s.running = false;
        setIsPlaying(false);
      },
      seek: (t: number) => {
        if (hasMedia) {
          if (player.current) player.current.currentTime = t;
          return;
        }
        const s = v.current;
        s.offset = Math.min(duration, Math.max(0, t));
        s.startedAt = performance.now();
      },
    };
  }, [player, hasMedia, duration]);

  // reset the virtual clock for each new session
  useEffect(() => {
    v.current = { offset: 0, startedAt: 0, running: false };
    setIsPlaying(false);
  }, [clock]);

  // the virtual clock reports its time a few times a second (the media element does this itself)
  useEffect(() => {
    if (hasMedia || !isPlaying) return;
    const id = window.setInterval(() => {
      const t = clock.now();
      tick.current(t);
      if (t >= duration) clock.pause();
    }, 200);
    return () => window.clearInterval(id);
  }, [clock, hasMedia, isPlaying, duration]);

  // (a media element reports its own play state; `isPlaying` tracks the virtual clock)
  return { clock, isPlaying };
}
