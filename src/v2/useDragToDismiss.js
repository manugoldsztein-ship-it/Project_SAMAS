// ============================================================
// useDragToDismiss — iOS-style drag-down-to-close hook (0.4.46)
// ============================================================
// Manuel pidió: "deberia poder hacer drag down menus para sacarlos
// de la pantalla". Sheets como SettingsSheet, EditProfileSheet,
// ChangelogSheet, etc. tenían el drag handle visual (la rayita
// gris arriba) pero no funcional — solo se cerraban con el botón
// X o tap-on-backdrop.
//
// HOW IT WORKS
//   const { dragHandlers, dragStyle } = useDragToDismiss(onClose);
//   <div ref={containerRef} {...dragHandlers} style={{ ...dragStyle }}>
//
//   - touchstart: snapshot startY + scrollTop del container
//   - touchmove: si scrollTop > 0 NO drageamos (es scroll real).
//     Si scrollTop === 0 y deltaY > 0, aplicamos translateY(deltaY).
//   - touchend: si deltaY > THRESHOLD, llamamos onClose().
//     Si no, reseteamos translateY a 0 con transition smooth.
//
// EDGE CASES
//   - Si el user empieza a draggear desde un input o button, también
//     funciona — ese input no captura el touchmove unless tiene el
//     propio handler. Mantenemos pasivo el touchstart para no
//     bloquear taps cortos.
//   - touch-action: pan-y en el container deja el scroll vertical
//     normal funcionar. El drag-to-dismiss se activa solo cuando
//     ya estás en el tope del scroll.
// ============================================================

import { useCallback, useRef, useState } from "react";

const DISMISS_THRESHOLD = 120; // px — cuanto tiene que arrastrarse hacia abajo para cerrar
const RESIST_THRESHOLD = 6;    // px — debajo de esto ignoramos (evita micro-jitter)

/**
 * @param {() => void} onClose — callback que cierra la sheet
 * @param {object} opts
 * @param {boolean} [opts.disabled] — apaga el hook (ej cuando hay teclado virtual abierto)
 * @returns {{ dragHandlers, dragStyle, isDragging, ref }}
 */
export function useDragToDismiss(onClose, opts = {}) {
  const { disabled = false } = opts;
  const ref = useRef(null);
  const startYRef = useRef(0);
  const startScrollRef = useRef(0);
  const draggingRef = useRef(false);
  const [translateY, setTranslateY] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  const onTouchStart = useCallback((e) => {
    if (disabled) return;
    if (!e.touches || e.touches.length === 0) return;
    const node = ref.current;
    startYRef.current = e.touches[0].clientY;
    startScrollRef.current = node ? node.scrollTop : 0;
    draggingRef.current = false; // confirmamos solo cuando deltaY se hace claro
    setTransitioning(false);
  }, [disabled]);

  const onTouchMove = useCallback((e) => {
    if (disabled) return;
    if (!e.touches || e.touches.length === 0) return;
    const dy = e.touches[0].clientY - startYRef.current;
    // Si el scroll del container no está en el top, dejamos que sea
    // scroll normal — no draggeamos. (scrollTop > 0 quiere decir que
    // ya bajaste algo de contenido y aún tenés más para arriba.)
    if (startScrollRef.current > 0) return;
    // Drag solo hacia abajo. Si va hacia arriba, NO arrastramos.
    if (dy <= RESIST_THRESHOLD) {
      if (draggingRef.current) {
        // user volvió a subir — clamp a 0
        setTranslateY(0);
        draggingRef.current = false;
      }
      return;
    }
    draggingRef.current = true;
    setTranslateY(dy);
  }, [disabled]);

  const onTouchEnd = useCallback(() => {
    if (disabled) return;
    if (!draggingRef.current) {
      setTranslateY(0);
      return;
    }
    draggingRef.current = false;
    if (translateY >= DISMISS_THRESHOLD) {
      // Animar fuera de pantalla y cerrar.
      setTransitioning(true);
      setTranslateY(window.innerHeight);
      // El onClose se dispara después de que la animación termine.
      // 220ms matchea las otras sheet animations del proyecto.
      setTimeout(() => {
        onClose && onClose();
      }, 220);
    } else {
      // Snap back al top.
      setTransitioning(true);
      setTranslateY(0);
    }
  }, [disabled, translateY, onClose]);

  const onTouchCancel = useCallback(() => {
    draggingRef.current = false;
    setTransitioning(true);
    setTranslateY(0);
  }, []);

  const dragHandlers = {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  };

  const dragStyle = {
    transform: translateY ? `translateY(${translateY}px)` : undefined,
    transition: transitioning ? "transform 220ms ease-out" : "none",
    touchAction: "pan-y",
  };

  return { ref, dragHandlers, dragStyle, isDragging: translateY > 0 };
}
