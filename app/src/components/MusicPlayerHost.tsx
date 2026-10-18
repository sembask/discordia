import { useEffect, useRef, useState } from 'react';
import { music } from '../lib/music';
import { useStore } from '../lib/store';

/**
 * O iframe do player existe UMA vez só (recriar recomeçaria a música).
 * Ele flutua por cima de onde a interface reservou espaço: o elemento com
 * `data-music-slot` (mini-player no canto ou o palco, no "assistir juntos").
 */
export function MusicPlayerHost() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [src] = useState(() => music.playerUrl());
  const hasMusic = useStore(music.store, (s) => !!s.state && s.state.index >= 0 && !s.state.ended);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    music.attach(el);
    return () => music.detach(el);
  }, []);

  // Acompanha o lugar reservado (muda ao abrir chat, expandir, redimensionar...).
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      const slot = document.querySelector<HTMLElement>('[data-music-slot]');
      const r = slot?.getBoundingClientRect() ?? null;
      const key = r ? `${r.x},${r.y},${r.width},${r.height}` : '';
      if (key !== last) {
        last = key;
        setRect(r && r.width > 0 ? r : null);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  const visible = hasMusic && rect;
  return (
    <iframe
      ref={frame}
      src={src}
      title="Player de música"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      className="fixed z-20 rounded-xl border-0 bg-black"
      style={
        visible
          ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
          : // Fora de vista, mas carregado (pronto pra tocar na hora).
            { left: -10000, top: 0, width: 400, height: 225, pointerEvents: 'none' }
      }
    />
  );
}
